// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BaseUpgradeable} from "./base/BaseUpgradeable.sol";
import {FastProverStorage} from "./storage/FastProverStorage.sol";

/// @title FastProver
/// @author Open Oracle Association
/// @notice UUPS upgradeable, pausable, ownable prover that verifies SEDA FAST attestations via ECDSA.
/// @dev Manages a set of trusted signer addresses and exposes a view that recovers the signer
///      from a `(dataHash, signature)` pair and asserts it is currently trusted.
/// @custom:security Administrative functions are onlyOwner. The contract is pausable for emergencies.
/// @custom:upgrades UUPS upgrade pattern.
contract FastProver is BaseUpgradeable {
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

    // ============ State Variables ============

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
        __BaseUpgradeable_init(initialOwner);
    }

    // ============ Trusted Key Management ============

    /// @notice Adds a new trusted public key
    /// @param key The public key to add as trusted
    function addTrustedKey(address key) external onlyOwner {
        if (key == address(0)) revert InvalidKeyAddress();

        FastProverStorage.Layout storage s = FastProverStorage.layout();
        if (s.trustedKeys[key]) {
            revert DuplicateTrustedKey(key);
        }

        s.trustedKeys[key] = true;
        s.trustedKeysList.push(key);

        emit TrustedKeyAdded(key, msg.sender);
    }

    /// @notice Removes a trusted public key
    /// @param key The public key to remove from trusted keys
    function removeTrustedKey(address key) external onlyOwner {
        FastProverStorage.Layout storage s = FastProverStorage.layout();
        if (!s.trustedKeys[key]) {
            revert TrustedKeyNotFound(key);
        }

        s.trustedKeys[key] = false;

        // Remove from array by swapping with last element and popping
        for (uint256 i = 0; i < s.trustedKeysList.length; ++i) {
            if (s.trustedKeysList[i] == key) {
                s.trustedKeysList[i] = s.trustedKeysList[s.trustedKeysList.length - 1];
                s.trustedKeysList.pop();
                break;
            }
        }

        emit TrustedKeyRemoved(key, msg.sender);
    }

    /// @notice Gets the total number of trusted keys
    /// @return The number of trusted keys
    function getTrustedKeysCount() external view returns (uint256) {
        return FastProverStorage.layout().trustedKeysList.length;
    }

    /// @notice Gets all trusted keys
    /// @return An array of all trusted public keys
    function getAllTrustedKeys() external view returns (address[] memory) {
        return FastProverStorage.layout().trustedKeysList;
    }

    /// @notice Checks if a key is trusted
    /// @param key The public key to check
    /// @return True if the key is trusted, false otherwise
    function isTrustedKey(address key) external view returns (bool) {
        return FastProverStorage.layout().trustedKeys[key];
    }

    // ============ Data Verification ============

    /// @notice Verifies price data using ECDSA signatures from trusted FAST keys
    /// @param dataHash The hash of the price data to verify
    /// @param signature The ECDSA signature to verify
    /// @return attester The address of the attester that signed the price data
    /// @dev Reverts with SignatureVerificationFailed if the signature is invalid or from an untrusted key
    function verifyData(
        bytes32 dataHash,
        bytes calldata signature
    ) external view whenNotPaused returns (address attester) {
        return _verifySignature(dataHash, signature);
    }

    /// @notice Internal function to verify signatures (common logic)
    /// @param messageHash The hash of the message to verify
    /// @param signature The ECDSA signature to verify
    /// @return attester The address of the attester that signed the message
    /// @dev Reverts with SignatureVerificationFailed if the signature is invalid or from an untrusted key.
    ///      Normalizes the v-byte from raw secp256k1 ({0, 1}) to Ethereum canonical ({27, 28})
    ///      so signatures emitted by the SEDA FAST service verify as-is.
    ///      TODO(seda-fast): remove this normalization once the SEDA FAST service emits
    ///      Ethereum-canonical v bytes natively; the relayer/submitter will no longer need it.
    function _verifySignature(bytes32 messageHash, bytes calldata signature) internal view returns (address attester) {
        // Copy calldata to memory so we can normalize the v-byte in place.
        // ECDSA.recover(bytes) handles length/format validation.
        bytes memory sig = signature;
        if (sig.length == 65) {
            uint8 v = uint8(sig[64]);
            if (v < 27) sig[64] = bytes1(v + 27);
        }

        address signer = messageHash.recover(sig);

        if (!FastProverStorage.layout().trustedKeys[signer]) {
            revert SignatureVerificationFailed(signer);
        }

        return signer;
    }

    // ============ Utility Functions ============

    /// @notice Returns the version of the contract
    /// @return The version number
    function version() public pure returns (uint256) {
        return VERSION;
    }
}
