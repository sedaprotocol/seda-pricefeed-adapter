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
/// @dev Verifies SEDA results and maintains a registry of price feeds using GLOBAL IDs derived from (exec,tally,rawId).
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
    /// @param oldProver The previous prover contract address
    /// @param newProver The new prover contract address
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    /// @notice Emitted when a program config is allowed or disallowed
    /// @param execProgramId The execution program ID
    /// @param tallyProgramId The tally program ID
    /// @param allowed Whether the program config is now allowed
    event ProgramConfigUpdated(bytes32 indexed execProgramId, bytes32 indexed tallyProgramId, bool allowed);

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

    /// @notice Allows or disallows an oracle program config (owner only)
    /// @param execProgramId The execution program ID
    /// @param tallyProgramId The tally program ID
    /// @param allowed Whether the program config should be allowed
    function setProgramConfig(
        bytes32 execProgramId,
        bytes32 tallyProgramId,
        bool allowed
    ) external onlyProxy onlyOwner {
        bytes32 key = keccak256(abi.encode(execProgramId, tallyProgramId));
        FastAdapterStorage.layout().allowedProgramConfigs[key] = allowed;
        emit ProgramConfigUpdated(execProgramId, tallyProgramId, allowed);
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    /// @return The address of the SEDA prover contract
    function getProver() public view returns (address) {
        return FastAdapterStorage.layout().sedaProver;
    }

    /// @notice Checks if a program config is allowed
    /// @param execProgramId The execution program ID
    /// @param tallyProgramId The tally program ID
    /// @return Whether the program config is allowed
    function isProgramConfigAllowed(bytes32 execProgramId, bytes32 tallyProgramId) public view returns (bool) {
        bytes32 key = keccak256(abi.encode(execProgramId, tallyProgramId));
        return FastAdapterStorage.layout().allowedProgramConfigs[key];
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
        // Block only when this call would mutate state
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
    /// @param updateData The update data (signed/encoded) to verify and decode
    /// @return ids GLOBAL price IDs (already mapped from raw Pyth IDs)
    /// @return infos Decoded price infos corresponding to each id
    /// @dev Uses SEDA's FastProver to verify the SEDA FAST signature via deriveResultId,
    ///      then decodes raw oracle output bytes using feedConfigs for metadata (rawId, expo).
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
    /// @dev CRITICAL: This function defines how SEDA price IDs are constructed and must remain consistent.
    ///      The global price ID is computed as keccak256(abi.encode(execProgramId, tallyProgramId, rawId)).
    ///      This ensures price IDs are unique per program pair, allowing multiple SEDA programs
    ///      to coexist with the same raw feed IDs without conflicts.
    /// @param programConfig The SEDA program configuration containing exec and tally program IDs
    /// @param rawId The raw feed ID from the SEDA oracle result
    /// @return The computed global price ID for storage and retrieval
    function _computePriceId(
        FastStructs.ProgramConfig memory programConfig,
        bytes32 rawId
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(programConfig.execProgramId, programConfig.tallyProgramId, rawId));
    }

    /// @notice Verifies a SignedPayload using SEDA FAST signature and decodes raw oracle output
    /// @param signedPayload The signed payload to verify and decode
    /// @return programConfig The program configuration
    /// @return feedConfigs The feed metadata (rawId, expo) provided by the relayer
    /// @return priceInfos The decoded price information from raw oracle output
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

        // Decode the batch first (needed to compute deriveResultId)
        FastStructs.PriceUpdateBatch memory batch = abi.decode(payload.data, (FastStructs.PriceUpdateBatch));

        // Verify signature against deriveResultId (matches what SEDA FAST signed)
        bytes32 resultId = SedaDataTypes.deriveResultId(batch.result);
        FastProver(getProver()).verifyData(resultId, payload.signature);

        // Validate batch outcome:
        // - exitCode == 0 implies consensus & successful tally execution
        if (batch.result.exitCode != 0) revert InvalidResult("Oracle execution failed");

        // Validate the program config is allowed
        programConfig = batch.programConfig;
        bytes32 programKey = keccak256(
            abi.encode(programConfig.execProgramId, programConfig.tallyProgramId)
        );
        if (!FastAdapterStorage.layout().allowedProgramConfigs[programKey]) {
            revert InvalidResult("Program config not allowed");
        }
        feedConfigs = batch.feedConfigs;

        // Decode raw oracle output bytes using feedConfigs
        priceInfos = _decodeRawResult(batch.result.result, feedConfigs);
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
        if (feedConfigs.length == 0) revert InvalidResult("No feed configs provided");
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
                // rawResult is a bytes memory, so data starts at rawResult+32
                // We want 16 bytes (u128) starting at offset+16
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
