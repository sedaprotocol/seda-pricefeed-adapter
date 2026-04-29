// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseUpgradeable} from "./BaseUpgradeable.sol";
import {FastProver} from "../prover/FastProver.sol";
import {SedaDataTypes} from "../prover/SedaDataTypes.sol";
import {SedaAdapterStorage} from "./SedaAdapterStorage.sol";

/// @title BaseSedaAdapter
/// @author Open Oracle Association
/// @notice Shared SEDA verification and decoding logic for price feed adapters.
/// @dev Encapsulates the wire format, signature verification against a `FastProver`, and
///      the canonical `feedId = keccak256(abi.encode(drId, symbolId))` derivation. Subclasses
///      (e.g. Pyth-style) implement the price-feed-specific surface on top.
///
///      Interim feed IDs: `feedId` is derived from `drId`, which depends on the batch symbol list.
///      Changing the batch yields new `drId` and `feedId`s; future signature schemes will change this.
abstract contract BaseSedaAdapter is BaseUpgradeable {
    // ============ Structs ============

    /// @notice Wire-format of a signed oracle result submitted to the adapter
    /// @dev `data` is an ABI-encoded `SedaDataTypes.Result`; `signature` is the SEDA FAST ECDSA
    ///      signature over `deriveResultId(result)`.
    struct SignedPayload {
        bytes data;
        bytes signature;
    }

    // ============ Events ============

    /// @notice Emitted when the SEDA prover address is updated by the owner
    /// @param oldProver Previous FastProver address that was trusted
    /// @param newProver New FastProver address now trusted on this adapter
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    // ============ Errors ============

    /// @notice Thrown when verification or decoding of an oracle result fails
    /// @param reason Human-readable description of the validation failure
    error InvalidResult(string reason);

    // ============ Initialization ============

    /// @notice Initializes SEDA-adapter shared state
    /// @param prover Address of the FastProver contract used for result verification
    /// @param owner Address that will have administrative privileges over the adapter
    // solhint-disable-next-line func-name-mixedcase
    function __BaseSedaAdapter_init(address prover, address owner) internal onlyInitializing {
        if (prover == address(0)) revert ZeroAddressNotAllowed("prover");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __BaseUpgradeable_init(owner);

        SedaAdapterStorage.layout().prover = prover;
    }

    // ============ External Functions ============

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyProxy onlyOwner {
        if (newProver == address(0)) revert ZeroAddressNotAllowed("prover");
        SedaAdapterStorage.Layout storage s = SedaAdapterStorage.layout();
        address oldProver = s.prover;
        s.prover = newProver;
        emit ProverUpdated(oldProver, newProver);
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    function getProver() public view returns (address) {
        return SedaAdapterStorage.layout().prover;
    }

    // ============ Internal Helpers ============

    /// @notice Computes the feedId from the data request id and the per-symbol identifier
    /// @dev `feedId = keccak256(abi.encode(drId, symbolId))`. Namespacing by `drId` means that
    ///      changing the underlying batch definition (which changes the `drId`) rekeys every feed
    ///      in it.
    /// @param drId The SEDA data request id that scopes this execution
    /// @param symbolId The per-symbol identifier carried in each price update entry
    /// @return feedId Canonical feed key for `(drId, symbolId)`
    function _computeFeedId(bytes32 drId, bytes32 symbolId) internal pure returns (bytes32 feedId) {
        return keccak256(abi.encode(drId, symbolId));
    }

    /// @notice Verifies a SignedPayload and returns the verified SEDA Result
    /// @dev Flow:
    ///      1. Decode `SignedPayload { data, signature }`
    ///      2. Decode `data` as `SedaDataTypes.Result`
    ///      3. Verify signature against `deriveResultId(result)` via FastProver
    ///      4. Enforce `result.consensus == true` and `result.exitCode == 0`
    /// @param signedPayload Opaque blob containing `SignedPayload`
    /// @return result The verified SEDA result. Callers are expected to ABI-decode `result.result`
    ///                into the shape emitted by their oracle program.
    function _verifySedaResult(bytes calldata signedPayload)
        internal
        view
        returns (SedaDataTypes.Result memory result)
    {
        SignedPayload memory payload = abi.decode(signedPayload, (SignedPayload));
        result = abi.decode(payload.data, (SedaDataTypes.Result));
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        FastProver(getProver()).verifyData(resultId, payload.signature);

        if (!result.consensus) revert InvalidResult("Oracle result not in consensus");
        if (result.exitCode != 0) revert InvalidResult("Oracle execution failed");
    }
}
