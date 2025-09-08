// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// TODO: Consider using ERC-7201 pattern for improved upgradeability and storage layout safety.

/// @title SedaFastProver
/// @author Open Oracle Association
/// @notice A UUPS upgradeable, pausable, and ownable contract for verifying price feed data
///         using ECDSA signatures from trusted FAST keys
/// @dev This contract is specifically designed for the SEDA price feed adapter system. It manages
///      multiple trusted public keys and provides data verification using ECDSA signatures.
///      The contract focuses on verifying price data hashes, which is the primary use case for
///      the price feed adapter. It implements the UUPS upgrade pattern for upgradeability,
///      includes pausable functionality for emergency situations, and provides ownable
///      access control for administrative functions.
/// @custom:security This contract inherits from OpenZeppelin's upgradeable contracts and includes
///                   validation of ECDSA signatures and administrative controls. The contract is pausable
///                   and only the owner can perform administrative functions.
/// @custom:upgrades This contract uses UUPS upgrade pattern for upgradeability.
contract FastProver is Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    using ECDSA for bytes32;

    // ============ Custom Errors ============

    /// @notice Thrown when attempting to add a zero address as a trusted key
    error InvalidKeyAddress();

    /// @notice Thrown when attempting to add a duplicate trusted key
    /// @param key The public key that already exists
    error DuplicateTrustedKey(address key);

    /// @notice Thrown when attempting to remove a non-existent trusted key
    /// @param key The public key that doesn't exist
    error TrustedKeyNotFound(address key);

    /// @notice Thrown when signature verification fails (signer not trusted)
    /// @param signer The address of the signer that failed verification
    error SignatureVerificationFailed(address signer);

    /// @notice Thrown when attempting to initialize a contract that has already been initialized
    error AlreadyInitialized();

    // ============ State Variables ============

    /// @notice Mapping of trusted public keys to their enabled status
    mapping(address => bool) public trustedKeys;

    /// @notice Array of all trusted public keys for enumeration
    address[] public trustedKeysList;

    /// @notice Mapping to track if a key exists in the trustedKeysList array
    mapping(address => bool) private keyExists;

    /// @notice Version of the contract for upgrade tracking
    uint256 public constant VERSION = 1;

    // ============ Events ============

    /// @notice Emitted when a new trusted key is added
    /// @param key The public key that was added
    /// @param addedBy The address that added the key
    event TrustedKeyAdded(address indexed key, address indexed addedBy);

    /// @notice Emitted when a trusted key is removed
    /// @param key The public key that was removed
    /// @param removedBy The address that removed the key
    event TrustedKeyRemoved(address indexed key, address indexed removedBy);

    // ============ Initialization ============

    /// @notice Initializes the contract with the initial owner
    /// @param initialOwner The address that will be the initial owner
    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
        __UUPSUpgradeable_init();
    }

    // ============ UUPS Upgrade Authorization ============

    /// @notice Authorizes upgrades (only owner can upgrade)
    /// @param newImplementation The address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner
    // solhint-disable-next-line no-empty-blocks
    {
        
    }

    // ============ Trusted Key Management ============

    /// @notice Adds a new trusted public key
    /// @param key The public key to add as trusted
    function addTrustedKey(address key) external onlyOwner whenNotPaused {
        if (key == address(0)) revert InvalidKeyAddress();

        if (trustedKeys[key]) {
            revert DuplicateTrustedKey(key);
        }

        trustedKeys[key] = true;
        trustedKeysList.push(key);
        keyExists[key] = true;

        emit TrustedKeyAdded(key, msg.sender);
    }

    /// @notice Removes a trusted public key
    /// @param key The public key to remove from trusted keys
    function removeTrustedKey(address key) external onlyOwner whenNotPaused {
        if (!trustedKeys[key]) {
            revert TrustedKeyNotFound(key);
        }

        trustedKeys[key] = false;
        keyExists[key] = false;

        // Remove from array by swapping with last element and popping
        for (uint256 i = 0; i < trustedKeysList.length; ++i) {
            if (trustedKeysList[i] == key) {
                trustedKeysList[i] = trustedKeysList[trustedKeysList.length - 1];
                trustedKeysList.pop();
                break;
            }
        }

        emit TrustedKeyRemoved(key, msg.sender);
    }

    /// @notice Gets the total number of trusted keys
    /// @return The number of trusted keys
    function getTrustedKeysCount() external view returns (uint256) {
        return trustedKeysList.length;
    }

    /// @notice Gets all trusted keys
    /// @return An array of all trusted public keys
    function getAllTrustedKeys() external view returns (address[] memory) {
        return trustedKeysList;
    }

    /// @notice Checks if a key is trusted
    /// @param key The public key to check
    /// @return True if the key is trusted, false otherwise
    function isTrustedKey(address key) external view returns (bool) {
        return trustedKeys[key];
    }

    // ============ Pausable Functions ============

    /// @notice Pauses the contract (only owner)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract (only owner)
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Data Verification ============

    /// @notice Verifies price data using ECDSA signatures from trusted FAST keys
    /// @param dataHash The hash of the price data to verify
    /// @param signature The ECDSA signature to verify
    /// @return valid True if the signature is valid and from a trusted key
    /// @return attester The address of the attester that signed the price data
    function verifyData(
        bytes32 dataHash,
        bytes calldata signature
    ) external view whenNotPaused returns (bool valid, address attester) {
        return _verifySignature(dataHash, signature);
    }

    /// @notice Internal function to verify signatures (common logic)
    /// @param messageHash The hash of the message to verify
    /// @param signature The ECDSA signature to verify
    /// @return valid True if the signature is valid and from a trusted key
    /// @return attester The address of the attester that signed the message
    function _verifySignature(
        bytes32 messageHash,
        bytes calldata signature
    ) internal view returns (bool valid, address attester) {
        // Recover the signer from the signature
        // ECDSA.recover() already validates signature length and format
        address signer = messageHash.recover(signature);

        // Check if the signer is a trusted key
        if (!trustedKeys[signer]) {
            revert SignatureVerificationFailed(signer);
        }

        return (true, signer);
    }

    // ============ Utility Functions ============

    /// @notice Returns the version of the contract
    /// @return The version number
    function version() public pure returns (uint256) {
        return VERSION;
    }
}
