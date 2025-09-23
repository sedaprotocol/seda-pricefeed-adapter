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

    /// @notice Struct for updating price feeds with multiple results
    /// @dev Contains the execution inputs, configuration, and oracle results for batch updates
    struct PriceUpdateBatch {
        ProgramConfig programConfig;
        SedaDataTypes.Result result;
    }
}
