// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {FastProver} from "../src/prover/FastProver.sol";

contract DeployFastProverScript is Script {
    function run() external returns (address proxy) {
        address owner = vm.envAddress("OWNER");
        address[] memory trustedKeys = _parseAddresses(vm.envOr("TRUSTED_KEYS", string("")));

        vm.startBroadcast();

        proxy = Upgrades.deployUUPSProxy("FastProver.sol:FastProver", abi.encodeCall(FastProver.initialize, (owner)));

        FastProver prover = FastProver(proxy);
        for (uint256 i = 0; i < trustedKeys.length; ++i) {
            prover.addTrustedKey(trustedKeys[i]);
        }

        vm.stopBroadcast();

        console2.log("FastProver proxy:", proxy);
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
