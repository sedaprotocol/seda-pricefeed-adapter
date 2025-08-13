// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PriceFeedAdapter} from "../PriceFeedAdapter.sol";

contract PriceFeedAdapterV2 is PriceFeedAdapter {
    // No constructor needed for upgradeable contracts
    // The initialize function handles initialization
    
    function version() public pure returns (uint256) {
        return 2;
    }
}