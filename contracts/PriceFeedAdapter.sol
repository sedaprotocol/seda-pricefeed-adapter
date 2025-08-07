// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProver} from "@seda-protocol/evm/contracts/interfaces/IProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SedaPriceFeed} from "./SedaPriceFeed.sol";

/// @title PriceFeedAdapter
/// @notice A specialized adapter contract for coordinating SEDA oracle price feeds
/// @dev This contract acts as a factory and registry for SedaPriceFeed contracts
/// @author Open Oracle Association
contract PriceFeedAdapter is Ownable {
    
    // Custom errors
    error InvalidProverAddress();
    error InvalidMerkleProof();
    error OracleExecutionFailed();
    error NoConsensusReached();
    error FailedToExtractPrice();
    error TickerNotFound();
    error InvalidImplementationAddress();
    error InvalidTicker();
    error TickerAlreadyExists();
    
    // ============ Events ============
    
    /// @notice Emitted when a result is successfully verified and processed
    /// @param requestId The request identifier
    /// @param symbol The trading symbol
    /// @param price The decoded price value
    /// @param batchHeight The height of the batch containing the result
    /// @param batchSender The address that posted the batch
    event ResultVerified(
        bytes32 indexed requestId, 
        string indexed symbol, 
        int256 indexed price, 
        uint64 batchHeight,
        address batchSender
    );
    
    /// @notice Emitted when a new price feed is created
    /// @param ticker The trading symbol (e.g., "ETH/USD")
    /// @param feedAddress The address of the deployed SedaPriceFeed contract
    /// @param decimals The number of decimals for the price data
    event PriceFeedCreated(
        string indexed ticker,
        address indexed feedAddress,
        uint8 indexed decimals
    );
    
    /// @notice Emitted when result verification fails
    /// @param requestId The request identifier
    /// @param reason The reason for verification failure
    event VerificationFailed(bytes32 indexed requestId, string reason);
    
    /// @notice Emitted when the SEDA prover address is updated
    /// @param oldProver The previous prover address
    /// @param newProver The new prover address
    event ProverUpdated(address indexed oldProver, address indexed newProver);
    
    /// @notice Emitted when the implementation address is updated
    /// @param oldImplementation The previous implementation address
    /// @param newImplementation The new implementation address
    event ImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);
    
    // ============ State Variables ============
    
    /// @notice The SEDA SECP256k1 prover contract for result verification
    IProver public sedaProver;
    
    // TODO: We should use an interface instead of the implementation contract
    /// @notice The implementation contract for SedaPriceFeed (EIP-1167 minimal proxy)
    SedaPriceFeed public implementation;
    
    /// @notice Mapping from ticker to SedaPriceFeed contract address
    mapping(string => address) public feeds;
    
    /// @notice Array of all registered tickers
    string[] public tickers;
    
    /// @notice Default decimals for price feeds
    uint8 public constant DEFAULT_DECIMALS = 18;
    
    // ============ Constructor ============
    
    /// @notice Constructor to initialize the adapter
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract
    /// @param implementationAddress Address of the SedaPriceFeed implementation contract
    /// @param owner Address of the contract owner
    constructor(
        address sedaProverAddress, 
        address implementationAddress,
        address owner
    ) Ownable(owner) {
        if (sedaProverAddress == address(0)) revert InvalidProverAddress();
        if (implementationAddress == address(0)) revert InvalidImplementationAddress();
        
        sedaProver = IProver(sedaProverAddress);
        implementation = SedaPriceFeed(implementationAddress);
    }
    
    // ============ Core Functions ============
    
    /// @notice Submit and verify an oracle result, auto-deploying feed if needed
    /// @param ticker The trading symbol (e.g., "ETH/USD")
    /// @param result The oracle result data
    /// @param batchHeight The height of the batch containing the result
    /// @param merkleProof The Merkle proof for verifying the result
    /// @return success Whether the verification and processing succeeded
    function submitResult(
        string calldata ticker,
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) external returns (bool success) {
        // Validate ticker format (basic validation)
        if (bytes(ticker).length == 0) revert InvalidTicker();
        
        // Get or create the price feed
        address feedAddress = feeds[ticker];
        if (feedAddress == address(0)) {
            // Auto-deploy new feed if it doesn't exist
            feedAddress = _createPriceFeed(ticker);
        }
        
        // Verify the result using the SEDA prover
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        (bool isValid, address batchSender) = sedaProver.verifyResultProof(
            resultId,
            batchHeight,
            merkleProof
        );
        
        if (!isValid) {
            emit VerificationFailed(result.drId, "Invalid Merkle proof");
            return false;
        }
        
        // Process the result if it reached consensus and executed successfully
        if (result.consensus && result.exitCode == 0) {
            int256 price = this.decodePriceResult(result.result);
            if (price > 0) {
                // Update the price feed
                SedaPriceFeed(feedAddress).updateResult(price, uint256(result.blockTimestamp));
                
                // Get the latest round data for the event
                // (uint80 roundId, , , , ) = SedaPriceFeed(feedAddress).latestRoundData();
                emit ResultVerified(result.drId, ticker, price, batchHeight, batchSender);
                return true;
            } else {
                emit VerificationFailed(result.drId, "Failed to extract price");
                return false;
            }
        } else {
            string memory reason = result.consensus ? "Oracle execution failed" : "No consensus reached";
            emit VerificationFailed(result.drId, reason);
            return false;
        }
    }
    
    // ============ Factory Functions ============
    
    /// @notice Create a new price feed for a given ticker (internal function)
    /// @param ticker The trading symbol (e.g., "ETH/USD")
    /// @return feedAddress The address of the deployed SedaPriceFeed contract
    function _createPriceFeed(string calldata ticker) internal returns (address feedAddress) {
        // Deploy new SedaPriceFeed using OpenZeppelin's Clones library
        feedAddress = Clones.clone(address(implementation));
        
        // Initialize the proxy with ticker as description
        SedaPriceFeed(feedAddress).initialize(address(this), ticker, DEFAULT_DECIMALS);
        
        // Register the feed
        feeds[ticker] = feedAddress;
        tickers.push(ticker);
        
        emit PriceFeedCreated(ticker, feedAddress, DEFAULT_DECIMALS);
    }
    
    /// @notice Create a new price feed for a given ticker (owner function for manual creation)
    /// @param ticker The trading symbol (e.g., "ETH/USD")
    /// @param description The description of the price feed
    /// @param decimals The number of decimals for the price data
    /// @return feedAddress The address of the deployed SedaPriceFeed contract
    function createPriceFeed(
        string calldata ticker,
        string calldata description,
        uint8 decimals
    ) external onlyOwner returns (address feedAddress) {
        if (feeds[ticker] != address(0)) revert TickerAlreadyExists();
        
        // Deploy new SedaPriceFeed using OpenZeppelin's Clones library
        feedAddress = Clones.clone(address(implementation));
        
        // Initialize the proxy
        SedaPriceFeed(feedAddress).initialize(address(this), description, decimals);
        
        // Register the feed
        feeds[ticker] = feedAddress;
        tickers.push(ticker);
        
        emit PriceFeedCreated(ticker, feedAddress, decimals);
    }
    
    // ============ Registry Functions ============
    
    /// @notice Get the address of a price feed by ticker
    /// @param ticker The trading symbol
    /// @return The address of the SedaPriceFeed contract
    function getFeed(string calldata ticker) external view returns (address) {
        return feeds[ticker];
    }
    
    /// @notice Get all registered tickers
    /// @return Array of all registered ticker symbols
    function getAllTickers() external view returns (string[] memory) {
        return tickers;
    }
    
    /// @notice Check if a ticker exists
    /// @param ticker The trading symbol
    /// @return Whether the ticker is registered
    function hasFeed(string calldata ticker) external view returns (bool) {
        return feeds[ticker] != address(0);
    }
    
    /// @notice Verify a result without storing it (view function)
    /// @param result The oracle result data
    /// @param batchHeight The height of the batch containing the result
    /// @param merkleProof The Merkle proof for verifying the result
    /// @return isValid Whether the verification succeeded
    /// @return batchSender The address that posted the batch
    function verifyResult(
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) external view returns (bool isValid, address batchSender) {
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        return sedaProver.verifyResultProof(resultId, batchHeight, merkleProof);
    }
    
    // ============ Owner Functions ============
    
    /// @notice Update the SEDA prover address
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyOwner {
        if (newProver == address(0)) revert InvalidProverAddress();
        address oldProver = address(sedaProver);
        sedaProver = IProver(newProver);
        emit ProverUpdated(oldProver, newProver);
    }
    
    /// @notice Update the implementation address
    /// @param newImplementation Address of the new SedaPriceFeed implementation contract
    function updateImplementation(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementationAddress();
        address oldImplementation = address(implementation);
        implementation = SedaPriceFeed(newImplementation);
        emit ImplementationUpdated(oldImplementation, newImplementation);
    }
    
    // ============ Utility Functions ============
    
    /// @notice External function to decode price result (for try/catch error handling)
    /// @param resultData The raw result data
    /// @return price The decoded price
    function decodePriceResult(bytes calldata resultData) external pure returns (int256 price) {
        return abi.decode(resultData, (int256));
    }
    
    // ============ View Functions ============
    
    /// @notice Get the current SEDA prover address
    /// @return The address of the SEDA prover contract
    function getProver() external view returns (address) {
        return address(sedaProver);
    }
    
    /// @notice Get the current implementation address
    /// @return The address of the SedaPriceFeed implementation contract
    function getImplementation() external view returns (address) {
        return address(implementation);
    }
    
    /// @notice Get the last batch height from the prover
    /// @return The height of the last batch
    function getLastBatchHeight() external view returns (uint64) {
        return sedaProver.getLastBatchHeight();
    }
} 