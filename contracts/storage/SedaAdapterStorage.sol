// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SedaAdapterStorage
/// @author Open Oracle Association
/// @notice Storage library for SEDA-aware adapters using the ERC-7201 storage pattern.
/// @dev Holds state shared by any adapter that verifies SEDA FAST oracle results (prover address,
///      future extensions). Decoupled from any concrete price-feed interface so both Pyth-style
///      and Chainlink-style adapters can reuse it.
/// @custom:storage-location sedaadapter.storage.v1
library SedaAdapterStorage {
    // ============ Constants ============

    /// @notice ERC-7201 storage slot for SedaAdapterStorage (version 1)
    /// @dev Namespace: "sedaadapter.storage.v1"
    ///      ERC-7201 calculation: keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT_V1 =
        keccak256(abi.encode(uint256(keccak256("sedaadapter.storage.v1")) - 1)) & ~bytes32(uint256(0xff));

    // ============ Structs ============

    /// @notice Storage layout for SedaAdapterStorage (v1)
    /// @dev Do not change the order of fields. For new fields, create a new versioned layout.
    struct Layout {
        /// @notice The SEDA prover contract used for result verification
        address sedaProver;
    }

    // ============ Functions ============

    /// @notice Returns the storage struct at the ERC-7201 storage slot
    /// @return s The storage struct containing the contract's state variables
    /// @dev Accesses the contract's storage layout using assembly based on the ERC-7201 slot.
    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = STORAGE_SLOT_V1;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            s.slot := slot
        }
    }
}
