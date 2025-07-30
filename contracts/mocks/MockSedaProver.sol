// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProver} from "@seda-protocol/evm/contracts/interfaces/IProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";

/// @title MockSedaProver
/// @notice A mock implementation of IProver for testing purposes
contract MockSedaProver is IProver {
    
    // ============ State Variables ============
    
    uint64 private _lastBatchHeight;
    address private _feeManager;
    mapping(uint64 => bool) private _validBatches;
    mapping(bytes32 => bool) private _validResults;
    address private _defaultBatchSender;
    
    // ============ Constructor ============
    
    constructor() {
        _lastBatchHeight = 100;
        _feeManager = address(this);
        _defaultBatchSender = msg.sender;
        
        // Set up some default valid batches for testing
        _validBatches[100] = true;
        _validBatches[101] = true;
        _validBatches[102] = true;
    }
    
    // ============ External Functions ============
    
    /// @inheritdoc IProver
    function getLastBatchHeight() external view returns (uint64) {
        return _lastBatchHeight;
    }
    
    /// @inheritdoc IProver
    function getFeeManager() external view returns (address) {
        return _feeManager;
    }
    
    /// @inheritdoc IProver
    function postBatch(
        SedaDataTypes.Batch calldata newBatch,
        bytes[] calldata signatures,
        SedaDataTypes.ValidatorProof[] calldata validatorProofs
    ) external {
        // Simple mock implementation
        _validBatches[newBatch.batchHeight] = true;
        if (newBatch.batchHeight > _lastBatchHeight) {
            _lastBatchHeight = newBatch.batchHeight;
        }
        
        bytes32 batchId = SedaDataTypes.deriveBatchId(newBatch);
        emit BatchPosted(newBatch.batchHeight, batchId, msg.sender);
    }
    
    /// @inheritdoc IProver
    function verifyResultProof(
        bytes32 resultId,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) external view returns (bool, address) {
        // Mock implementation that returns true for valid batches
        
        // Check if batch exists
        if (!_validBatches[batchHeight]) {
            return (false, address(0));
        }
        
        // Check if this specific result was marked as valid
        if (_validResults[resultId]) {
            return (true, _defaultBatchSender);
        }
        
        // Default to valid for all results in valid batches (for testing)
        return (true, _defaultBatchSender);
    }
    
    // ============ Test Helper Functions ============
    
    /// @notice Set whether a specific result should be considered valid
    /// @param resultId The result ID to configure
    /// @param isValid Whether the result should be valid
    function setResultValid(bytes32 resultId, bool isValid) external {
        _validResults[resultId] = isValid;
    }
    
    /// @notice Set whether a specific batch should be considered valid
    /// @param batchHeight The batch height to configure
    /// @param isValid Whether the batch should be valid
    function setBatchValid(uint64 batchHeight, bool isValid) external {
        _validBatches[batchHeight] = isValid;
    }
    
    /// @notice Set the last batch height
    /// @param height The new last batch height
    function setLastBatchHeight(uint64 height) external {
        _lastBatchHeight = height;
    }
    
    /// @notice Set the default batch sender for mock results
    /// @param sender The address to return as batch sender
    function setDefaultBatchSender(address sender) external {
        _defaultBatchSender = sender;
    }
    
    /// @notice Check if a batch is marked as valid in the mock
    /// @param batchHeight The batch height to check
    /// @return Whether the batch is valid
    function isBatchValid(uint64 batchHeight) external view returns (bool) {
        return _validBatches[batchHeight];
    }
} 