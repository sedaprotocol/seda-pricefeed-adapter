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
/// @dev Verifies SEDA FAST signatures over Result structs and maintains a registry of price feeds
///      using GLOBAL IDs derived from (exec, tally, rawId). The oracle program outputs ABI-encoded
///      SedaPriceUpdate[] containing full Pyth-compatible price data (price, conf, expo, EMA).
///      Uses ERC-7201 namespaced storage and UUPS upgrade pattern. Pausable for emergencies.
/// @custom:security Inherits BaseUpgradeable and BasePythAdapter. Only the owner can perform admin actions.
///                  Oracle result validation is enforced via FastProver.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract FastAdapter is BaseUpgradeable, BasePythAdapter {
    // ============ Structs ============

    /// @notice Struct containing the raw Pyth feed ID and the decoded price information.
    /// @dev ABI-encoded by the oracle program's tally phase and decoded by this contract.
    ///      The GLOBAL asset ID used for storage is computed as keccak256(execProgramId, tallyProgramId, rawId).
    struct SedaPriceUpdate {
        bytes32 rawId;
        PythAdapterStorage.PriceInfo priceInfo;
    }

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
    /// @dev The drId ties the signed result to specific program IDs.
    ///      Only results with a registered drId will be accepted.
    /// @param drId The data request ID (derived from oracle program params)
    /// @param programConfig The execution and tally program IDs
    function registerDataRequest(
        bytes32 drId,
        FastStructs.ProgramConfig calldata programConfig
    ) external onlyProxy onlyOwner {
        if (programConfig.execProgramId == bytes32(0)) revert InvalidResult("execProgramId is zero");
        if (programConfig.tallyProgramId == bytes32(0)) revert InvalidResult("tallyProgramId is zero");

        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[drId];
        entry.registered = true;
        entry.programConfig = programConfig;

        emit DataRequestRegistered(drId, programConfig.execProgramId, programConfig.tallyProgramId);
    }

    /// @notice Unregisters a data request configuration (owner only)
    /// @param drId The data request ID to unregister
    function unregisterDataRequest(bytes32 drId) external onlyProxy onlyOwner {
        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[drId];
        if (!entry.registered) revert InvalidResult("drId not registered");

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
    /// @return ids GLOBAL price IDs (keccak256(exec, tally, rawId))
    /// @return infos Decoded price infos from oracle output
    function _processUpdateData(
        bytes calldata updateData
    ) internal view override returns (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) {
        (FastStructs.ProgramConfig memory cfg, SedaPriceUpdate[] memory ups) = _verifyAndDecode(updateData);

        ids = new bytes32[](ups.length);
        infos = new PythAdapterStorage.PriceInfo[](ups.length);

        for (uint256 i = 0; i < ups.length; ++i) {
            ids[i] = _computePriceId(cfg, ups[i].rawId);
            infos[i] = ups[i].priceInfo;
        }
    }

    // ============ SEDA-Specific Implementation ============

    /// @notice Computes the global price ID from SEDA program configuration and raw feed ID
    /// @dev The global price ID is keccak256(abi.encode(execProgramId, tallyProgramId, rawId)).
    ///      This namespaces feeds by oracle program, allowing different programs to coexist.
    function _computePriceId(
        FastStructs.ProgramConfig memory programConfig,
        bytes32 rawId
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(programConfig.execProgramId, programConfig.tallyProgramId, rawId));
    }

    /// @notice Verifies a SignedPayload using SEDA FAST signature and decodes ABI-encoded oracle output
    /// @dev Flow:
    ///      1. Decode SignedPayload { data (ABI-encoded Result), signature }
    ///      2. Decode data as SedaDataTypes.Result
    ///      3. Verify signature against deriveResultId(result) via FastProver
    ///      4. Look up result.drId in registry → get programConfig
    ///      5. ABI-decode result.result as SedaPriceUpdate[]
    function _verifyAndDecode(
        bytes calldata signedPayload
    ) private view returns (FastStructs.ProgramConfig memory programConfig, SedaPriceUpdate[] memory updates) {
        FastStructs.SignedPayload memory payload = abi.decode(signedPayload, (FastStructs.SignedPayload));

        // Decode the Result from payload.data
        SedaDataTypes.Result memory result = abi.decode(payload.data, (SedaDataTypes.Result));

        // Verify signature against deriveResultId (matches what SEDA FAST signed)
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        FastProver(getProver()).verifyData(resultId, payload.signature);

        // Validate execution succeeded
        if (result.exitCode != 0) revert InvalidResult("Oracle execution failed");

        // Look up drId in registry
        FastAdapterStorage.DrIdEntry storage entry = FastAdapterStorage.layout().drIdRegistry[result.drId];
        if (!entry.registered) revert InvalidResult("drId not registered");

        programConfig = entry.programConfig;

        // ABI-decode the oracle program's tally output as SedaPriceUpdate[]
        updates = abi.decode(result.result, (SedaPriceUpdate[]));
        if (updates.length == 0) revert InvalidResult("No price updates found in batch");
    }
}
