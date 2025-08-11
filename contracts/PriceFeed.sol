// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AggregatorV2V3Interface} from "./interfaces/AggregatorV2V3Interface.sol";

/// @title PriceFeed
/// @author Open Oracle Association
/// @notice A price feed contract implementing the AggregatorV2V3Interface for seamless DeFi integration
/// @dev This contract is designed to be used as an implementation for EIP-1167 minimal proxies.
///      Each proxy instance maintains its own price data while sharing the same contract logic.
///      Only the designated updater address can modify price data to ensure data integrity.
contract PriceFeed is AggregatorV2V3Interface {
    // ============ Custom Errors ============
    /// @notice Thrown when attempting to initialize a contract that has already been initialized
    error AlreadyInitialized();
    /// @notice Thrown when attempting to access historical data which is not supported by this implementation
    error HistoricalDataUnsupported();
    /// @notice Thrown when attempting to set the updater address to the zero address
    error InvalidUpdaterAddress();
    /// @notice Thrown when attempting to access price data before any updates have been made
    error NoDataAvailable();
    /// @notice Thrown when attempting to update with a timestamp that is not newer than the previous update
    /// @param provided The timestamp provided in the update attempt
    /// @param latest The timestamp of the most recent update
    error StaleResult(uint256 provided, uint256 latest);
    /// @notice Thrown when a function is called by an unauthorized address
    /// @param caller The address that attempted to call the function
    /// @param expected The address that is authorized to call the function
    error Unauthorized(address caller, address expected);

    // ============ State Variables ============

    /// @notice The address authorized to update this price feed's data
    address public updater;
    /// @notice Tracks whether this contract instance has been initialized (prevents re-initialization)
    bool public initialized;

    // Price feed data
    /// @notice Human-readable description of what this price feed represents (e.g., "ETH/USD")
    string public override description;
    /// @notice Number of decimal places in the price data (e.g., 8 for $1.23456789)
    uint8 public override decimals;

    // Latest price data
    /// @notice The most recent price value reported by the oracle
    int256 public latestAnswer;
    /// @notice Unix timestamp when the latest price was reported
    uint256 public latestTimestamp;
    /// @notice Sequential identifier for the latest price update round
    uint80 public latestRoundId;

    // ============ Modifiers ============

    /// @notice Ensures the contract can only be initialized once
    modifier onlyOnce() {
        if (initialized) revert AlreadyInitialized();
        _;
        initialized = true;
    }

    /// @notice Restricts function access to the designated updater address only
    modifier onlyUpdater() {
        if (msg.sender != updater) revert Unauthorized(msg.sender, updater);
        _;
    }

    // ============ Initialization ============

    /// @notice Initializes a new price feed instance (replaces constructor for proxy pattern)
    /// @dev This function can only be called once per proxy instance
    /// @param _updater The address authorized to update price data for this feed
    /// @param _description Human-readable description of the price pair (e.g., "BTC/USD")
    /// @param _decimals Number of decimal places for price precision (typically 8 or 18)
    function initialize(
        address _updater,
        string calldata _description,
        uint8 _decimals
    ) external onlyOnce {
        if (_updater == address(0)) revert InvalidUpdaterAddress();
        updater = _updater;
        description = _description;
        decimals = _decimals;
    }

    // ============ Core Functions ============

    /// @notice Updates the price feed with new oracle data
    /// @dev Only callable by the designated updater address. Validates timestamp ordering to prevent stale data.
    /// @param value The new price value (can be negative for certain asset types)
    /// @param timestamp Unix timestamp when this price was observed (must be newer than previous update)
    function updateResult(
        int256 value,
        uint256 timestamp
    ) external onlyUpdater {
        // solhint-disable-next-line gas-strict-inequalities
        if (timestamp <= latestTimestamp)
            revert StaleResult(timestamp, latestTimestamp);

        latestAnswer = value;
        latestTimestamp = timestamp;
        ++latestRoundId;

        emit AnswerUpdated(value, latestRoundId, timestamp);
        emit NewRound(latestRoundId, msg.sender, timestamp);
    }

    // AggregatorV3Interface functions
    /// @notice Returns the latest round data
    /// @dev Reverts with NoDataAvailable if the price feed has not been initialized with any data
    /// @return roundId The latest round ID
    /// @return answer The latest answer
    /// @return startedAt The timestamp when the latest round started
    /// @return updatedAt The timestamp when the latest round was updated
    /// @return answeredInRound The round ID in which the latest answer was computed
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        if (latestTimestamp == 0) revert NoDataAvailable();

        return (
            latestRoundId,
            latestAnswer,
            latestTimestamp,
            latestTimestamp,
            latestRoundId
        );
    }

    /// @notice Returns historical round data (not supported)
    /// @dev This implementation does not store historical data and always reverts
    /// @param _roundId The round ID to get data for
    /// @return roundId The round ID
    /// @return answer The answer for the round
    /// @return startedAt The timestamp when the round started
    /// @return updatedAt The timestamp when the round was updated
    /// @return answeredInRound The round ID in which the answer was computed
    function getRoundData(
        uint80 _roundId
    )
        external
        pure
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        _roundId; // Suppress unused variable warning
        revert HistoricalDataUnsupported();
    }

    // AggregatorInterface functions
    /// @notice Returns the latest round ID
    /// @dev Returns 0 if no price updates have been made yet
    /// @return The latest round ID
    function latestRound() external view override returns (uint256) {
        return latestRoundId;
    }

    /// @notice Returns the answer for a specific round ID (not supported)
    /// @dev This implementation does not store historical data and always reverts
    /// @param roundId The round ID to get the answer for
    /// @return The answer for the given round ID
    function getAnswer(
        uint256 roundId
    ) external pure override returns (int256) {
        roundId; // Suppress unused variable warning
        revert HistoricalDataUnsupported();
    }

    /// @notice Returns the timestamp for a specific round ID (not supported)
    /// @dev This implementation does not store historical data and always reverts
    /// @param roundId The round ID to get the timestamp for
    /// @return The timestamp for the given round ID
    function getTimestamp(
        uint256 roundId
    ) external pure override returns (uint256) {
        roundId; // Suppress unused variable warning
        revert HistoricalDataUnsupported();
    }

    /// @notice Returns the version number of the interface implementation
    /// @return The version number (always 0)
    function version() external pure override returns (uint256) {
        return 0;
    }
}
