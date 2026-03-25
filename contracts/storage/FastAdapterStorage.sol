// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FastAdapterStorage
/// @author Open Oracle Association
/// @notice Storage library for FastAdapter using the ERC-7201 storage pattern.
/// @dev Storage layout for oracle-specific data in FastAdapter, separate from generic Pyth storage.
/// @custom:storage-location fastadapter.storage.v1
library FastAdapterStorage {
    // ============ Constants ============

    /// @notice ERC-7201 storage slot for FastAdapterStorage (version 1)
    /// @dev Namespace: "fastadapter.storage.v1"
    ///      ERC-7201 calculation: keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT_V1 =
        keccak256(abi.encode(uint256(keccak256("fastadapter.storage.v1")) - 1)) & ~bytes32(uint256(0xff));

    // ============ Structs ============

    /// @notice Storage layout for FastAdapterStorage (v1)
    /// @dev Do not change the order of fields. For new fields, create a new versioned layout.
    struct Layout {
        /// @notice The oracle prover contract used for result verification
        /// @dev Generic name to support different oracle types (SEDA, Chainlink, etc.)
        address sedaProver;
        /// @notice Allowed oracle program configs keyed by keccak256(abi.encode(execProgramId, tallyProgramId))
        mapping(bytes32 => bool) allowedProgramConfigs;
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
