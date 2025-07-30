// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProver} from "@seda-protocol/evm/contracts/interfaces/IProver.sol";
import {SedaDataTypes} from "@seda-protocol/evm/contracts/libraries/SedaDataTypes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PriceFeedAdapter
/// @notice A specialized adapter contract for processing and verifying SEDA oracle price feed results
/// @dev This contract focuses on result verification rather than request creation
contract PriceFeedAdapter is Ownable, ReentrancyGuard {
    
    // ============ Events ============
    
    /// @notice Emitted when a result is successfully verified and processed
    event ResultVerified(
        bytes32 indexed requestId, 
        string indexed symbol, 
        uint256 price, 
        uint64 batchHeight,
        address batchSender
    );
    
    /// @notice Emitted when result verification fails
    event VerificationFailed(bytes32 indexed requestId, string reason);
    
    /// @notice Emitted when the SEDA prover address is updated
    event ProverUpdated(address indexed oldProver, address indexed newProver);
    
    // ============ State Variables ============
    
    /// @notice The SEDA SECP256k1 prover contract for result verification
    IProver public sedaProver;
    
    // ============ Constructor ============
    
    /// @notice Constructor to initialize the adapter
    /// @param sedaProverAddress Address of the SEDA SECP256k1 prover contract
    /// @param owner Address of the contract owner
    constructor(address sedaProverAddress, address owner) Ownable(owner) {
        require(sedaProverAddress != address(0), "Invalid prover address");
        sedaProver = IProver(sedaProverAddress);
    }
    
    /// @notice Submit and verify an oracle result
    /// @param result The oracle result data
    /// @param batchHeight The height of the batch containing the result
    /// @param merkleProof The Merkle proof for verifying the result
    /// @return success Whether the verification and processing succeeded
    function submitResult(
        SedaDataTypes.Result calldata result,
        uint64 batchHeight,
        bytes32[] calldata merkleProof
    ) external nonReentrant returns (bool success) {
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
            uint256 price = this.decodePriceResult(result.result);
            if (price > 0) {
                emit ResultVerified(result.drId, "symbol", price, batchHeight, batchSender);
                return true;
            } else {
                emit VerificationFailed(result.drId, "Failed to extract price");
                return false;
            }
        } else {
            emit VerificationFailed(result.drId, result.consensus ? "Oracle execution failed" : "No consensus reached");
            return false;
        }
    }
    
    /// @notice Get the symbol associated with a request ID
    /// @param requestId The request identifier
    /// @return symbol The trading symbol for this request
    function getRequestSymbol(bytes32 requestId) external view returns (string memory) {
        return "TODO";
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
        require(newProver != address(0), "Invalid prover address");
        address oldProver = address(sedaProver);
        sedaProver = IProver(newProver);
        emit ProverUpdated(oldProver, newProver);
    }
    
    /// @notice External function to decode price result (for try/catch error handling)
    /// @param resultData The raw result data
    /// @return price The decoded price
    function decodePriceResult(bytes calldata resultData) external pure returns (uint256 price) {
        return abi.decode(resultData, (uint256));
    }
    
    // ============ View Functions ============
    
    /// @notice Get the current SEDA prover address
    /// @return The address of the SEDA prover contract
    function getProver() external view returns (address) {
        return address(sedaProver);
    }
    
    /// @notice Get the last batch height from the prover
    /// @return The height of the last batch
    function getLastBatchHeight() external view returns (uint64) {
        return sedaProver.getLastBatchHeight();
    }
} 