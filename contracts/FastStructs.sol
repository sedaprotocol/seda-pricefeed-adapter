// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FastStructs
/// @author Open Oracle Association
/// @notice Structs for FastAdapter
/// @dev Contains the structs for FastAdapter
library FastStructs {
    /// @notice Struct for submitting signed data to the contract
    /// @dev `data` is an ABI-encoded SedaDataTypes.Result, `signature` is the SEDA FAST ECDSA signature
    struct SignedPayload {
        bytes data;
        bytes signature;
    }

    /// @notice Struct containing configuration for execution and tally programs
    /// @dev Used to specify the program IDs and tally input parameters for a price feed update
    struct ProgramConfig {
        bytes32 execProgramId;
        bytes32 tallyProgramId;
    }
}
