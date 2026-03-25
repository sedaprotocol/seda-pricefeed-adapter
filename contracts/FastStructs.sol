// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";

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

    /// @notice Feed metadata stored on-chain by the owner
    /// @dev Used to map raw oracle output bytes to Pyth-compatible PriceInfo structs
    struct FeedConfig {
        bytes32 rawId; // Pyth feed ID (e.g., USDC/USD Pyth ID)
        int32 expo; // Price exponent (e.g., -8)
    }

    /// @notice Registered data request configuration stored on-chain
    /// @dev Maps a drId to its program config and feed metadata.
    ///      The drId is part of the signed result, so this ties the signature
    ///      to specific program + feed configurations, preventing replay attacks.
    struct DataRequestConfig {
        ProgramConfig programConfig;
        FeedConfig[] feedConfigs;
    }
}
