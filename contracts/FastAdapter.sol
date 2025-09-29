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
    // ============ Structs ============

    /// @notice Struct containing the raw Pyth feed ID and the decoded price information.
    /// @dev WARNING: `rawId` is the Pyth feed ID. The GLOBAL asset ID used for storage in this contract
    ///      is computed as keccak256(abi.encode(execProgramId, tallyProgramId, rawId)).
    struct SedaPriceUpdate {
        bytes32 rawId;
        PythAdapterStorage.PriceInfo priceInfo;
    }

    // ============ Events ============

    /// @notice Emitted when the SEDA prover address is updated by the owner
    /// @param oldProver The previous prover contract address
    /// @param newProver The new prover contract address
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    // ============ Initialization ============

    /// @notice Initializes the FastAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param owner Address that will have administrative privileges over the adapter
    function initialize(address sedaProverAddress, address owner) public initializer {
        if (sedaProverAddress == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __BaseUpgradeable_init(owner);

        FastAdapterStorage.Layout storage s = FastAdapterStorage.layout();
        s.sedaProver = sedaProverAddress;
    }

    // ============ External Functions ============

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyOwner onlyProxy {
        if (newProver == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        FastAdapterStorage.Layout storage s = FastAdapterStorage.layout();
        address oldProver = s.sedaProver;
        s.sedaProver = newProver;
        emit ProverUpdated(oldProver, newProver);
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    /// @return The address of the SEDA prover contract
    function getProver() public view returns (address) {
        return FastAdapterStorage.layout().sedaProver;
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
    /// @dev Uses SEDA's FastProver to verify, decodes the batch, and maps rawId -> GLOBAL id via `_computePriceId`.
    function _decodeUpdates(
        bytes calldata updateData
    ) internal view override returns (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) {
        (FastStructs.ProgramConfig memory cfg, SedaPriceUpdate[] memory ups, ) = _verifyAndDecode(updateData);

        ids = new bytes32[](ups.length);
        infos = new PythAdapterStorage.PriceInfo[](ups.length);

        for (uint256 i = 0; i < ups.length; ++i) {
            ids[i] = _computePriceId(cfg, ups[i].rawId); // GLOBAL ID = keccak(exec,tally,rawId)
            infos[i] = ups[i].priceInfo; // decoded price fields
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

    /// @notice Verifies a SignedPayload and decodes it into (ProgramConfig, PriceUpdate[], Result)
    /// @param signedPayload The signed payload to verify and decode
    /// @return programConfig The program configuration
    /// @return updates The price updates array
    /// @return result The SEDA result
    function _verifyAndDecode(
        bytes calldata signedPayload
    )
        private
        view
        returns (
            FastStructs.ProgramConfig memory programConfig,
            SedaPriceUpdate[] memory updates,
            SedaDataTypes.Result memory result
        )
    {
        FastStructs.SignedPayload memory payload = abi.decode(signedPayload, (FastStructs.SignedPayload));

        // Validate signature
        bytes32 dataHash = keccak256(payload.data);
        FastProver(getProver()).verifyData(dataHash, payload.signature);

        // Decode the verified data
        FastStructs.PriceUpdateBatch memory batch = abi.decode(payload.data, (FastStructs.PriceUpdateBatch));

        // Validate batch
        if (batch.result.exitCode != 0) revert InvalidResult("Oracle execution failed");

        programConfig = batch.programConfig;
        result = batch.result;
        updates = abi.decode(batch.result.result, (SedaPriceUpdate[]));

        // Validate updates after decoding
        if (updates.length == 0) revert InvalidResult("No price updates found in batch");
    }
}
