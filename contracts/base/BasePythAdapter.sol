// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "../interfaces/pyth/IPyth.sol";
import {PythStructs} from "../interfaces/pyth/PythStructs.sol";
import {PythErrors} from "../interfaces/pyth/PythErrors.sol";
import {PythAdapterStorage} from "../storage/PythAdapterStorage.sol";

/// @title BasePythAdapter
/// @author Open Oracle Association
/// @notice Base contract implementing IPyth interface with oracle-agnostic logic
/// @dev Provides Pyth interface implementation and delegates to abstract hooks for oracle-specific verification
abstract contract BasePythAdapter is IPyth {
    // ============ Custom Errors ============

    /// @notice Thrown when more than one matching update exists within the requested time window
    /// @param id The price ID that has multiple updates
    error MultiplePriceUpdatesWithinRange(bytes32 id);

    /// @notice Thrown if TWAP function is not implemented.
    error TwapNotImplemented();

    /// @notice Thrown when result validation fails during processing
    /// @param reason Human-readable description of the validation failure
    error ValidationFailed(string reason);

    // ============ IPyth Implementation ============

    /// @inheritdoc IPyth
    function getPriceUnsafe(bytes32 id) external view override returns (PythStructs.Price memory price) {
        return _getPrice(id, 0, false);
    }

    /// @inheritdoc IPyth
    function getPriceNoOlderThan(
        bytes32 id,
        uint256 age
    ) external view override returns (PythStructs.Price memory price) {
        return _getPrice(id, age, false);
    }

    /// @inheritdoc IPyth
    function getEmaPriceUnsafe(bytes32 id) external view override returns (PythStructs.Price memory price) {
        return _getPrice(id, 0, true);
    }

    /// @inheritdoc IPyth
    function getEmaPriceNoOlderThan(
        bytes32 id,
        uint256 age
    ) external view override returns (PythStructs.Price memory price) {
        return _getPrice(id, age, true);
    }

    /// @notice Update price feeds with given update messages.
    /// @dev This implementation does not require or charge any fees; calls are always free.
    /// Prices will be updated if they are more recent than the current stored prices.
    /// The call will succeed even if the update is not the most recent.
    /// Reverts if the updateData is invalid.
    /// @param updateData Array of price update data.
    function updatePriceFeeds(bytes[] calldata updateData) external payable override {
        for (uint256 i = 0; i < updateData.length; ++i) {
            // TODO: we could also pass the strict
            _processSignedPayload(updateData[i], true);
        }
    }

    /// @notice Get update fee
    /// @return The update fee (always 0 for this implementation)
    // solhint-disable-next-line use-natspec
    function getUpdateFee(bytes[] calldata /* updateData */) external pure override returns (uint256) {
        return 0;
    }

    /// @notice Get TWAP update fee
    /// @return The update fee (function reverts - not implemented)
    // solhint-disable-next-line use-natspec
    function getTwapUpdateFee(bytes[] calldata /* updateData */) external pure override returns (uint256) {
        revert TwapNotImplemented();
    }

    /// @notice Update price feeds if necessary
    /// @param updateData The update data to update
    /// @param priceIds The price IDs to update
    /// @param publishTimes The publish times to update
    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) external payable override {
        if (priceIds.length != publishTimes.length) revert PythErrors.InvalidArgument();

        bool needsUpdate = false;
        for (uint256 i = 0; i < priceIds.length; ++i) {
            PythAdapterStorage.PriceInfo memory current = PythAdapterStorage.layout().priceInfos[priceIds[i]];
            if (current.publishTime < publishTimes[i]) {
                needsUpdate = true;
                break;
            }
        }

        // Pyth parity: revert when nothing to do
        if (!needsUpdate) revert PythErrors.NoFreshUpdate();

        for (uint256 i = 0; i < updateData.length; ++i) {
            _processSignedPayload(updateData[i], true);
        }
    }

    /// @notice Parse price feed updates with configuration
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minAllowedPublishTime The minimum allowed publish time
    /// @param maxAllowedPublishTime The maximum allowed publish time
    /// @param checkUniqueness Whether to check uniqueness
    /// @param checkUpdateDataIsMinimal Whether to check update data is minimal
    /// @param storeUpdatesIfFresh Whether to store updates if fresh
    /// @return priceFeeds Array of parsed price feeds
    /// @return slots Array of slots
    function parsePriceFeedUpdatesWithConfig(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minAllowedPublishTime,
        uint64 maxAllowedPublishTime,
        bool checkUniqueness,
        bool checkUpdateDataIsMinimal,
        bool storeUpdatesIfFresh
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds, uint64[] memory slots) {
        priceFeeds = _parsePriceFeedUpdates(
            updateData,
            priceIds,
            minAllowedPublishTime,
            maxAllowedPublishTime,
            checkUniqueness,
            checkUpdateDataIsMinimal,
            storeUpdatesIfFresh
        );
        slots = new uint64[](priceIds.length); // SEDA doesn't use slots
    }

    /// @notice Parse price feed updates
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minPublishTime The minimum publish time
    /// @param maxPublishTime The maximum publish time
    /// @return priceFeeds Array of parsed price feeds
    function parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds) {
        return _parsePriceFeedUpdates(updateData, priceIds, minPublishTime, maxPublishTime, false, false, false);
    }

    /// @notice Parse time-weighted average price (TWAP) from two consecutive price updates
    /// @return Array of TWAP price feeds (function reverts - not implemented)
    // solhint-disable-next-line use-natspec
    function parseTwapPriceFeedUpdates(
        bytes[] calldata /* updateData */,
        bytes32[] calldata /* priceIds */
    ) external payable override returns (PythStructs.TwapPriceFeed[] memory) {
        revert TwapNotImplemented();
    }

    /// @notice Parses price feed updates with uniqueness check
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minPublishTime The minimum publish time
    /// @param maxPublishTime The maximum publish time
    /// @return priceFeeds Array of parsed price feeds
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds) {
        return _parsePriceFeedUpdates(updateData, priceIds, minPublishTime, maxPublishTime, true, false, false);
    }

    /// @notice Retrieves all registered asset IDs
    /// @return Array of all asset IDs that have been created
    function getAssetIds() public view returns (bytes32[] memory) {
        return PythAdapterStorage.layout().assetIds;
    }

    /// @notice Gets price information for a specific asset ID
    /// @param assetId The asset ID to get the price information for
    /// @return The price information for the asset ID
    function getPriceInfo(bytes32 assetId) external view returns (PythAdapterStorage.PriceInfo memory) {
        return PythAdapterStorage.layout().priceInfos[assetId];
    }

    // ============ Internal Functions ============

    /// @notice Internal helper to get price with optional age validation and EMA selection
    /// @dev This function centralizes price retrieval logic for all public getter functions.
    ///      Age validation is performed only when age > 0 to avoid unnecessary checks.
    ///      The function reverts if the price feed doesn't exist or if the price is stale.
    ///      Uses short-circuit evaluation to prevent underflow in age calculations.
    /// @param id The price ID to get the price for
    /// @param age The maximum age of the price in seconds (0 means no age validation)
    /// @param useEma Whether to return EMA price (true) or regular price (false)
    /// @return price The requested price data
    function _getPrice(bytes32 id, uint256 age, bool useEma) internal view returns (PythStructs.Price memory price) {
        PythAdapterStorage.PriceInfo memory info = PythAdapterStorage.layout().priceInfos[id];
        if (info.publishTime == 0) revert PythErrors.PriceFeedNotFound();

        // Age validation (only if age > 0)
        if (age > 0) {
            // solhint-disable-next-line not-rely-on-time
            if (block.timestamp < info.publishTime || block.timestamp - info.publishTime > age)
                revert PythErrors.StalePrice();
        }

        // Return EMA or regular price based on useEma flag
        if (useEma) {
            return PythStructs.Price(info.emaPrice, info.emaConf, info.expo, info.publishTime);
        } else {
            return PythStructs.Price(info.price, info.conf, info.expo, info.publishTime);
        }
    }

    /// @notice Parses price feed updates with optional storage update
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minPublishTime Minimum publish time filter
    /// @param maxPublishTime Maximum publish time filter
    /// @param checkUniqueness Whether to enforce uniqueness
    /// @param checkUpdateDataIsMinimal Whether to enforce minimal update data
    /// @param updateStorage Whether to update storage
    /// @return priceFeeds Array of parsed price feeds
    function _parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        bool checkUniqueness,
        bool checkUpdateDataIsMinimal,
        bool updateStorage
    ) internal returns (PythStructs.PriceFeed[] memory priceFeeds) {
        priceFeeds = new PythStructs.PriceFeed[](priceIds.length);

        // Per-id match counters (detect >1 match for a single requested id)
        uint256[] memory matchCounts = new uint256[](priceIds.length);
        // Total updates count across blobs (for minimality)
        uint64 totalUpdatesAcrossBlobs = 0;

        for (uint256 i = 0; i < updateData.length; ++i) {
            totalUpdatesAcrossBlobs += _processFilteredUpdates(
                updateData[i],
                priceIds,
                minPublishTime,
                maxPublishTime,
                checkUniqueness,
                updateStorage,
                priceFeeds,
                matchCounts
            );
        }

        // Ensure every requested feed had >= 1 match
        for (uint256 k = 0; k < priceIds.length; ++k) {
            if (priceFeeds[k].id == 0) revert PythErrors.PriceFeedNotFoundWithinRange();
        }

        // Minimality: total updates must equal #requested feeds (exactly)
        if (checkUpdateDataIsMinimal && totalUpdatesAcrossBlobs != priceIds.length) {
            revert PythErrors.InvalidArgument();
        }
    }

    /// @notice Processes a single price update
    /// @param priceId The price ID to process
    /// @param priceInfo The price information to process
    /// @param priceIds The price IDs to search in
    /// @param minPublishTime The minimum publish time
    /// @param maxPublishTime The maximum publish time
    /// @param priceFeeds The price feeds to update
    /// @param updateStorage Whether to update storage
    /// @param checkUniqueness Whether to check uniqueness
    /// @param matchCounts The match counts
    /// @dev Irrelevant for our requested set or out of window — ignored.
    /// @dev Uniqueness behavior:
    ///      - If uniqueness is ON, select the **earliest** matching update in the window;
    ///        if multiple have the same timestamp, keep the first encountered. Never revert.
    ///      - If uniqueness is OFF, prefer the **latest** matching update in the window.
    function _processPriceUpdate(
        bytes32 priceId,
        PythAdapterStorage.PriceInfo memory priceInfo,
        bytes32[] memory priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        PythStructs.PriceFeed[] memory priceFeeds,
        bool updateStorage,
        bool checkUniqueness,
        uint256[] memory matchCounts
    ) internal {
        uint256 targetIndex = _findPriceIdIndex(priceIds, priceId);
        bool requested = (targetIndex < priceIds.length);
        bool inRange = (priceInfo.publishTime + 1 > minPublishTime && priceInfo.publishTime < maxPublishTime + 1);

        if (!requested || !inRange) {
            // Irrelevant for our requested set or out of window — ignored.
            return;
        }

        // Count matches for this requested id in the window (kept for telemetry/compat).
        ++matchCounts[targetIndex];

        // Existing candidate (if any)
        bool hasCandidate = (priceFeeds[targetIndex].id != 0);
        uint64 existingTime = hasCandidate ? uint64(priceFeeds[targetIndex].price.publishTime) : 0;
        uint64 newTime = uint64(priceInfo.publishTime);

        if (checkUniqueness) {
            // Choose the earliest-in-window; if equal timestamp, keep the first one seen.
            bool shouldReplace = !hasCandidate || (newTime < existingTime);
            if (shouldReplace) {
                // Convert to Pyth PriceFeed using computed priceId
                priceFeeds[targetIndex] = _convertToPriceFeed(priceId, priceInfo);

                if (updateStorage) {
                    // Parsing path should NOT revert on non-fresh data; only advance storage.
                    _applyUpdate(priceId, priceInfo, /*strict=*/ false);
                }
            }
            // If newTime == existingTime, keep the first encountered (no-op).
        } else {
            // Non-unique mode prefers the latest-in-window.
            bool shouldReplace =
                !hasCandidate || (newTime > existingTime);
            if (shouldReplace) {
                // Convert to Pyth PriceFeed using computed priceId
                priceFeeds[targetIndex] = _convertToPriceFeed(priceId, priceInfo);

                if (updateStorage) {
                    // Advance storage only when newer; don't revert on equal/older.
                    _applyUpdate(priceId, priceInfo, /*strict=*/ false);
                }
            }
        }
    }

    /// @notice Updates price information with time-based validation
    /// @param priceId The unique identifier for the price feed
    /// @param newInfo The new price information to store
    /// @param strict Whether to enforce strict time validation
    /// @dev strict=false: Allow updates only if newInfo.publishTime > existing.publishTime
    /// @dev strict=true: Revert if newInfo.publishTime <= existing.publishTime
    /// @dev Use strict=true for user operations, strict=false for batch processing
    function _applyUpdate(bytes32 priceId, PythAdapterStorage.PriceInfo memory newInfo, bool strict) internal {
        PythAdapterStorage.Layout storage s = PythAdapterStorage.layout();
        PythAdapterStorage.PriceInfo storage current = s.priceInfos[priceId];

        bool isNewer = newInfo.publishTime > current.publishTime;
        if (strict) {
            if (!isNewer) revert PythErrors.StalePrice();
        } else {
            if (!isNewer) return;
        }

        // If this is a new price feed, add to assetIds before updating
        if (current.publishTime == 0) {
            s.assetIds.push(priceId);
        }

        // Update all fields individually (more gas efficient than struct assignment)
        current.price = newInfo.price;
        current.conf = newInfo.conf;
        current.expo = newInfo.expo;
        current.publishTime = newInfo.publishTime;
        current.emaPrice = newInfo.emaPrice;
        current.emaConf = newInfo.emaConf;

        emit PriceFeedUpdate(priceId, newInfo.publishTime, newInfo.price, newInfo.conf);
    }

    // ============ Private Functions ============

    /// @notice Finds the index of a price ID in the requested array
    /// @param priceIds The price IDs to search in
    /// @param targetId The target price ID to find
    /// @return The index of the target price ID
    function _findPriceIdIndex(bytes32[] memory priceIds, bytes32 targetId) private pure returns (uint256) {
        for (uint256 i = 0; i < priceIds.length; ++i) {
            if (priceIds[i] == targetId) return i;
        }
        return priceIds.length;
    }

    /// @notice Converts price info to a PythStructs.PriceFeed
    /// @param priceId The computed price ID
    /// @param priceInfo The price information
    /// @return priceFeed The converted price feed
    function _convertToPriceFeed(
        bytes32 priceId,
        PythAdapterStorage.PriceInfo memory priceInfo
    ) private pure returns (PythStructs.PriceFeed memory priceFeed) {
        return
            PythStructs.PriceFeed({
                id: priceId,
                price: PythStructs.Price({
                    price: priceInfo.price,
                    conf: priceInfo.conf,
                    expo: priceInfo.expo,
                    publishTime: priceInfo.publishTime
                }),
                emaPrice: PythStructs.Price({
                    price: priceInfo.emaPrice,
                    conf: priceInfo.emaConf,
                    expo: priceInfo.expo,
                    publishTime: priceInfo.publishTime
                })
            });
    }

    // ============ Abstract Functions ============

    /// @notice Processes a signed payload with optional storage update
    /// @param signedPayload The signed payload to process
    /// @param updateStorage Whether to update storage or just parse
    /// @dev This is the main hook for oracle-specific verification and processing
    function _processSignedPayload(bytes calldata signedPayload, bool updateStorage) internal virtual;

    /// @notice Processes filtered update data with validation and filtering
    /// @param updateData The update data to process
    /// @param priceIds The price IDs to process
    /// @param minPublishTime The minimum publish time
    /// @param maxPublishTime The maximum publish time
    /// @param checkUniqueness Whether to check uniqueness
    /// @param updateStorage Whether to update storage
    /// @param priceFeeds The price feeds to update
    /// @param matchCounts The match counts
    /// @return The number of updates processed
    /// @dev This must be implemented by the specific oracle adapter
    function _processFilteredUpdates(
        bytes calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        bool checkUniqueness,
        bool updateStorage,
        PythStructs.PriceFeed[] memory priceFeeds,
        uint256[] memory matchCounts
    ) internal virtual returns (uint64);
}
