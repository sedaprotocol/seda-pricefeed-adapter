// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseAdapter} from "./base/BaseAdapter.sol";
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
/// @dev Contract for verifying oracle results and maintaining a registry of asset IDs. Uses ERC-7201 storage layout
///      for upgrade safety and UUPS upgrade pattern. Pausable for emergencies.
/// @custom:security Inherits BaseAdapter. Only the owner can perform admin actions.
///                  Oracle result validation is enforced.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract FastAdapter is BaseAdapter, BasePythAdapter {
    /// @notice Struct containing the price feed ID and the price information.
    /// @dev WARNING: The `id` here is NOT the global asset ID under which the price is stored in this contract.
    /// The global asset ID is computed as keccak256(abi.encode(execProgramId, tallyProgramId, id)).
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

    /// @notice Initializes the PriceFeedAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param owner Address that will have administrative privileges over the adapter
    function initialize(address sedaProverAddress, address owner) public initializer {
        if (sedaProverAddress == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __BaseAdapter_init(owner);

        FastAdapterStorage.Layout storage s = FastAdapterStorage.layout();
        s.sedaProver = sedaProverAddress;
    }

    // ============ External Functions ============

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyOwner onlyProxy {
        if (newProver == address(0)) revert ZeroAddressNotAllowed("prover");
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

    /// @notice Processes a signed payload with optional storage update
    /// @param signedPayload The signed payload to process
    /// @param updateStorage Whether to update storage or just parse
    function _processSignedPayload(bytes calldata signedPayload, bool updateStorage) internal override whenNotPaused {
        (FastStructs.ProgramConfig memory cfg, SedaPriceUpdate[] memory ups, ) = _verifyAndDecode(signedPayload);
        if (updateStorage) {
            for (uint256 i = 0; i < ups.length; ++i) {
                _applyUpdate(_computePriceId(cfg, ups[i].rawId), ups[i].priceInfo, /*strict=*/ false);
            }
        }
    }

    // ============ SEDA-Specific Implementation ============

    /// @notice Processes filtered update data for SEDA with validation and filtering
    /// @param updateData The update data to process
    /// @param priceIds The price IDs to process
    /// @param minPublishTime The minimum publish time
    /// @param maxPublishTime The maximum publish time
    /// @param checkUniqueness Whether to check uniqueness
    /// @param updateStorage Whether to update storage
    /// @param priceFeeds The price feeds to update
    /// @param matchCounts The match counts
    /// @return The number of updates processed
    function _processFilteredUpdates(
        bytes calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        bool checkUniqueness,
        bool updateStorage,
        PythStructs.PriceFeed[] memory priceFeeds,
        uint256[] memory matchCounts
    ) internal override returns (uint64) {
        (FastStructs.ProgramConfig memory cfg, SedaPriceUpdate[] memory priceUpdates, ) = _verifyAndDecode(updateData);

        for (uint256 i = 0; i < priceUpdates.length; ++i) {
            bytes32 priceId = _computePriceId(cfg, priceUpdates[i].rawId);
            _processPriceUpdate(
                priceId,
                priceUpdates[i].priceInfo,
                priceIds,
                minPublishTime,
                maxPublishTime,
                priceFeeds,
                updateStorage,
                checkUniqueness,
                matchCounts
            );
        }

        // Minimality counts *all* updates present in this blob (like Pyth's numUpdates)
        return uint64(priceUpdates.length);
    }

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
    ) internal pure returns (bytes32) {
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
        internal
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
        (bool valid, ) = FastProver(getProver()).verifyData(dataHash, payload.signature);
        if (!valid) revert ValidationFailed("Signature verification failed");

        // Decode the verified data
        FastStructs.PriceUpdateBatch memory batch = abi.decode(payload.data, (FastStructs.PriceUpdateBatch));

        // Validate batch
        if (batch.result.exitCode != 0) revert ValidationFailed("Oracle execution failed");

        programConfig = batch.programConfig;
        result = batch.result;
        updates = abi.decode(batch.result.result, (SedaPriceUpdate[]));

        // Validate updates after decoding
        if (updates.length == 0) revert ValidationFailed("No price updates found in batch");
    }
}
