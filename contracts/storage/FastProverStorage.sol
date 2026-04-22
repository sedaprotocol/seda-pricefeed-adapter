// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FastProverStorage
/// @author Open Oracle Association
/// @notice Storage library for FastProver using the ERC-7201 storage pattern.
/// @dev Storage layout for trusted keys management in FastProver, separate from other contracts.
/// @custom:storage-location fastprover.storage.v1
library FastProverStorage {
    // ============ Constants ============

    /// @notice ERC-7201 storage slot for FastProverStorage (version 1)
    /// @dev Namespace: "fastprover.storage.v1"
    ///      ERC-7201 calculation: keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT_V1 =
        keccak256(abi.encode(uint256(keccak256("fastprover.storage.v1")) - 1)) & ~bytes32(uint256(0xff));

    // ============ Structs ============

    /// @notice Storage layout for FastProverStorage (v1)
    /// @dev Do not change the order of fields. For new fields, create a new versioned layout.
    struct Layout {
        /// @notice Mapping of trusted public keys to their enabled status
        mapping(address => bool) trustedKeys;
        /// @notice Array of all trusted public keys for enumeration
        address[] trustedKeysList;
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
