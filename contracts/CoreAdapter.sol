// SPDX-License-Identifier: MIT
pragma solidity >=0.8.28 <0.9.0;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {BaseUpgradeable} from "./base/BaseUpgradeable.sol";

import {IProver} from "@seda-protocol/evm/contracts/interfaces/IProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";

import {PriceFeed} from "./PriceFeed.sol";
import {CoreAdapterStorage} from "./storage/CoreAdapterStorage.sol";

/// @title CoreAdapter
/// @author Open Oracle Association
/// @notice A SEDA Price Feed Adapter contract for managing SEDA oracle price feeds with factory,
///         registry, and verification capabilities
/// @dev This contract serves as a central hub for creating and managing PriceFeed instances
///      using EIP-1167 minimal proxies, verifying oracle results using SEDA's
///      consensus mechanism, and maintaining a registry of active price feeds by ticker symbol.
///      It uses ERC-7201 storage pattern for upgradeable safety and implements UUPS upgrade pattern.
///      The contract is pausable for emergency situations and includes validation
///      of oracle results including Merkle proofs, consensus verification, and DR ID validation.
///      Price feeds are created on-demand when first referenced and reused for subsequent updates.
///      The contract supports both full result processing and selective index-based processing.
///      All state variables are stored in a single storage slot following ERC-7201 standard to
///      prevent storage collisions during upgrades.
/// @custom:security This contract inherits from OpenZeppelin's upgradeable contracts and includes
///                   validation of oracle results and administrative controls. The contract is pausable
///                   and only the owner can perform administrative functions. All price feed operations
///                   are protected by SEDA's consensus mechanism and Merkle proof verification.
/// @custom:upgrades This contract uses UUPS upgrade pattern and ERC-7201 storage layout.
///                   Storage layout is versioned (v1) to prevent collisions during upgrades.
contract CoreAdapter is BaseUpgradeable {
    // ============ Constants ============

    /// @notice Default number of decimal places for price data precision
    uint8 public constant DEFAULT_DECIMALS = 6;

    // ============ Structs ============

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

    /// @notice Thrown when result validation fails during processing
    /// @param reason Human-readable description of the validation failure
    error ValidationFailed(string reason);

    /// @notice Thrown when initialization or function parameters are invalid
    /// @param reason Human-readable description of the parameter error
    error InvalidParameter(string reason);

    // ============ Events ============

    /// @notice Emitted when a result is successfully verified and processed
    /// @param requestId The unique identifier of the data request
    /// @param symbol The trading symbol (e.g., "ETH/USD")
    /// @param price The decoded price value as a signed integer
    /// @param sender The address that posted the result to the blockchain
    /// @param blockHeight The height of the SEDA batch containing the result
    /// @param timestamp The timestamp of the result
    event ResultVerified(
        bytes32 indexed requestId,
        string indexed symbol,
        int256 price,
        address indexed sender,
        uint64 blockHeight,
        uint256 timestamp
    );

    /// @notice Emitted when a new price feed is created and registered
    /// @param ticker The trading symbol (e.g., "ETH/USD")
    /// @param feedAddress The deployed address of the PriceFeed contract
    /// @param decimals The number of decimal places for price precision
    /// @param timestamp The timestamp of the price feed creation
    event PriceFeedCreated(
        string indexed ticker,
        address indexed feedAddress,
        uint8 indexed decimals,
        uint256 timestamp
    );

    /// @notice Emitted when the SEDA prover address is updated by the owner
    /// @param oldProver The previous prover contract address
    /// @param newProver The new prover contract address
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    // ============ Initialization ============

    /// @notice Initializes the PriceFeedAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param priceFeedImplementation Address of the PriceFeed implementation contract for proxy creation
    /// @param owner Address that will have administrative privileges over the adapter
    /// @param _priceFeedConfig Configuration parameters for SEDA oracle execution
    function initialize(
        address sedaProverAddress,
        address priceFeedImplementation,
        address owner,
        CoreAdapterStorage.PriceFeedConfig memory _priceFeedConfig
    ) public virtual initializer {
        if (sedaProverAddress == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        if (priceFeedImplementation == address(0)) revert ZeroAddressNotAllowed("implementation");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __BaseUpgradeable_init(owner);

        CoreAdapterStorage.Layout storage s = CoreAdapterStorage.layout();
        s.sedaProver = sedaProverAddress;
        s.priceFeedImplementation = priceFeedImplementation;
        s.priceFeedConfig = _priceFeedConfig;
    }

    // ============ External Functions ============

    /// @notice Submits and verifies an oracle result, automatically deploying price feeds as needed
    /// @param updateParams Data Request parameters for the price feed update including gas limits and inputs
    /// @param result The oracle result data containing consensus information and price data
    /// @param batchHeight The height of the SEDA batch containing the result
    /// @param merkleProof The Merkle proof for verifying the result's inclusion in the batch
    /// @dev Only callable when the contract is not paused
    function submit(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) external onlyProxy whenNotPaused {
        _verifyResult(result, batchHeight, merkleProof);
        _validateDrId(updateParams, result);
        _decodeAndProcess(updateParams, result);
    }

    // TODO: we may want to add a bool to indicate if we want to revert if an update fails
    /// @notice Submits and verifies an oracle result for specific tickers by index,
    ///         automatically deploying price feeds as needed
    /// @param updateParams Data Request parameters for the price feed update including gas limits and inputs
    /// @param result The oracle result data containing consensus information and price data
    /// @param batchHeight The height of the SEDA batch containing the result
    /// @param merkleProof The Merkle proof for verifying the result's inclusion in the batch
    /// @param targetIndices Array of indices corresponding to the tickers to update
    /// @dev Indices must be valid (within bounds of the result's ticker array)
    function submitForIndices(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof,
        uint16[] calldata targetIndices
    ) external onlyProxy whenNotPaused {
        _verifyResult(result, batchHeight, merkleProof);
        _validateDrId(updateParams, result);
        _decodeAndProcessForIndices(updateParams, result, targetIndices);
    }

    /// @notice Retrieves the address of a price feed by its ticker symbol
    /// @param ticker The trading symbol to look up
    /// @return The address of the deployed PriceFeed contract, or zero address if not found
    function getPriceFeedAddress(string calldata ticker) external view returns (address) {
        return priceFeedAddresses(ticker);
    }

    /// @notice Retrieves all registered ticker symbols
    /// @return Array of all ticker symbols that have been created
    function getAllTickers() external view returns (string[] memory) {
        return tickers();
    }

    /// @notice Checks if a price feed exists for a given ticker symbol
    /// @param ticker The trading symbol to check
    /// @return True if a price feed exists for the ticker, false otherwise
    function hasPriceFeed(string calldata ticker) external view returns (bool) {
        return priceFeedAddresses(ticker) != address(0);
    }

    /// @notice Retrieves the current SEDA prover contract address
    /// @return The address of the currently configured SEDA prover contract
    function getProver() external view returns (address) {
        return address(sedaProver());
    }

    /// @notice Retrieves the current PriceFeed implementation contract address
    /// @return The address of the currently configured implementation contract
    function getImplementation() external view returns (address) {
        return address(implementation());
    }

    /// @notice Retrieves the latest round data for a given ticker
    /// @param ticker The trading symbol to look up
    /// @return roundId The latest round ID
    /// @return answer The latest answer
    /// @return startedAt The timestamp when the latest round started
    /// @return updatedAt The timestamp when the latest round was updated
    /// @return answeredInRound The round ID in which the latest answer was computed
    function getLatestRoundData(
        string calldata ticker
    )
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        address feed = priceFeedAddresses(ticker);
        if (feed == address(0)) revert InvalidParameter("Unknown ticker");
        return PriceFeed(feed).latestRoundData();
    }

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyProxy onlyOwner {
        if (newProver == address(0)) revert InvalidParameter("Invalid SEDA prover address");
        CoreAdapterStorage.Layout storage s = CoreAdapterStorage.layout();
        address oldProver = address(s.sedaProver);
        s.sedaProver = newProver;
        emit ProverUpdated(oldProver, newProver);
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    /// @return The address of the SEDA prover contract
    function sedaProver() public view returns (address) {
        return CoreAdapterStorage.layout().sedaProver;
    }

    /// @notice Returns the PriceFeed implementation contract address
    /// @return The address of the PriceFeed implementation contract
    function implementation() public view returns (address) {
        return CoreAdapterStorage.layout().priceFeedImplementation;
    }

    /// @notice Returns the price feed address for a given ticker
    /// @param ticker The trading symbol to look up
    /// @return The address of the deployed PriceFeed contract, or zero address if not found
    function priceFeedAddresses(string memory ticker) public view returns (address) {
        return CoreAdapterStorage.layout().priceFeedAddresses[ticker];
    }

    /// @notice Returns the array of all registered tickers
    /// @return Array of all ticker symbols that have been created
    function tickers() public view returns (string[] memory) {
        return CoreAdapterStorage.layout().tickers;
    }

    /// @notice Returns the price feed configuration
    /// @return The current price feed configuration
    function priceFeedConfig() public view returns (CoreAdapterStorage.PriceFeedConfig memory) {
        return CoreAdapterStorage.layout().priceFeedConfig;
    }

    // ============ Internal Functions ============

    /// @notice Creates a new PriceFeed proxy contract for a given ticker symbol
    /// @param symbol The trading symbol for the new price feed
    /// @return feedAddr The deployed address of the new PriceFeed contract
    /// @dev Uses EIP-1167 minimal proxy pattern with deterministic addressing
    function _createPriceFeed(string memory symbol) internal returns (address feedAddr) {
        feedAddr = Clones.cloneDeterministic(address(implementation()), _saltForTicker(symbol));
        PriceFeed(feedAddr).initialize(address(this), symbol, DEFAULT_DECIMALS);
    }

    /// @notice Generates a deterministic salt for a ticker symbol
    /// @param ticker The trading symbol to generate a salt for
    /// @return The deterministic salt used for proxy contract deployment
    /// @dev Uses keccak256 hash of "PriceFeed:" prefix + ticker for deterministic addressing
    function _saltForTicker(string memory ticker) internal pure returns (bytes32) {
        return keccak256(abi.encode("PriceFeed:", ticker));
    }

    // ============ Private Functions ============

    /// @notice Decodes ticker symbols and prices from the result and processes each price feed
    /// @param updateParams Runtime parameters containing the encoded exec inputs
    /// @param result The oracle result containing the encoded price data
    function _decodeAndProcess(UpdateParams calldata updateParams, SedaDataTypes.Result calldata result) private {
        (string[] memory symbols, int256[] memory prices) = _decodeAndValidate(updateParams, result);

        for (uint256 i = 0; i < symbols.length; ++i) {
            _processTickerAtIndex(symbols, prices, result, i);
        }
    }

    /// @notice Decodes ticker symbols and prices from the result and processes only the specified indices
    /// @dev This function decodes and validates the symbols and prices from the result,
    ///      and then processes only the tickers at the specified indices.
    /// @param updateParams Runtime parameters containing the encoded exec inputs
    /// @param result The oracle result containing the encoded price data
    /// @param targetIndices Array of indices corresponding to the tickers to update
    function _decodeAndProcessForIndices(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result,
        uint16[] memory targetIndices
    ) private {
        (string[] memory symbols, int256[] memory prices) = _decodeAndValidate(updateParams, result);

        for (uint256 i = 0; i < targetIndices.length; ++i) {
            // Note: symbols.length > 0 is guaranteed by _decodeAndValidate() which reverts on empty arrays
            if (targetIndices[i] > symbols.length - 1) {
                revert ValidationFailed("Index out of bounds");
            }
            _processTickerAtIndex(symbols, prices, result, targetIndices[i]);
        }
    }

    /// @notice Decodes and validates the symbols and prices from the result
    /// @param updateParams Runtime parameters containing the encoded exec inputs
    /// @param result The oracle result containing the encoded price data
    /// @return symbols Array of decoded ticker symbols
    /// @return prices Array of decoded prices
    function _decodeAndValidate(
        UpdateParams calldata updateParams,
        SedaDataTypes.Result calldata result
    ) private pure returns (string[] memory symbols, int256[] memory prices) {
        symbols = abi.decode(updateParams.execInputs, (string[]));
        prices = abi.decode(result.result, (int256[]));

        // Invariant Checks:
        // 1. The number of symbols returned by the Oracle Program must equal the number of prices.
        // 2. There must be at least one symbol present.
        if (symbols.length == 0) revert ValidationFailed("Empty tickers");
        if (symbols.length != prices.length) revert ValidationFailed("Mismatched tickers and prices");
    }

    /// @notice Processes a single ticker at the specified index
    /// @param symbols Array of all ticker symbols from the result
    /// @param prices Array of all prices from the result
    /// @param result The oracle result containing metadata
    /// @param index The index of the ticker to process
    function _processTickerAtIndex(
        string[] memory symbols,
        int256[] memory prices,
        SedaDataTypes.Result calldata result,
        uint256 index
    ) private {
        string memory symbol = symbols[index];
        int256 price = prices[index];

        CoreAdapterStorage.Layout storage s = CoreAdapterStorage.layout();
        address existingFeed = s.priceFeedAddresses[symbol];

        if (existingFeed == address(0)) {
            existingFeed = _createPriceFeed(symbol);
            s.priceFeedAddresses[symbol] = existingFeed;
            s.tickers.push(symbol);
            emit PriceFeedCreated(symbol, existingFeed, DEFAULT_DECIMALS, result.blockTimestamp);
        }

        PriceFeed(existingFeed).updateResult(price, result.blockTimestamp);
        emit ResultVerified(result.drId, symbol, price, msg.sender, result.blockHeight, result.blockTimestamp);
    }

    /// @notice Verifies the consensus result and Merkle proof validity
    /// @param result The oracle result data to verify
    /// @param batchHeight The height of the batch containing the result
    /// @param merkleProof The Merkle proof for result inclusion verification
    function _verifyResult(
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) private view {
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        (bool isValid, ) = IProver(CoreAdapterStorage.layout().sedaProver).verifyResultProof(
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
    function _validateDrId(UpdateParams calldata updateParams, SedaDataTypes.Result calldata result) private view {
        CoreAdapterStorage.Layout storage s = CoreAdapterStorage.layout();
        SedaDataTypes.RequestInputs memory dataRequestInputs = SedaDataTypes.RequestInputs({
            execProgramId: s.priceFeedConfig.execProgramId,
            tallyProgramId: s.priceFeedConfig.tallyProgramId,
            gasPrice: updateParams.gasPrice,
            execGasLimit: updateParams.execGasLimit,
            tallyGasLimit: updateParams.tallyGasLimit,
            replicationFactor: s.priceFeedConfig.replicationFactor,
            execInputs: updateParams.execInputs,
            tallyInputs: s.priceFeedConfig.tallyInputs,
            consensusFilter: s.priceFeedConfig.consensusFilter,
            memo: updateParams.memo
        });

        bytes32 derivedId = SedaDataTypes.deriveRequestId(dataRequestInputs);
        if (derivedId != result.drId) {
            revert ValidationFailed("Invalid DR ID");
        }
    }
}
