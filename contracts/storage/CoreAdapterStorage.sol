// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title CoreAdapterStorage
/// @author Open Oracle Association
/// @notice Storage library for CoreAdapter contract following ERC-7201 standard
/// @dev This library contains the storage layout, configuration structs, and accessor
///      functions for the CoreAdapter contract. It uses ERC-7201 storage pattern
///      to prevent storage collisions during upgrades and provides a clean interface
///      for accessing contract state variables.
/// @custom:storage-location coreadapter.storage.v1
library CoreAdapterStorage {
    // ============ Constants ============

    /// @notice ERC-7201 storage slot for CoreAdapter contract (version 1)
    /// @dev Namespace: "coreadapter.storage.v1"
    bytes32 internal constant STORAGE_SLOT_V1 =
        keccak256(abi.encode(uint256(keccak256("coreadapter.storage.v1")) - 1)) & ~bytes32(uint256(0xff));

    // ============ Structs ============

    /// @notice Configuration parameters for SEDA price feed execution
    /// @dev Parameters needed for SEDA oracle execution and consensus calculation
    struct PriceFeedConfig {
        /// @notice Identifier of the Execution WASM binary for SEDA oracle execution
        bytes32 execProgramId;
        /// @notice Identifier of the Tally WASM binary for consensus calculation
        bytes32 tallyProgramId;
        /// @notice Number of required DR executors for consensus (replication factor)
        uint16 replicationFactor;
        /// @notice Input parameters for the Tally WASM binary execution
        bytes tallyInputs;
        /// @notice Consensus filter applied before tally execution to validate results
        bytes consensusFilter;
    }

    /// @notice Complete storage layout for CoreAdapter contract (v1)
    /// @dev Keep this layout stable. For new fields, create a new versioned slot and layout.
    struct Layout {
        /// @notice The SEDA SECP256k1 prover contract used for result verification
        address sedaProver;
        /// @notice The implementation contract for PriceFeed proxies (EIP-1167 minimal proxy)
        address priceFeedImplementation;
        /// @notice Mapping from ticker symbol to deployed PriceFeed contract address
        mapping(string => address) priceFeedAddresses;
        /// @notice Array of all registered ticker symbols
        string[] tickers;
        /// @notice Stored configuration for SEDA price feed execution
        PriceFeedConfig priceFeedConfig;
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
