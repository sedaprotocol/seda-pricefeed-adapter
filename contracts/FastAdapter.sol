// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseUpgradeable} from "./base/BaseUpgradeable.sol";
import {BasePythAdapter} from "./base/BasePythAdapter.sol";
import {FastProver} from "./provers/FastProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";
import {PythStructs} from "./interfaces/pyth/PythStructs.sol";
import {FastStructs} from "./FastStructs.sol";

import {PythAdapterStorage} from "./storage/PythAdapterStorage.sol";
import {FastAdapterStorage} from "./storage/FastAdapterStorage.sol";

/// @title FastAdapter
/// @author Open Oracle Association
/// @notice SEDA Price Feed Adapter implementing IPyth interface for managing SEDA oracle price feeds.
/// @dev Verifies SEDA results using deriveResultId and looks up feed config from a drId registry.
///      The drId is part of the signed result, so it cryptographically ties the SEDA FAST signature
///      to specific (programConfig, feedConfigs) registered by the owner — preventing replay attacks.
///      Uses ERC-7201 namespaced storage and UUPS upgrade pattern. Pausable for emergencies.
/// @custom:security Inherits BaseUpgradeable and BasePythAdapter. Only the owner can perform admin actions.
///                  Oracle result validation is enforced via FastProver.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract FastAdapter is BaseUpgradeable, BasePythAdapter {
    // ============ Constants ============

    /// @notice Number of bytes per feed in the raw oracle output
    /// @dev Each feed is encoded as: [16 zero][16-byte u128 price BE][24 zero][8-byte u64 timestamp BE]
    uint256 private constant RAW_FEED_STRIDE = 64;

    // ============ Events ============

    /// @notice Emitted when the SEDA prover address is updated by the owner
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    /// @notice Emitted when a data request config is registered
    event DataRequestRegistered(bytes32 indexed drId, bytes32 execProgramId, bytes32 tallyProgramId);

    /// @notice Emitted when a data request config is unregistered
    event DataRequestUnregistered(bytes32 indexed drId);

    // ============ Initialization ============

    /// @notice Initializes the FastAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param owner Address that will have administrative privileges over the adapter
    function initialize(address sedaProverAddress, address owner) public initializer {
        if (sedaProverAddress == address(0)) revert ZeroAddressNotAllowed("prover");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __BaseUpgradeable_init(owner);

        FastAdapterStorage.Layout storage s = FastAdapterStorage.layout();
        s.sedaProver = sedaProverAddress;
    }

    // ============ External Functions ============

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyProxy onlyOwner {
        if (newProver == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        FastAdapterStorage.Layout storage s = FastAdapterStorage.layout();
        address oldProver = s.sedaProver;
        s.sedaProver = newProver;
        emit ProverUpdated(oldProver, newProver);
    }

    /// @notice Registers a data request configuration (owner only)
    /// @dev The drId ties the signed result to specific program + feed configs.
    ///      Only results with a matching drId will be accepted by the contract.
    /// @param drId The data request ID (derived from oracle program params)
    /// @param programConfig The execution and tally program IDs
    /// @param feedConfigs Array of feed metadata (rawId, expo) for each price in the oracle output
    function registerDataRequest(
        bytes32 drId,
        FastStructs.ProgramConfig calldata programConfig,
        FastStructs.FeedConfig[] calldata feedConfigs
    ) external onlyProxy onlyOwner {
        if (feedConfigs.length == 0) revert InvalidResult("No feed configs");

        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[drId];
        entry.registered = true;
        entry.programConfig = programConfig;

        // Clear existing feedConfigs and set new ones
        delete entry.feedConfigs;
        for (uint256 i = 0; i < feedConfigs.length; ++i) {
            entry.feedConfigs.push(feedConfigs[i]);
        }

        emit DataRequestRegistered(drId, programConfig.execProgramId, programConfig.tallyProgramId);
    }

    /// @notice Unregisters a data request configuration (owner only)
    /// @param drId The data request ID to unregister
    function unregisterDataRequest(bytes32 drId) external onlyProxy onlyOwner {
        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[drId];
        if (!entry.registered) revert InvalidResult("drId not registered");

        delete entry.feedConfigs;
        entry.registered = false;
        entry.programConfig = FastStructs.ProgramConfig(bytes32(0), bytes32(0));

        emit DataRequestUnregistered(drId);
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    function getProver() public view returns (address) {
        return FastAdapterStorage.layout().sedaProver;
    }

    /// @notice Checks if a data request is registered
    /// @param drId The data request ID to check
    function isDataRequestRegistered(bytes32 drId) public view returns (bool) {
        return FastAdapterStorage.layout().drIdRegistry[drId].registered;
    }

    /// @notice Gets the registered program config for a drId
    /// @param drId The data request ID
    function getDataRequestProgramConfig(bytes32 drId) public view returns (FastStructs.ProgramConfig memory) {
        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[drId];
        if (!entry.registered) revert InvalidResult("drId not registered");
        return entry.programConfig;
    }

    /// @notice Gets the registered feed configs for a drId
    /// @param drId The data request ID
    function getDataRequestFeedConfigs(bytes32 drId) public view returns (FastStructs.FeedConfig[] memory) {
        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[drId];
        if (!entry.registered) revert InvalidResult("drId not registered");
        return entry.feedConfigs;
    }

    // ============ BasePythAdapter Implementation ============

    /// @inheritdoc BasePythAdapter
    function updatePriceFeeds(bytes[] calldata updateData) public payable override whenNotPaused {
        super.updatePriceFeeds(updateData);
    }

    /// @inheritdoc BasePythAdapter
    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) public payable override whenNotPaused {
        super.updatePriceFeedsIfNecessary(updateData, priceIds, publishTimes);
    }

    /// @inheritdoc BasePythAdapter
    function parsePriceFeedUpdatesWithConfig(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minAllowedPublishTime,
        uint64 maxAllowedPublishTime,
        bool checkUniqueness,
        bool checkUpdateDataIsMinimal,
        bool storeUpdatesIfFresh
    ) public payable override returns (PythStructs.PriceFeed[] memory priceFeeds, uint64[] memory slots) {
        if (storeUpdatesIfFresh) {
            if (paused()) revert EnforcedPause();
        }
        return
            super.parsePriceFeedUpdatesWithConfig(
                updateData,
                priceIds,
                minAllowedPublishTime,
                maxAllowedPublishTime,
                checkUniqueness,
                checkUpdateDataIsMinimal,
                storeUpdatesIfFresh
            );
    }

    /// @notice Verifies + decodes a signed payload and returns GLOBAL price IDs with their decoded prices
    /// @param updateData The update data (SignedPayload with ABI-encoded Result + SEDA FAST signature)
    /// @return ids GLOBAL price IDs (derived from registered programConfig + feedConfig rawIds)
    /// @return infos Decoded price infos from raw oracle output
    function _processUpdateData(
        bytes calldata updateData
    ) internal view override returns (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) {
        (
            FastStructs.ProgramConfig memory cfg,
            FastStructs.FeedConfig[] memory feedConfigs,
            PythAdapterStorage.PriceInfo[] memory priceInfos
        ) = _verifyAndDecode(updateData);

        ids = new bytes32[](feedConfigs.length);
        infos = priceInfos;

        for (uint256 i = 0; i < feedConfigs.length; ++i) {
            ids[i] = _computePriceId(cfg, feedConfigs[i].rawId);
        }
    }

    // ============ SEDA-Specific Implementation ============

    /// @notice Computes the global price ID from SEDA program configuration and raw feed ID
    function _computePriceId(
        FastStructs.ProgramConfig memory programConfig,
        bytes32 rawId
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(programConfig.execProgramId, programConfig.tallyProgramId, rawId));
    }

    /// @notice Verifies a SignedPayload using SEDA FAST signature and decodes raw oracle output
    /// @dev Flow:
    ///      1. Decode SignedPayload { data (ABI-encoded Result), signature }
    ///      2. Decode data as SedaDataTypes.Result
    ///      3. Verify signature against deriveResultId(result) via FastProver
    ///      4. Look up result.drId in registry → get programConfig + feedConfigs
    ///      5. Decode raw oracle output using registered feedConfigs
    function _verifyAndDecode(
        bytes calldata signedPayload
    )
        private
        view
        returns (
            FastStructs.ProgramConfig memory programConfig,
            FastStructs.FeedConfig[] memory feedConfigs,
            PythAdapterStorage.PriceInfo[] memory priceInfos
        )
    {
        FastStructs.SignedPayload memory payload = abi.decode(signedPayload, (FastStructs.SignedPayload));

        // Decode the Result from payload.data
        SedaDataTypes.Result memory result = abi.decode(payload.data, (SedaDataTypes.Result));

        // Verify signature against deriveResultId (matches what SEDA FAST signed)
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        FastProver(getProver()).verifyData(resultId, payload.signature);

        // Validate execution succeeded
        if (result.exitCode != 0) revert InvalidResult("Oracle execution failed");

        // Look up drId in registry — this ties the signed result to specific program + feed configs
        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[result.drId];
        if (!entry.registered) revert InvalidResult("drId not registered");

        programConfig = entry.programConfig;
        feedConfigs = entry.feedConfigs;

        // Decode raw oracle output bytes using registered feedConfigs
        priceInfos = _decodeRawResult(result.result, feedConfigs);
    }

    /// @notice Decodes raw oracle program output into PriceInfo structs
    /// @param rawResult The raw bytes from the oracle program (64 bytes per feed)
    /// @param feedConfigs Feed metadata providing expo for each feed
    /// @return priceInfos Decoded price information
    /// @dev Oracle output format per feed (64 bytes):
    ///      [16 zero bytes][16-byte u128 price BE][24 zero bytes][8-byte u64 timestamp BE]
    function _decodeRawResult(
        bytes memory rawResult,
        FastStructs.FeedConfig[] memory feedConfigs
    ) private pure returns (PythAdapterStorage.PriceInfo[] memory priceInfos) {
        if (feedConfigs.length == 0) revert InvalidResult("No feed configs");
        if (rawResult.length != feedConfigs.length * RAW_FEED_STRIDE) {
            revert InvalidResult("Result length mismatch with feed configs");
        }

        priceInfos = new PythAdapterStorage.PriceInfo[](feedConfigs.length);

        for (uint256 i = 0; i < feedConfigs.length; ++i) {
            uint256 offset = i * RAW_FEED_STRIDE;

            // Extract price: u128 at bytes [offset+16..offset+32] (big-endian)
            uint128 rawPrice;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                rawPrice := shr(128, mload(add(add(rawResult, 32), add(offset, 16))))
            }

            // Extract timestamp: u64 at bytes [offset+56..offset+64] (big-endian)
            uint64 rawTimestamp;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                rawTimestamp := shr(192, mload(add(add(rawResult, 32), add(offset, 56))))
            }

            if (rawTimestamp == 0) revert InvalidResult("Zero timestamp in oracle output");

            priceInfos[i] = PythAdapterStorage.PriceInfo({
                publishTime: rawTimestamp,
                expo: feedConfigs[i].expo,
                price: int64(uint64(rawPrice)),
                conf: 0,
                emaPrice: int64(uint64(rawPrice)),
                emaConf: 0
            });
        }
    }
}
