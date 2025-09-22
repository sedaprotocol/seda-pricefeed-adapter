// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {FastProver} from "./FastProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";
import {PythStructs} from "./interfaces/pyth/PythStructs.sol";
import {IPyth} from "./interfaces/pyth/IPyth.sol";
import {PythErrors} from "./interfaces/pyth/PythErrors.sol";

import {FastPriceFeedAdapterStorage} from "./libraries/FastPriceFeedAdapterStorage.sol";

/// @title FastPriceFeedAdapter
/// @author Open Oracle Association
/// @notice SEDA Price Feed Adapter for managing, verifying, and storing SEDA oracle price feeds.
/// @dev Contract for creating and managing FAST PriceFeed proxies (EIP-1167), verifying oracle results,
///      and maintaining a registry of asset IDs. Uses ERC-7201 storage layout for upgrade safety and
///      UUPS upgrade pattern. Pausable for emergencies. All state is stored in a single versioned storage slot.
/// @custom:security Inherits OpenZeppelin upgradeable contracts. Only the owner can perform admin actions.
///                  Oracle result validation is enforced.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract FastPriceFeedAdapter is IPyth, Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    // ============ Structs ============

    /// @notice Struct for submitting signed data to the contract
    /// @dev Used for passing data and its corresponding signature for verification
    struct SignedPayload {
        bytes data;
        bytes signature;
    }

    /// @notice Struct containing configuration for execution and tally programs
    /// @dev Used to specify the program IDs and tally input parameters for a price feed update
    struct ProgramConfig {
        bytes32 execProgramId;
        bytes32 tallyProgramId;
    }

    /// @notice Struct for updating price feeds with multiple results
    /// @dev Contains the execution inputs, configuration, and oracle results for batch updates
    struct PriceUpdateBatch {
        ProgramConfig programConfig;
        SedaDataTypes.Result result;
    }

    /// @notice Struct containing the price feed ID and the price information.
    /// @dev WARNING: The `id` here is NOT the global asset ID under which the price is stored in this contract.
    /// The global asset ID is computed as keccak256(abi.encode(execProgramId, tallyProgramId, id)).
    struct PriceUpdate {
        bytes32 rawId;
        FastPriceFeedAdapterStorage.PriceInfo priceInfo;
    }

    // ============ Custom Errors ============

    /// @notice Thrown when more than one matching update exists within the requested time window
    /// @param id The price ID that has multiple updates
    error MultiplePriceUpdatesWithinRange(bytes32 id);

    /// @notice Thrown when a function is not implemented
    error NotImplemented();

    /// @notice Thrown when provided updateData contains entries that are not strictly necessary
    error UpdateDataNotMinimal();

    /// @notice Thrown when result validation fails during processing
    /// @param reason Human-readable description of the validation failure
    error ValidationFailed(string reason);

    /// @notice Thrown when a zero address is provided where a valid address is required
    /// @param parameter The name of the parameter that cannot be zero address
    error ZeroAddressNotAllowed(string parameter);

    // ============ Events ============

    /// @notice Emitted when the SEDA prover address is updated by the owner
    /// @param oldProver The previous prover contract address
    /// @param newProver The new prover contract address
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    /// @notice Disables initializers to prevent future reinitialization
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the PriceFeedAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param owner Address that will have administrative privileges over the adapter
    function initialize(address sedaProverAddress, address owner) public initializer {
        if (sedaProverAddress == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __Ownable_init(owner);
        __UUPSUpgradeable_init();
        __Pausable_init();

        FastPriceFeedAdapterStorage.Layout storage s = FastPriceFeedAdapterStorage.layout();
        s.sedaProver = sedaProverAddress;
    }

    // ============ External Functions ============

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyProxy onlyOwner {
        if (newProver == address(0)) revert ZeroAddressNotAllowed("prover");
        FastPriceFeedAdapterStorage.Layout storage s = FastPriceFeedAdapterStorage.layout();
        address oldProver = s.sedaProver;
        s.sedaProver = newProver;
        emit ProverUpdated(oldProver, newProver);
    }

    /// @notice Pauses the contract, preventing new price feed submissions (owner only)
    /// @dev This is an emergency function to stop all price feed updates
    function pause() external onlyProxy onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract, allowing price feed submissions to resume (owner only)
    /// @dev This function can only be called by the owner
    function unpause() external onlyProxy onlyOwner {
        _unpause();
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    /// @return The address of the SEDA prover contract
    function getProver() public view returns (address) {
        return FastPriceFeedAdapterStorage.layout().sedaProver;
    }

    /// @notice Retrieves all registered ticker symbols
    /// @return Array of all ticker symbols that have been created
    function getAssetIds() public view returns (bytes32[] memory) {
        return FastPriceFeedAdapterStorage.layout().assetIds;
    }

    /// @notice Gets price information for a specific asset ID
    /// @param assetId The asset ID to get the price information for
    /// @return The price information for the asset ID
    function getPriceInfo(bytes32 assetId) external view returns (FastPriceFeedAdapterStorage.PriceInfo memory) {
        return FastPriceFeedAdapterStorage.layout().priceInfos[assetId];
    }

    // ============ Internal Functions ============

    /// @notice Required by the OZ UUPS module
    /// @dev Only the owner can upgrade the contract
    /// @param newImplementation Address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        if (newImplementation == address(0)) revert ZeroAddressNotAllowed("implementation");
    }

    /// @notice Computes the composed price id from program ids and a raw feed id
    function _computePriceId(ProgramConfig memory programConfig, bytes32 rawId) internal pure returns (bytes32) {
        // IMPORTANT: Pyth priceId is unique in Pyth. In SEDA we make it unique per program pair.
        return keccak256(abi.encode(programConfig.execProgramId, programConfig.tallyProgramId, rawId));
    }

    /// @notice Processes a signed payload with optional storage update
    /// @param signedPayload The signed payload to process
    /// @param updateStorage Whether to update storage or just parse
    function _processSignedPayload(bytes calldata signedPayload, bool updateStorage) internal whenNotPaused {
        (ProgramConfig memory cfg, PriceUpdate[] memory ups, ) = _verifyAndDecode(signedPayload);
        if (updateStorage) {
            // permissive (skip older/equal)
            for (uint256 i = 0; i < ups.length; ) {
                _applyUpdate(_computePriceId(cfg, ups[i].rawId), ups[i].priceInfo, /*strict=*/ false);
                unchecked {
                    ++i;
                }
            }
        }
    }

    /// Verifies a SignedPayload and decodes it into (ProgramConfig, PriceUpdate[], Result)
    /// @param signedPayload The signed payload to verify and decode
    /// @return programConfig The program configuration
    /// @return updates The price updates array
    /// @return result The SEDA result
    function _verifyAndDecode(
        bytes calldata signedPayload
    )
        internal
        view
        returns (ProgramConfig memory programConfig, PriceUpdate[] memory updates, SedaDataTypes.Result memory result)
    {
        SignedPayload memory payload = abi.decode(signedPayload, (SignedPayload));
        bytes32 dataHash = keccak256(payload.data);
        (bool valid, ) = FastProver(getProver()).verifyData(dataHash, payload.signature);
        if (!valid) revert ValidationFailed("Invalid signature");

        // Decode the verified data
        PriceUpdateBatch memory batch = abi.decode(payload.data, (PriceUpdateBatch));
        if (batch.result.exitCode != 0) revert ValidationFailed("Invalid exit code");
        programConfig = batch.programConfig;
        result = batch.result;
        updates = abi.decode(batch.result.result, (PriceUpdate[]));
        if (updates.length == 0) revert ValidationFailed("Empty batch");
    }

    /// Single writer with strict/permissive semantics.
    /// - strict=false → skip on older/equal (batch ingest)
    /// - strict=true  → revert on older/equal (parse* store-if-fresh paths)
    function _applyUpdate(bytes32 priceId, FastPriceFeedAdapterStorage.PriceInfo memory newInfo, bool strict) internal {
        FastPriceFeedAdapterStorage.Layout storage s = FastPriceFeedAdapterStorage.layout();
        FastPriceFeedAdapterStorage.PriceInfo memory cur = s.priceInfos[priceId];

        if (strict) {
            if (newInfo.publishTime <= cur.publishTime) revert ValidationFailed("New price must be newer");
        } else {
            if (newInfo.publishTime <= cur.publishTime) return;
        }

        s.priceInfos[priceId] = newInfo;
        if (cur.publishTime == 0) {
            s.assetIds.push(priceId);
        }
        emit PriceFeedUpdate(priceId, newInfo.publishTime, newInfo.price, newInfo.conf);
    }

    /// @notice Updates price feeds in storage
    /// @param batch The batch configuration
    function _updatePriceFeeds(PriceUpdateBatch memory batch) internal {
        PriceUpdate[] memory priceUpdates = abi.decode(batch.result.result, (PriceUpdate[]));
        if (priceUpdates.length == 0) revert ValidationFailed("Empty batch");

        for (uint256 i = 0; i < priceUpdates.length; ++i) {
            _applyUpdate(
                _computePriceId(batch.programConfig, priceUpdates[i].rawId),
                priceUpdates[i].priceInfo,
                false /*strict=*/
            );
        }
    }

    /// @notice Parses price feed updates with optional storage update
    /// @param updateData The update data to parse
    /// @param priceIds The price IDs to filter for (EXPECT composed ids)
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
            totalUpdatesAcrossBlobs += _processUpdateDataBlob(
                updateData[i],
                priceIds,
                minPublishTime,
                maxPublishTime,
                priceFeeds,
                updateStorage,
                checkUniqueness,
                matchCounts
            );
        }

        // Ensure every requested feed had >= 1 match
        for (uint256 k = 0; k < priceIds.length; k++) {
            if (priceFeeds[k].id == 0) revert PythErrors.PriceFeedNotFoundWithinRange();
        }

        // Minimality: total updates must equal #requested feeds (exactly)
        if (checkUpdateDataIsMinimal && totalUpdatesAcrossBlobs != priceIds.length) {
            revert PythErrors.InvalidArgument();
        }
    }

    /// @notice Processes a single update data blob
    function _processUpdateDataBlob(
        bytes calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        PythStructs.PriceFeed[] memory priceFeeds,
        bool updateStorage,
        bool checkUniqueness,
        uint256[] memory matchCounts
    ) internal returns (uint64) {
        // PriceUpdate[] memory priceUpdates = abi.decode(batch.result.result, (PriceUpdate[]));
        (ProgramConfig memory cfg, PriceUpdate[] memory priceUpdates, ) = _verifyAndDecode(updateData);

        for (uint256 i = 0; i < priceUpdates.length; i++) {
            _processPriceUpdate(
                priceUpdates[i],
                cfg,
                priceIds,
                minPublishTime,
                maxPublishTime,
                priceFeeds,
                updateStorage,
                checkUniqueness,
                matchCounts
            );
        }

        // Minimality counts *all* updates present in this blob (like Pyth’s numUpdates)
        return uint64(priceUpdates.length);
    }

    /// @notice Processes a single price update
    function _processPriceUpdate(
        PriceUpdate memory priceUpdate,
        ProgramConfig memory programConfig,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        PythStructs.PriceFeed[] memory priceFeeds,
        bool updateStorage,
        bool checkUniqueness,
        uint256[] memory matchCounts
    ) internal {
        bytes32 priceId = _computePriceId(programConfig, priceUpdate.rawId);

        uint256 targetIndex = _findPriceIdIndex(priceIds, priceId);
        bool requested = (targetIndex < priceIds.length);
        bool inRange = (priceUpdate.priceInfo.publishTime >= minPublishTime &&
            priceUpdate.priceInfo.publishTime <= maxPublishTime);

        if (!requested || !inRange) {
            // Irrelevant for our requested set or out of window — ignored.
            return;
        }

        // Count matches for this requested id in the window.
        matchCounts[targetIndex] += 1;

        // If uniqueness is requested, the *second* match must revert.
        if (checkUniqueness && matchCounts[targetIndex] > 1) {
            revert MultiplePriceUpdatesWithinRange(priceId);
        }

        // Fill behavior:
        // - If uniqueness is ON, we only ever see the first match (2nd would revert), so set once.
        // - If uniqueness is OFF, we prefer the latest (overwrite if newer).
        if (
            priceFeeds[targetIndex].id == 0 ||
            (!checkUniqueness && priceUpdate.priceInfo.publishTime > priceFeeds[targetIndex].price.publishTime)
        ) {
            priceFeeds[targetIndex] = PythStructs.PriceFeed({
                id: priceId,
                price: PythStructs.Price({
                    price: priceUpdate.priceInfo.price,
                    conf: priceUpdate.priceInfo.conf,
                    expo: priceUpdate.priceInfo.expo,
                    publishTime: priceUpdate.priceInfo.publishTime
                }),
                emaPrice: PythStructs.Price({
                    price: priceUpdate.priceInfo.emaPrice,
                    conf: priceUpdate.priceInfo.emaConf,
                    expo: priceUpdate.priceInfo.expo,
                    publishTime: priceUpdate.priceInfo.publishTime
                })
            });

            if (updateStorage) {
                _applyUpdate(priceId, priceUpdate.priceInfo, /*strict=*/ true);
            }
        }
    }

    /// @notice Finds the index of a price ID in the requested array
    function _findPriceIdIndex(bytes32[] calldata priceIds, bytes32 targetId) internal pure returns (uint256) {
        for (uint256 i = 0; i < priceIds.length; i++) {
            if (priceIds[i] == targetId) return i;
        }
        return priceIds.length;
    }

    // ============ IPyth Functions ============

    function getPriceUnsafe(bytes32 id) external view override returns (PythStructs.Price memory price) {
        FastPriceFeedAdapterStorage.PriceInfo memory info = FastPriceFeedAdapterStorage.layout().priceInfos[id];
        if (info.publishTime == 0) revert PythErrors.PriceFeedNotFound();
        return PythStructs.Price(info.price, info.conf, info.expo, info.publishTime);
    }

    function getEmaPriceUnsafe(bytes32 id) external view override returns (PythStructs.Price memory price) {
        FastPriceFeedAdapterStorage.PriceInfo memory info = FastPriceFeedAdapterStorage.layout().priceInfos[id];
        if (info.publishTime == 0) revert PythErrors.PriceFeedNotFound();
        return PythStructs.Price(info.emaPrice, info.emaConf, info.expo, info.publishTime);
    }

    function getPriceNoOlderThan(bytes32 id, uint age) external view override returns (PythStructs.Price memory price) {
        FastPriceFeedAdapterStorage.PriceInfo memory info = FastPriceFeedAdapterStorage.layout().priceInfos[id];
        if (info.publishTime == 0) revert PythErrors.PriceFeedNotFound();
        if (block.timestamp - info.publishTime > age) revert PythErrors.StalePrice();
        return PythStructs.Price(info.price, info.conf, info.expo, info.publishTime);
    }

    function getEmaPriceNoOlderThan(
        bytes32 id,
        uint age
    ) external view override returns (PythStructs.Price memory price) {
        FastPriceFeedAdapterStorage.PriceInfo memory info = FastPriceFeedAdapterStorage.layout().priceInfos[id];
        if (info.publishTime == 0) revert PythErrors.PriceFeedNotFound();
        if (block.timestamp - info.publishTime > age) revert PythErrors.StalePrice();
        return PythStructs.Price(info.emaPrice, info.emaConf, info.expo, info.publishTime);
    }

    // ------------------------------

    function getUpdateFee(bytes[] calldata) external pure override returns (uint) {
        return 0;
    }

    function getTwapUpdateFee(bytes[] calldata) external pure override returns (uint) {
        return 0;
    }

    function updatePriceFeeds(bytes[] calldata updateData) external payable override {
        for (uint256 i = 0; i < updateData.length; i++) {
            _processSignedPayload(updateData[i], true); // true = update storage
        }
    }

    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) external payable override {
        if (priceIds.length != publishTimes.length) revert PythErrors.InvalidArgument();

        bool needsUpdate = false;
        for (uint256 i = 0; i < priceIds.length; i++) {
            FastPriceFeedAdapterStorage.PriceInfo memory current = FastPriceFeedAdapterStorage.layout().priceInfos[
                priceIds[i]
            ];
            if (current.publishTime < publishTimes[i]) {
                needsUpdate = true;
                break;
            }
        }

        // Pyth parity: revert when nothing to do
        if (!needsUpdate) revert PythErrors.NoFreshUpdate();

        for (uint256 i = 0; i < updateData.length; i++) {
            _processSignedPayload(updateData[i], true);
        }
    }

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

    function parsePriceFeedUpdates(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds) {
        return _parsePriceFeedUpdates(updateData, priceIds, minPublishTime, maxPublishTime, false, false, false);
    }

    function parseTwapPriceFeedUpdates(
        bytes[] calldata,
        bytes32[] calldata
    ) external payable override returns (PythStructs.TwapPriceFeed[] memory) {
        revert NotImplemented();
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PythStructs.PriceFeed[] memory priceFeeds) {
        return _parsePriceFeedUpdates(updateData, priceIds, minPublishTime, maxPublishTime, true, false, false);
    }
}
