// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "./external/IPyth.sol";
import {PythStructs} from "./external/PythStructs.sol";
import {PythErrors} from "./external/PythErrors.sol";
import {PythAdapterStorage} from "./PythAdapterStorage.sol";

/// @title BasePythAdapter
/// @author Open Oracle Association
/// @notice Base contract implementing IPyth interface with oracle-agnostic logic
/// @dev Provides Pyth interface implementation and delegates to abstract hooks for oracle-specific verification
abstract contract BasePythAdapter is IPyth {
    // ============ Custom Errors ============

    /// @notice Thrown if TWAP function is not implemented.
    error TwapNotImplemented();

    // ============ Modifiers ============

    /// @notice Rejects accidental ETH sent to payable endpoints
    /// @dev This implementation never charges fees
    modifier noMsgValue() {
        if (msg.value != 0) revert PythErrors.InvalidArgument();
        _;
    }

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

    /// @notice Update price feeds with the given signed updates
    /// @dev No fees are charged. Each stored feed only advances when the new publish time is
    ///      strictly newer; stale updates are silently ignored. Reverts if any payload fails
    ///      verification in `_processUpdateData`.
    /// @param updateData Array of signed oracle payloads (one per blob).
    function updatePriceFeeds(bytes[] calldata updateData) public payable virtual override noMsgValue {
        for (uint256 i = 0; i < updateData.length; ++i) {
            _processSignedPayload(updateData[i]);
        }
    }

    /// @notice Update price feeds if necessary
    /// @param updateData The update data to update
    /// @param priceIds The price IDs to update
    /// @param publishTimes The publish times to update
    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) public payable virtual override noMsgValue {
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
            _processSignedPayload(updateData[i]);
        }
    }

    /// @notice Get update fee
    /// @return The update fee (always 0 for this implementation)
    // solhint-disable-next-line use-natspec
    function getUpdateFee(bytes[] calldata /* updateData */) external pure override returns (uint256) {
        return 0;
    }

    /// @notice Get TWAP update fee
    /// @return The update fee (function reverts - TWAP is not implemented)
    // solhint-disable-next-line use-natspec
    function getTwapUpdateFee(bytes[] calldata /* updateData */) external pure override returns (uint256) {
        revert TwapNotImplemented();
    }

    /// @notice Parse price feed updates
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minPublishTime The minimum publish time (inclusive)
    /// @param maxPublishTime The maximum publish time (inclusive)
    /// @return priceFeeds Array of parsed price feeds
    function parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override noMsgValue returns (PythStructs.PriceFeed[] memory priceFeeds) {
        return _parsePriceFeedUpdates(updateData, priceIds, minPublishTime, maxPublishTime, false, false, false);
    }

    /// @notice Parse price feed updates with configuration
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minAllowedPublishTime The minimum allowed publish time (inclusive)
    /// @param maxAllowedPublishTime The maximum allowed publish time (inclusive)
    /// @param checkUniqueness Whether to enforce uniqueness semantics
    /// @param checkUpdateDataIsMinimal If true, decoded updates across all blobs must be exactly one per requested id
    ///                                 and contain no unrelated extras (strict minimality parity with Pyth).
    /// @param storeUpdatesIfFresh If true, storage is updated (only if strictly newer); otherwise parse-only.
    /// @return priceFeeds Array of parsed price feeds
    /// @return slots Array of slots (SEDA does not use slots; returned as zeroes with the same length as priceIds)
    function parsePriceFeedUpdatesWithConfig(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minAllowedPublishTime,
        uint64 maxAllowedPublishTime,
        bool checkUniqueness,
        bool checkUpdateDataIsMinimal,
        bool storeUpdatesIfFresh
    )
        public
        payable
        virtual
        override
        noMsgValue
        returns (PythStructs.PriceFeed[] memory priceFeeds, uint64[] memory slots)
    {
        priceFeeds = _parsePriceFeedUpdates(
            updateData,
            priceIds,
            minAllowedPublishTime,
            maxAllowedPublishTime,
            checkUniqueness,
            checkUpdateDataIsMinimal,
            storeUpdatesIfFresh
        );
        // Per Pyth interface, return a slots array; SEDA does not use it, so return zeroes.
        slots = new uint64[](priceIds.length);
    }

    /// @notice Parse time-weighted average price (TWAP) from two consecutive price updates
    /// @return Array of TWAP price feeds (function reverts - not implemented)
    // solhint-disable-next-line use-natspec
    function parseTwapPriceFeedUpdates(
        bytes[] calldata /* updateData */,
        bytes32[] calldata /* priceIds */
    ) external payable override noMsgValue returns (PythStructs.TwapPriceFeed[] memory) {
        revert TwapNotImplemented();
    }

    /// @notice Parses price feed updates with uniqueness check
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for
    /// @param minPublishTime The minimum publish time (inclusive)
    /// @param maxPublishTime The maximum publish time (inclusive)
    /// @return priceFeeds Array of parsed price feeds
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override noMsgValue returns (PythStructs.PriceFeed[] memory priceFeeds) {
        return _parsePriceFeedUpdates(updateData, priceIds, minPublishTime, maxPublishTime, true, false, false);
    }

    // ============ Public Functions ============

    /// @notice Retrieves all registered feed IDs
    /// @return Array of all feed IDs that have been created
    function getFeedIds() public view returns (bytes32[] memory) {
        return PythAdapterStorage.layout().feedIds;
    }

    /// @notice Gets price information for a specific feed ID
    /// @param feedId The feed ID to get the price information for
    /// @return The price information for the feed ID
    function getPriceInfo(bytes32 feedId) external view returns (PythAdapterStorage.PriceInfo memory) {
        return PythAdapterStorage.layout().priceInfos[feedId];
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
        // solhint-disable-next-line not-rely-on-time
        if (age > 0 && (block.timestamp < info.publishTime || block.timestamp - info.publishTime > age)) {
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
    /// @param minPublishTime Minimum publish time filter (inclusive)
    /// @param maxPublishTime Maximum publish time filter (inclusive)
    /// @param checkUniqueness Whether to enforce uniqueness
    /// @param checkUpdateDataIsMinimal Whether to enforce strict minimality (see above)
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

        // Total updates count across blobs (for strict minimality)
        uint64 totalUpdatesAcrossBlobs = 0;

        for (uint256 i = 0; i < updateData.length; ++i) {
            totalUpdatesAcrossBlobs += _processFilteredUpdates(
                updateData[i],
                priceIds,
                minPublishTime,
                maxPublishTime,
                checkUniqueness,
                updateStorage,
                priceFeeds
            );
        }

        // Ensure every requested feed had >= 1 match within the time window
        for (uint256 k = 0; k < priceIds.length; ++k) {
            if (priceFeeds[k].id == 0) revert PythErrors.PriceFeedNotFoundWithinRange();
        }

        // Strict minimality: total decoded updates across blobs must equal the # of requested feeds
        if (checkUpdateDataIsMinimal && totalUpdatesAcrossBlobs != priceIds.length) {
            revert PythErrors.InvalidArgument();
        }
    }

    /// @notice Processes a single price update
    /// @param priceId The price ID to process
    /// @param priceInfo The price information to process
    /// @param priceIds The price IDs to search in
    /// @param minPublishTime The minimum publish time (inclusive)
    /// @param maxPublishTime The maximum publish time (inclusive)
    /// @param priceFeeds The price feeds to update
    /// @param updateStorage Whether to update storage
    /// @param checkUniqueness Whether to check uniqueness
    /// @dev Irrelevant for our requested set or out of window — ignored.
    ///      Uniqueness behavior:
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
        bool checkUniqueness
    ) internal {
        uint256 targetIndex = _findPriceIdIndex(priceIds, priceId);

        // Skip if priceId is not in the requested set or outside of the allowed window.
        if (!(targetIndex < priceIds.length)) return;
        if (priceInfo.publishTime < minPublishTime) return;
        if (priceInfo.publishTime > maxPublishTime) return;

        // Existing candidate (if any)
        bool hasCandidate = (priceFeeds[targetIndex].id != 0);
        uint64 existingTime = hasCandidate ? uint64(priceFeeds[targetIndex].price.publishTime) : 0;
        uint64 newTime = uint64(priceInfo.publishTime);

        // Uniqueness ON: keep the earliest-in-window (first seen on ties).
        // Uniqueness OFF: keep the latest-in-window.
        // `_applyUpdate` itself only advances storage on strictly newer timestamps.
        bool shouldReplace = !hasCandidate || (checkUniqueness ? newTime < existingTime : newTime > existingTime);
        if (!shouldReplace) return;

        priceFeeds[targetIndex] = _convertToPriceFeed(priceId, priceInfo);
        if (updateStorage) _applyUpdate(priceId, priceInfo);
    }

    /// @notice Updates price information with time-based validation
    /// @param priceId The unique identifier for the price feed
    /// @param newInfo The new price information to store
    function _applyUpdate(bytes32 priceId, PythAdapterStorage.PriceInfo memory newInfo) internal {
        PythAdapterStorage.Layout storage s = PythAdapterStorage.layout();
        PythAdapterStorage.PriceInfo storage current = s.priceInfos[priceId];

        // Skip if the new price is older than the current price.
        if (!(newInfo.publishTime > current.publishTime)) return;

        // If this is a new price feed, add to feedIds before updating
        if (current.publishTime == 0) {
            s.feedIds.push(priceId);
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
    /// @return The index of the target price ID (or priceIds.length if not found)
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

    /// @notice Verifies a signed payload via the subclass hook and applies each decoded update to storage
    /// @dev Storage only advances for strictly newer publish times (see `_applyUpdate`).
    /// @param signedPayload The signed payload to process
    function _processSignedPayload(bytes calldata signedPayload) private {
        (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) = _processUpdateData(signedPayload);
        for (uint256 i = 0; i < ids.length; ++i) {
            _applyUpdate(ids[i], infos[i]);
        }
    }

    /// @notice Processes filtered update data with validation and filtering
    /// @param updateData The update data to process
    /// @param priceIds The price IDs to process
    /// @param minPublishTime The minimum publish time (inclusive)
    /// @param maxPublishTime The maximum publish time (inclusive)
    /// @param checkUniqueness Whether to check uniqueness
    /// @param updateStorage Whether to update storage
    /// @param priceFeeds The price feeds to update
    /// @return The number of updates present in `updateData` (COUNT **ALL** decoded updates in the blob,
    ///         not just those matched by `priceIds`). This enables the minimality check in `_parsePriceFeedUpdates`.
    /// @dev Decodes and verifies the blob via `_processUpdateData`, then applies the shared
    ///      earliest/latest selection using `_processPriceUpdate` for each decoded item.
    function _processFilteredUpdates(
        bytes calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        bool checkUniqueness,
        bool updateStorage,
        PythStructs.PriceFeed[] memory priceFeeds
    ) private returns (uint64) {
        (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) = _processUpdateData(updateData);

        for (uint256 i = 0; i < ids.length; ++i) {
            _processPriceUpdate(
                ids[i],
                infos[i],
                priceIds,
                minPublishTime,
                maxPublishTime,
                priceFeeds,
                updateStorage,
                checkUniqueness
            );
        }

        // Minimality counts *all* updates present in this blob
        return uint64(ids.length);
    }

    // ============ Abstract Functions ============

    /// @notice Verifies + decodes a signed payload and returns GLOBAL price IDs with their decoded prices
    /// @param updateData The update data (signed/encoded) to verify and decode
    /// @return ids GLOBAL price IDs (already mapped from any raw/oracle-specific IDs)
    /// @return infos Decoded price infos corresponding to each id
    /// @dev MUST verify authenticity (e.g., signatures/merkle proofs) and MUST map oracle-native IDs
    ///      to GLOBAL IDs appropriate for this adapter (e.g., keccak(drId, symbolId) for SEDA).
    /// @dev MUST return ALL decoded updates in the blob to support the strict minimality check (when enabled).
    function _processUpdateData(
        bytes calldata updateData
    ) internal view virtual returns (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos);
}
