// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {FastProver} from "../src/prover/FastProver.sol";

contract UpdateFastProverKeysScript is Script {
    function run() external {
        address proverAddress = vm.envAddress("PROVER_ADDRESS");
        address[] memory addKeys = _parseAddresses(vm.envOr("ADD_TRUSTED_KEYS", string("")));
        address[] memory removeKeys = _parseAddresses(vm.envOr("REMOVE_TRUSTED_KEYS", string("")));

        vm.startBroadcast();

        FastProver prover = FastProver(proverAddress);
        for (uint256 i = 0; i < addKeys.length; ++i) {
            prover.addTrustedKey(addKeys[i]);
        }
        for (uint256 i = 0; i < removeKeys.length; ++i) {
            prover.removeTrustedKey(removeKeys[i]);
        }

        vm.stopBroadcast();
    }

    function _parseAddresses(string memory csv) internal pure returns (address[] memory addresses) {
        if (bytes(csv).length == 0) return new address[](0);

        string[] memory parts = vm.split(csv, ",");
        addresses = new address[](parts.length);
        for (uint256 i = 0; i < parts.length; ++i) {
            addresses[i] = vm.parseAddress(parts[i]);
        }
    }
}
