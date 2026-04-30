// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {FastProverV2Mock} from "../test/mocks/FastProverV2Mock.sol";

contract UpgradeFastProverScript is Script {
    function run() external {
        address proxy = vm.envAddress("PROXY_ADDRESS");
        string memory implementation = vm.envString("IMPLEMENTATION_ARTIFACT");
        bool callInitializeV2 = vm.envOr("CALL_INITIALIZE_V2", false);
        bytes memory data = callInitializeV2 ? abi.encodeCall(FastProverV2Mock.initializeV2, ()) : bytes("");

        vm.startBroadcast();
        Upgrades.upgradeProxy(proxy, implementation, data);
        vm.stopBroadcast();
    }
}
