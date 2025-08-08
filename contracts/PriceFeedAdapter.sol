// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProver} from "@seda-protocol/evm/contracts/interfaces/IProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SedaPriceFeed} from "./SedaPriceFeed.sol";

/// @title PriceFeedAdapter
/// @author Open Oracle Association
/// @notice A comprehensive adapter contract for managing SEDA oracle price feeds with factory, registry, and verification capabilities
/// @dev This contract serves as a central hub for creating and managing SedaPriceFeed proxy instances using EIP-1167 minimal proxies,
///      verifying oracle results using SEDA's consensus mechanism, and maintaining a registry of active price feeds by ticker symbol.
contract PriceFeedAdapter is Ownable {
    /// @notice Configuration parameters for SEDA price feed execution
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

    /// @notice Parameters for updating price feed data
    struct UpdateParams {
        /// @notice Amount of SEDA tokens per gas unit for execution
        uint128 gasPrice;
        /// @notice Maximum gas units allowed for DR Execution phase
        uint64 execGasLimit;
        /// @notice Maximum gas units allowed for DR Tally phase
        uint64 tallyGasLimit;
        /// @notice Input parameters for Execution WASM binary (contains ticker symbols)
        bytes execInputs;
        /// @notice Public metadata attached to the data request
        bytes memo;
    }

    // ============ Custom Errors ============

    /// @notice Thrown when attempting to set an invalid prover address (zero address)
    error InvalidProverAddress();
    /// @notice Thrown when attempting to set an invalid implementation address (zero address)
    error InvalidImplementationAddress();
    /// @notice Thrown when validation fails during result processing
    /// @param reason Human-readable description of the validation failure
    error ValidationFailed(string reason);

    // ============ Events ============

    /// @notice Emitted when a result is successfully verified and processed
    /// @param requestId The unique identifier of the data request
    /// @param symbol The trading symbol (e.g., "ETH/USD")
    /// @param price The decoded price value as a signed integer
    /// @param blockHeight The height of the SEDA batch containing the result
    /// @param batchSender The address that posted the batch to the blockchain
    event ResultVerified(
        bytes32 indexed requestId,
        string indexed symbol,
        int256 price,
        uint64 blockHeight,
        address indexed batchSender
    );

    /// @notice Emitted when a new price feed is created and registered
    /// @param ticker The trading symbol (e.g., "ETH/USD")
    /// @param feedAddress The deployed address of the SedaPriceFeed contract
    /// @param decimals The number of decimal places for price precision
    event PriceFeedCreated(
        string indexed ticker,
        address indexed feedAddress,
        uint8 indexed decimals
    );

    /// @notice Emitted when the SEDA prover address is updated by the owner
    /// @param oldProver The previous prover contract address
    /// @param newProver The new prover contract address
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    /// @notice Emitted when attempting to create a duplicate price feed for an existing ticker
    /// @param ticker The trading symbol that already has a price feed
    /// @param existingAddress The address of the existing price feed contract
    event DuplicateFeedAttempt(
        string indexed ticker,
        address indexed existingAddress
    );

    // ============ State Variables ============

    /// @notice The SEDA SECP256k1 prover contract used for result verification
    IProver public sedaProver;

    /// @notice The implementation contract for SedaPriceFeed proxies (EIP-1167 minimal proxy)
    SedaPriceFeed public implementation;

    /// @notice Mapping from ticker symbol to deployed SedaPriceFeed contract address
    mapping(string => address) public priceFeedAddresses;

    /// @notice Array of all registered ticker symbols
    string[] public tickers;

    /// @notice Default number of decimal places for price data precision
    uint8 public constant DEFAULT_DECIMALS = 6;

    /// @notice Stored configuration for SEDA price feed execution
    PriceFeedConfig public priceFeedConfig;

    // ============ Constructor ============

    /// @notice Initializes the PriceFeedAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param implementationAddress Address of the SedaPriceFeed implementation contract for proxy creation
    /// @param owner Address that will have administrative privileges over the adapter
    /// @param _priceFeedConfig Configuration parameters for SEDA oracle execution
    constructor(
        address sedaProverAddress,
        address implementationAddress,
        address owner,
        PriceFeedConfig memory _priceFeedConfig
    ) Ownable(owner) {
        if (sedaProverAddress == address(0)) revert InvalidProverAddress();
        if (implementationAddress == address(0))
            revert InvalidImplementationAddress();

        sedaProver = IProver(sedaProverAddress);
        implementation = SedaPriceFeed(implementationAddress);
        priceFeedConfig = _priceFeedConfig; // Store the inputs
    }

    // ============ Core Functions ============

    /// @notice Submits and verifies an oracle result, automatically deploying price feeds as needed
    /// @param updateParams Runtime parameters for the price feed update including gas limits and inputs
    /// @param result The oracle result data containing consensus information and price data
    /// @param batchHeight The height of the SEDA batch containing the result
    /// @param merkleProof The Merkle proof for verifying the result's inclusion in the batch
    function submit(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) external {
        _verifyAndCheckConsensus(result, batchHeight, merkleProof);
        _validateDrId(updateParams, result);
        _decodeAndProcess(updateParams, result);
    }

    /// @notice Verifies the consensus result and Merkle proof validity
    /// @param result The oracle result data to verify
    /// @param batchHeight The height of the batch containing the result
    /// @param merkleProof The Merkle proof for result inclusion verification
    function _verifyAndCheckConsensus(
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) private view {
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        (bool isValid, ) = sedaProver.verifyResultProof(
            resultId,
            batchHeight,
            merkleProof
        );

        if (!isValid) {
            revert ValidationFailed("Invalid Merkle proof");
        }

        if (!(result.consensus && result.exitCode == 0)) {
            revert ValidationFailed("Invalid consensus or exit code");
        }
    }

    /// @notice Validates that the data request ID matches the expected parameters
    /// @param updateParams Runtime parameters used to reconstruct the expected DR ID
    /// @param result The oracle result containing the actual DR ID to validate
    function _validateDrId(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result
    ) private view {
        SedaDataTypes.RequestInputs memory dataRequestInputs = SedaDataTypes
            .RequestInputs({
                execProgramId: priceFeedConfig.execProgramId,
                tallyProgramId: priceFeedConfig.tallyProgramId,
                gasPrice: updateParams.gasPrice,
                execGasLimit: updateParams.execGasLimit,
                tallyGasLimit: updateParams.tallyGasLimit,
                replicationFactor: priceFeedConfig.replicationFactor,
                execInputs: updateParams.execInputs,
                tallyInputs: priceFeedConfig.tallyInputs,
                consensusFilter: priceFeedConfig.consensusFilter,
                memo: updateParams.memo
            });

        bytes32 derivedId = SedaDataTypes.deriveRequestId(dataRequestInputs);
        if (derivedId != result.drId) {
            revert ValidationFailed("Invalid DR ID");
        }
    }

    /// @notice Decodes ticker symbols and prices from the result and processes each price feed
    /// @param updateParams Runtime parameters containing the encoded exec inputs
    /// @param result The oracle result containing the encoded price data
    function _decodeAndProcess(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result
    ) private {
        string[] memory symbols = this.decodeExecInputs(
            updateParams.execInputs
        );
        uint256[] memory prices = this.decodePriceResult(result.result);
        address batchSender = msg.sender;

        if (symbols.length == 0) revert ValidationFailed("Empty tickers");
        if (symbols.length != prices.length)
            revert ValidationFailed("Mismatched tickers and prices");

        for (uint256 i = 0; i < symbols.length; i++) {
            string memory symbol = symbols[i];
            int256 price = int256(prices[i]);
            uint256 timestamp = result.blockTimestamp;

            address feedAddr = priceFeedAddresses[symbol];
            if (feedAddr == address(0)) {
                address predicted = Clones.predictDeterministicAddress(
                    address(implementation),
                    _saltForTicker(symbol),
                    address(this)
                );

                if (predicted.code.length > 0) {
                    feedAddr = predicted;
                } else {
                    feedAddr = _createPriceFeed(symbol);
                }

                priceFeedAddresses[symbol] = feedAddr;
                tickers.push(symbol);
                emit PriceFeedCreated(symbol, feedAddr, DEFAULT_DECIMALS);
            }

            SedaPriceFeed(feedAddr).updateResult(price, timestamp);
            emit ResultVerified(
                result.drId,
                symbol,
                price,
                result.blockHeight,
                batchSender
            );
        }
    }

    // ============ Factory Functions ============

    /// @notice Creates a new SedaPriceFeed proxy contract for a given ticker symbol
    /// @param symbol The trading symbol for the new price feed
    /// @return feedAddr The deployed address of the new SedaPriceFeed contract
    /// @dev Uses EIP-1167 minimal proxy pattern with deterministic addressing
    function _createPriceFeed(
        string memory symbol
    ) internal returns (address feedAddr) {
        feedAddr = Clones.cloneDeterministic(
            address(implementation),
            _saltForTicker(symbol)
        );
        SedaPriceFeed(feedAddr).initialize(
            address(this),
            symbol,
            DEFAULT_DECIMALS
        );
    }

    /// @notice Predicts the deterministic address of a price feed for a given ticker
    /// @param ticker The trading symbol to predict the address for
    /// @return The predicted address where the SedaPriceFeed contract will be deployed
    function predictPriceFeedAddress(
        string calldata ticker
    ) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                address(implementation),
                _saltForTicker(ticker),
                address(this)
            );
    }

    // ============ Registry Functions ============

    /// @notice Retrieves the address of a price feed by its ticker symbol
    /// @param ticker The trading symbol to look up
    /// @return The address of the deployed SedaPriceFeed contract, or zero address if not found
    function getPriceFeedAddress(
        string calldata ticker
    ) external view returns (address) {
        return priceFeedAddresses[ticker];
    }

    /// @notice Retrieves all registered ticker symbols
    /// @return Array of all ticker symbols that have been created
    function getAllTickers() external view returns (string[] memory) {
        return tickers;
    }

    /// @notice Checks if a price feed exists for a given ticker symbol
    /// @param ticker The trading symbol to check
    /// @return True if a price feed exists for the ticker, false otherwise
    function hasPriceFeed(string calldata ticker) external view returns (bool) {
        return priceFeedAddresses[ticker] != address(0);
    }

    // ============ Owner Functions ============

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyOwner {
        if (newProver == address(0)) revert InvalidProverAddress();
        address oldProver = address(sedaProver);
        sedaProver = IProver(newProver);
        emit ProverUpdated(oldProver, newProver);
    }

    // ============ Utility Functions ============

    /// @notice Decodes an array of ticker symbols from encoded exec inputs
    /// @param execInputs The encoded bytes containing ticker symbols
    /// @return tickers The decoded array of ticker string symbols
    /// @dev This function is external to enable try/catch error handling in calling contracts
    function decodeExecInputs(
        bytes calldata execInputs
    ) external pure returns (string[] memory) {
        require(execInputs.length > 0, "Empty execInputs");

        // Use require instead of try/catch for built-in functions
        require(execInputs.length >= 32, "Invalid execInputs length");

        // Attempt to decode - this will revert if invalid
        return abi.decode(execInputs, (string[]));
    }

    /// @notice Decodes an array of price values from encoded result data
    /// @param resultData The encoded bytes containing price values
    /// @return prices The decoded array of price values as unsigned integers
    /// @dev This function is external to enable try/catch error handling in calling contracts
    function decodePriceResult(
        bytes calldata resultData
    ) external pure returns (uint256[] memory prices) {
        require(resultData.length > 0, "Empty result data");

        // Use require instead of try/catch for built-in functions
        require(resultData.length >= 32, "Invalid result data length");

        // Attempt to decode - this will revert if invalid
        return abi.decode(resultData, (uint256[]));
    }

    /// @notice Generates a deterministic salt for a ticker symbol
    /// @param ticker The trading symbol to generate a salt for
    /// @return The deterministic salt used for proxy contract deployment
    /// @dev Uses keccak256 hash of "SedaPriceFeed:" prefix + ticker for deterministic addressing
    function _saltForTicker(
        string memory ticker
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("SedaPriceFeed:", ticker));
    }

    // ============ View Functions ============

    /// @notice Retrieves the current SEDA prover contract address
    /// @return The address of the currently configured SEDA prover contract
    function getProver() external view returns (address) {
        return address(sedaProver);
    }

    /// @notice Retrieves the current SedaPriceFeed implementation contract address
    /// @return The address of the currently configured implementation contract
    function getImplementation() external view returns (address) {
        return address(implementation);
    }

    /// @notice Retrieves the last batch height from the SEDA prover
    /// @return The height of the most recent batch processed by the prover
    function getLastBatchHeight() external view returns (uint64) {
        return sedaProver.getLastBatchHeight();
    }
}
