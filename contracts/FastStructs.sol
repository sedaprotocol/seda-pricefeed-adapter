// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";

/// @title FastStructs
/// @author Open Oracle Association
/// @notice Structs for FastAdapter
/// @dev Contains the structs for FastAdapter
library FastStructs {
    /// @notice Struct for submitting signed data to the contract
    /// @dev Used for passing data and its corresponding signature for verification
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

    /// @notice Feed metadata provided by the relayer (not covered by SEDA FAST signature)
    /// @dev Used to map raw oracle output bytes to Pyth-compatible PriceInfo structs
    struct FeedConfig {
        bytes32 rawId; // Pyth feed ID (e.g., USDC/USD Pyth ID)
        int32 expo; // Price exponent (e.g., -8)
    }

    /// @notice Struct for updating price feeds with multiple results
    /// @dev Contains the program config, signed SEDA result, and unsigned feed metadata.
    ///      Only `result` is covered by the SEDA FAST signature (via deriveResultId).
    ///      `feedConfigs` is provided by the relayer to map raw result bytes to price feeds.
    struct PriceUpdateBatch {
        ProgramConfig programConfig;
        SedaDataTypes.Result result;
        FeedConfig[] feedConfigs;
    }
}
