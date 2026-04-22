// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseUpgradeable} from "./base/BaseUpgradeable.sol";
import {BasePythAdapter} from "./base/BasePythAdapter.sol";
import {FastProver} from "./provers/FastProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";
import {PythStructs} from "./interfaces/pyth/PythStructs.sol";

import {PythAdapterStorage} from "./storage/PythAdapterStorage.sol";
import {FastAdapterStorage} from "./storage/FastAdapterStorage.sol";

/// @title FastAdapter
/// @author Open Oracle Association
/// @notice SEDA Price Feed Adapter implementing IPyth interface for managing SEDA oracle price feeds.
/// @dev Verifies SEDA FAST signatures over `deriveResultId(result)` and maintains a registry of
///      price feeds keyed by `feedId = keccak256(abi.encode(drId, symbolId))`. The oracle program's
///      tally output is ABI-encoded as `SedaPriceUpdate[]` (raw Pyth feed id plus the Pyth-shaped
///      `PriceInfo`). Uses ERC-7201 namespaced storage and UUPS upgrade pattern. Pausable for
///      emergencies.
///
///      Interim feed identity model. The feedId shape used here is tied to the `drId`, which itself
///      commits to the full `execInputs` (the batch symbol list). Any change to the batch produces
///      a new `drId` and therefore new `feedId`s for every symbol in it; consumers integrating this
///      version effectively hard-code a fixed batch. A future signature scheme will replace this
///      derivation and consumers will need to migrate their hard-coded feedIds at that point.
/// @custom:security Inherits BaseUpgradeable and BasePythAdapter. Only the owner can perform admin
///                  actions. Oracle result authenticity is enforced via FastProver; the adapter
///                  additionally requires consensus and a zero exit code on every accepted result.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract FastAdapter is BaseUpgradeable, BasePythAdapter {
    // ============ Structs ============

    /// @notice Wire-format of a signed oracle result submitted to the adapter
    /// @dev `data` is an ABI-encoded `SedaDataTypes.Result`; `signature` is the SEDA FAST ECDSA
    ///      signature over `deriveResultId(result)`.
    struct SignedPayload {
        bytes data;
        bytes signature;
    }

    /// @notice Struct containing the per-symbol identifier and the decoded price information.
    /// @dev ABI-encoded by the oracle program's tally phase and decoded by this contract.
    ///      `symbolId` is the per-asset/per-symbol identifier chosen by the oracle program (for
    ///      Pyth-compatible deployments this is the Pyth price feed id). The feedId used for
    ///      storage is computed as `keccak256(abi.encode(drId, symbolId))`.
    struct SedaPriceUpdate {
        bytes32 symbolId;
        PythAdapterStorage.PriceInfo priceInfo;
    }

    // ============ Events ============

    /// @notice Emitted when the SEDA prover address is updated by the owner
    event ProverUpdated(address indexed oldProver, address indexed newProver);

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

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
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

    /// @notice Verifies + decodes a signed payload and returns feedIds with their decoded prices
    /// @param updateData The update data (SignedPayload with ABI-encoded Result + SEDA FAST signature)
    /// @return ids feedIds computed as `keccak256(abi.encode(drId, symbolId))`
    /// @return infos Decoded price infos from the oracle output
    function _processUpdateData(
        bytes calldata updateData
    ) internal view override returns (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) {
        (bytes32 drId, SedaPriceUpdate[] memory ups) = _verifyAndDecode(updateData);

        ids = new bytes32[](ups.length);
        infos = new PythAdapterStorage.PriceInfo[](ups.length);

        for (uint256 i = 0; i < ups.length; ++i) {
            ids[i] = _computeFeedId(drId, ups[i].symbolId);
            infos[i] = ups[i].priceInfo;
        }
    }

    // ============ SEDA-Specific Implementation ============

    /// @notice Computes the feedId from the data request id and the per-symbol identifier
    /// @dev `feedId = keccak256(abi.encode(drId, symbolId))`. Namespacing by `drId` means that
    ///      changing the underlying batch definition (which changes the `drId`) rekeys every feed
    ///      in it.
    function _computeFeedId(bytes32 drId, bytes32 symbolId) private pure returns (bytes32) {
        return keccak256(abi.encode(drId, symbolId));
    }

    /// @notice Verifies a SignedPayload using SEDA FAST signature and decodes the oracle output
    /// @dev Flow:
    ///      1. Decode `SignedPayload { data, signature }`
    ///      2. Decode `data` as `SedaDataTypes.Result`
    ///      3. Verify signature against `deriveResultId(result)` via FastProver
    ///      4. Enforce `result.consensus == true` and `result.exitCode == 0`
    ///      5. ABI-decode `result.result` as `SedaPriceUpdate[]` (must be non-empty)
    function _verifyAndDecode(
        bytes calldata signedPayload
    ) private view returns (bytes32 drId, SedaPriceUpdate[] memory updates) {
        SignedPayload memory payload = abi.decode(signedPayload, (SignedPayload));

        SedaDataTypes.Result memory result = abi.decode(payload.data, (SedaDataTypes.Result));

        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        FastProver(getProver()).verifyData(resultId, payload.signature);

        if (!result.consensus) revert InvalidResult("Oracle result not in consensus");
        if (result.exitCode != 0) revert InvalidResult("Oracle execution failed");

        updates = abi.decode(result.result, (SedaPriceUpdate[]));
        if (updates.length == 0) revert InvalidResult("No price updates found in batch");

        drId = result.drId;
    }
}
