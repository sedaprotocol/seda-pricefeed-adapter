// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {FastProver} from "./FastProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";

import {FastPriceFeedAdapterStorage} from "./libraries/FastPriceFeedAdapterStorage.sol";

/// @title FastPriceFeedAdapter
/// @author Open Oracle Association
/// @notice SEDA Price Feed Adapter for managing, verifying, and storing SEDA oracle price feeds.
/// @dev Contract for creating and managing FAST PriceFeed proxies (EIP-1167), verifying oracle results,
///      and maintaining a registry of asset IDs. Uses ERC-7201 storage layout for upgrade safety and
///      UUPS upgrade pattern. Pausable for emergencies. All state is stored in a single versioned storage slot.
/// @custom:security Inherits OpenZeppelin upgradeable contracts. Only the owner can perform admin actions.
///                  Oracle result validation is enforced.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract FastFeedAdapter is Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    // ============ Constants ============

    // ============ Structs ============

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
        bytes tallyInputs;
    }

    /// @notice Struct for updating price feeds with multiple results
    /// @dev Contains the execution inputs, configuration, and oracle results for batch updates
    struct PriceUpdateBatch {
        bytes32[] execInputs;
        ProgramConfig programConfig;
        SedaDataTypes.Result[] results;
    }

    // ============ Custom Errors ============

    /// @notice Thrown when result validation fails during processing
    /// @param reason Human-readable description of the validation failure
    error ValidationFailed(string reason);

    /// @notice Thrown when initialization or function parameters are invalid
    /// @param reason Human-readable description of the parameter error
    error InvalidParameter(string reason);

    /// @notice Thrown when a zero address is provided where a valid address is required
    /// @param parameter The name of the parameter that cannot be zero address
    error ZeroAddressNotAllowed(string parameter);

    // ============ Events ============

    /// @notice Emitted when a price feed is updated
    /// @param id The asset ID
    /// @param publishTime The timestamp of the price feed update
    /// @param price The decoded price value as a signed integer
    /// @param conf The confidence interval for the price
    event PriceFeedUpdate(bytes32 indexed id, uint64 indexed publishTime, int64 indexed price, uint64 conf);

    /// @notice Emitted when the SEDA prover address is updated by the owner
    /// @param oldProver The previous prover contract address
    /// @param newProver The new prover contract address
    event ProverUpdated(address indexed oldProver, address indexed newProver);

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    /// @notice Disables initializers to prevent future reinitialization
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the PriceFeedAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract for result verification
    /// @param priceFeedImplementation Address of the PriceFeed implementation contract for proxy creation
    /// @param owner Address that will have administrative privileges over the adapter
    function initialize(address sedaProverAddress, address priceFeedImplementation, address owner) public initializer {
        if (sedaProverAddress == address(0)) revert ZeroAddressNotAllowed("SEDA prover");
        if (priceFeedImplementation == address(0)) revert ZeroAddressNotAllowed("implementation");
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");

        __Ownable_init(owner);
        __UUPSUpgradeable_init();
        __Pausable_init();

        FastPriceFeedAdapterStorage.Layout storage s = FastPriceFeedAdapterStorage.layout();
        s.sedaProver = sedaProverAddress;
    }

    // ============ External Functions ============

    // TODO: check if we want to add a bool to indicate if we want to revert if an update fails
    /// @notice Submits a signed payload containing price update data
    /// @param signedPayload The signed payload containing the price update data
    /// @dev Only callable when the contract is not paused
    function submit(bytes calldata signedPayload) external onlyProxy whenNotPaused {
        // Decode signedPayload as a struct of (data, signature)
        SignedPayload memory payload = abi.decode(signedPayload, (SignedPayload));

        // Verify signature
        bytes32 dataHash = keccak256(payload.data);
        (bool valid, ) = FastProver(getProver()).verifyData(dataHash, payload.signature);
        if (!valid) revert ValidationFailed("Invalid signature");

        // Decode the actual price update data
        PriceUpdateBatch memory batch = abi.decode(payload.data, (PriceUpdateBatch));

        // Check assetIds and results length
        if (batch.execInputs.length == 0) revert ValidationFailed("Empty batch");
        if (batch.execInputs.length != batch.results.length) revert ValidationFailed("Mismatched assetIds and results");

        // Derive assetId as hash of PriceFeedConfig, execInput[i]
        bytes32[] memory assetIds = new bytes32[](batch.execInputs.length);
        for (uint256 i = 0; i < batch.execInputs.length; ++i) {
            assetIds[i] = keccak256(
                abi.encode(
                    batch.programConfig.execProgramId,
                    batch.execInputs[i],
                    batch.programConfig.tallyProgramId,
                    batch.programConfig.tallyInputs
                )
            );
        }

        // For each assetId, we store assetIds[i] -> result[i]
        FastPriceFeedAdapterStorage.Layout storage s = FastPriceFeedAdapterStorage.layout();
        for (uint256 i = 0; i < batch.execInputs.length; ++i) {
            // Decode result[i] as PriceInfo
            FastPriceFeedAdapterStorage.PriceInfo memory newPriceInfo = abi.decode(
                batch.results[i].result,
                (FastPriceFeedAdapterStorage.PriceInfo)
            );

            FastPriceFeedAdapterStorage.PriceInfo memory currentPriceInfo = s.priceInfos[assetIds[i]];

            // Check if the returned result is valid (exitCode == 0)
            if (batch.results[i].exitCode != 0) revert ValidationFailed("Invalid exit code");

            // Check if the new priceInfo is newer than the current priceInfo
            // What if currentPriceInfo.publishTime is 0?
            if (
                newPriceInfo.publishTime < currentPriceInfo.publishTime + 1 ||
                batch.results[i].blockTimestamp < currentPriceInfo.publishTime + 1
            ) {
                revert ValidationFailed("New price must be newer");
            }

            // Store priceInfo in the mapping from assetId to PriceInfo
            s.priceInfos[assetIds[i]] = newPriceInfo;
            if (currentPriceInfo.publishTime == 0) {
                // This is a new asset ID
                s.assetIds.push(assetIds[i]);
            }

            // Emit the event
            emit PriceFeedUpdate(assetIds[i], newPriceInfo.publishTime, newPriceInfo.price, newPriceInfo.conf);
        }
    }

    /// @notice Updates the SEDA prover contract address (owner only)
    /// @param newProver Address of the new SEDA prover contract
    function updateProver(address newProver) external onlyProxy onlyOwner {
        if (newProver == address(0)) revert InvalidParameter("Invalid SEDA prover address");
        FastPriceFeedAdapterStorage.Layout storage s = FastPriceFeedAdapterStorage.layout();
        address oldProver = address(s.sedaProver);
        s.sedaProver = newProver;
        emit ProverUpdated(oldProver, newProver);
    }

    /// @notice Pauses the contract, preventing new price feed submissions (owner only)
    /// @dev This is an emergency function to stop all price feed updates
    function pause() external onlyProxy onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract, allowing price feed submissions to resume (owner only)
    /// @dev This function can only be called by the owner
    function unpause() external onlyProxy onlyOwner {
        _unpause();
    }

    // ============ Public Functions ============

    /// @notice Returns the SEDA prover contract address
    /// @return The address of the SEDA prover contract
    function getProver() public view returns (address) {
        return FastPriceFeedAdapterStorage.layout().sedaProver;
    }

    /// @notice Retrieves all registered ticker symbols
    /// @return Array of all ticker symbols that have been created
    function getAssetIds() public view returns (bytes32[] memory) {
        return FastPriceFeedAdapterStorage.layout().assetIds;
    }

    /// @notice Gets price information for a specific asset ID
    /// @param assetId The asset ID to get the price information for
    /// @return The price information for the asset ID
    function getPriceInfo(bytes32 assetId) external view returns (FastPriceFeedAdapterStorage.PriceInfo memory) {
        return FastPriceFeedAdapterStorage.layout().priceInfos[assetId];
    }

    // ============ Internal Functions ============

    /// @notice Required by the OZ UUPS module
    /// @dev Only the owner can upgrade the contract
    /// @param newImplementation Address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        if (newImplementation == address(0)) revert InvalidParameter("Invalid implementation address");
    }

    // ============ Private Functions ============
}
