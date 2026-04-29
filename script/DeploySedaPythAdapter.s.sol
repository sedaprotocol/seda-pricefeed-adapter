// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {SedaPythAdapter} from "../src/SedaPythAdapter.sol";

contract DeploySedaPythAdapterScript is Script {
    function run() external returns (address proxy) {
        address prover = vm.envAddress("SEDA_PROVER");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast();

        proxy = Upgrades.deployUUPSProxy(
            "SedaPythAdapter.sol:SedaPythAdapter",
            abi.encodeCall(SedaPythAdapter.initialize, (prover, owner))
        );

        vm.stopBroadcast();
    }
}
