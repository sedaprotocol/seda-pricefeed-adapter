// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title BaseAdapter
/// @author Open Oracle Association
/// @notice Base contract for price feed adapters with common admin functionality
/// @dev Provides common upgradeable contract functionality without oracle-specific logic
/// @custom:upgrades UUPS upgradeable
abstract contract BaseAdapter is Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    // ============ Custom Errors ============

    /// @notice Thrown when a zero address is provided where a valid address is required
    /// @param parameter The name of the parameter that cannot be zero address
    error ZeroAddressNotAllowed(string parameter);

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    /// @notice Disables initializers to prevent future reinitialization
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the base contract with owner
    /// @param owner Address that will have administrative privileges
    function __BaseAdapter_init(address owner) internal onlyInitializing {
        // solhint-disable-previous-line func-name-mixedcase
        if (owner == address(0)) revert ZeroAddressNotAllowed("owner");
        __Ownable_init(owner);
        __UUPSUpgradeable_init();
        __Pausable_init();
    }

    // ============ External Functions ============

    /// @notice Pauses the contract, preventing new operations (owner only)
    /// @dev This is an emergency function to stop all operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract, allowing operations to resume (owner only)
    /// @dev This function can only be called by the owner
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal Functions ============

    /// @notice Required by the OZ UUPS module
    /// @dev Only the owner can upgrade the contract
    /// @param newImplementation Address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        if (newImplementation == address(0)) revert ZeroAddressNotAllowed("implementation");
    }
}
