// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreAdapter} from "../CoreAdapter.sol";
import {CoreAdapterStorage} from "../storage/CoreAdapterStorage.sol";

contract CoreAdapterV2 is CoreAdapter {
    // Fresh-deploy initializer for V2 (deploy-safe)
    /// @custom:oz-upgrades-validate-as-initializer
    function initialize(
        address sedaProverAddress,
        address priceFeedImplementation,
        address owner,
        CoreAdapterStorage.PriceFeedConfig memory _priceFeedConfig
    ) public override initializer {
        super.initialize(sedaProverAddress, priceFeedImplementation, owner, _priceFeedConfig);
    }

    // Upgrade-only initializer for NEW V2 state (optional if you add new vars)
    function initializeV2() external reinitializer(2) {
        // Initialize ONLY new state introduced in V2.
        // Do NOT touch v1 state or call v1 initializers again.
        // If you added new base contracts that require init, call their *_init() here.
    }

    function version() public pure returns (uint256) {
        return 2;
    }
}
