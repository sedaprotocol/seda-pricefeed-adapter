// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CoreAdapter} from "../CoreAdapter.sol";

contract CoreAdapterV2 is CoreAdapter {
    // No constructor needed for upgradeable contracts
    // The initialize function handles initialization

    function version() public pure returns (uint256) {
        return 2;
    }
}
