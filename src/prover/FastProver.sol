// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BaseUpgradeable} from "../base/BaseUpgradeable.sol";

/// @title FastProver
/// @author Open Oracle Association
/// @notice UUPS upgradeable, pausable, ownable prover that verifies SEDA FAST attestations via ECDSA.
/// @dev Manages a set of trusted signer addresses and exposes a view that recovers the signer
///      from a `(dataHash, signature)` pair and asserts it is currently trusted.
/// @custom:security Administrative functions are onlyOwner. The contract is pausable for emergencies.
/// @custom:upgrades UUPS upgrade pattern with ERC-7201 namespaced storage.
contract FastProver is BaseUpgradeable {
    using ECDSA for bytes32;

    // ============ Custom Errors ============

    /// @notice Thrown when attempting to add a zero address as a trusted key
    error InvalidKeyAddress();

    /// @notice Thrown when attempting to add a duplicate trusted key
    /// @param key The signer address that is already trusted
    error DuplicateTrustedKey(address key);

    /// @notice Thrown when attempting to remove a non-existent trusted key
    /// @param key The signer address that is not in the trusted set
    error TrustedKeyNotFound(address key);

    /// @notice Thrown when signature verification fails (signer not trusted)
    /// @param signer The address of the signer that failed verification
    error SignatureVerificationFailed(address signer);

    // ============ Constants ============

    /// @notice Version of the contract for upgrade tracking
    uint256 public constant VERSION = 1;

    // ============ ERC-7201 Namespaced Storage ============

    /// @notice Storage layout for FastProver (v1).
    /// @dev Do not change the order of fields. For new fields, append at the end.
    ///      Annotated per ERC-7201 so OpenZeppelin Upgrades validates layout across upgrades.
    /// @custom:storage-location erc7201:fastprover.storage.v1
    struct FastProverStorage {
        mapping(address key => bool trusted) trustedKeys;
        address[] trustedKeysList;
    }

    /// @dev `keccak256(abi.encode(uint256(keccak256("fastprover.storage.v1")) - 1)) & ~bytes32(uint256(0xff))`
    bytes32 private constant FastProverStorageLocation =
        keccak256(abi.encode(uint256(keccak256("fastprover.storage.v1")) - 1)) & ~bytes32(uint256(0xff));

    /// @notice Returns the namespaced storage struct.
    /// @dev The slot is loaded via a stack variable because inline assembly cannot reference
    ///      `constant` values that are computed via expressions (only direct number literals).
    function _getFastProverStorage() private pure returns (FastProverStorage storage $) {
        bytes32 slot = FastProverStorageLocation;
        assembly {
            $.slot := slot
        }
    }

    // ============ Events ============

    /// @notice Emitted when a new trusted signer is added
    /// @param key The trusted signer address that was added
    /// @param addedBy The address that added the key
    event TrustedKeyAdded(address indexed key, address indexed addedBy);

    /// @notice Emitted when a trusted signer is removed
    /// @param key The trusted signer address that was removed
    /// @param removedBy The address that removed the key
    event TrustedKeyRemoved(address indexed key, address indexed removedBy);

    // ============ Initialization ============

    /// @notice Initializes the contract with the initial owner
    /// @param initialOwner The address that will be the initial owner
    function initialize(address initialOwner) public initializer {
        __BaseUpgradeable_init(initialOwner);
    }

    // ============ Trusted Key Management ============

    /// @notice Adds a new trusted signer address for FAST ECDSA attestations
    /// @param key The signer address to trust
    function addTrustedKey(address key) external onlyOwner {
        if (key == address(0)) revert InvalidKeyAddress();

        FastProverStorage storage $ = _getFastProverStorage();
        if ($.trustedKeys[key]) {
            revert DuplicateTrustedKey(key);
        }

        $.trustedKeys[key] = true;
        $.trustedKeysList.push(key);

        emit TrustedKeyAdded(key, msg.sender);
    }

    /// @notice Removes a trusted signer address
    /// @param key The signer address to remove from the trusted set
    function removeTrustedKey(address key) external onlyOwner {
        FastProverStorage storage $ = _getFastProverStorage();
        if (!$.trustedKeys[key]) {
            revert TrustedKeyNotFound(key);
        }

        $.trustedKeys[key] = false;

        // Remove from array by swapping with last element and popping
        for (uint256 i = 0; i < $.trustedKeysList.length; ++i) {
            if ($.trustedKeysList[i] == key) {
                $.trustedKeysList[i] = $.trustedKeysList[$.trustedKeysList.length - 1];
                $.trustedKeysList.pop();
                break;
            }
        }

        emit TrustedKeyRemoved(key, msg.sender);
    }

    /// @notice Gets the total number of trusted keys
    /// @return The number of trusted keys
    function getTrustedKeysCount() external view returns (uint256) {
        return _getFastProverStorage().trustedKeysList.length;
    }

    /// @notice Gets all trusted signer addresses
    /// @return An array of all trusted signer addresses
    function getAllTrustedKeys() external view returns (address[] memory) {
        return _getFastProverStorage().trustedKeysList;
    }

    /// @notice Checks if a signer address is trusted
    /// @param key The signer address to check
    /// @return True if the address is trusted, false otherwise
    function isTrustedKey(address key) external view returns (bool) {
        return _getFastProverStorage().trustedKeys[key];
    }

    // ============ Data Verification ============

    /// @notice Verifies that `dataHash` was signed by a trusted FAST signer (ECDSA)
    /// @param dataHash The 32-byte message hash the signature was produced over
    /// @param signature The ECDSA signature to verify
    /// @return attester The recovered signer address (must be trusted)
    /// @dev Reverts with SignatureVerificationFailed if the signature is invalid or from an untrusted key
    function verifyData(bytes32 dataHash, bytes calldata signature)
        external
        view
        whenNotPaused
        returns (address attester)
    {
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

        if (!_getFastProverStorage().trustedKeys[signer]) {
            revert SignatureVerificationFailed(signer);
        }

        return signer;
    }
}
