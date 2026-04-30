// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {SedaPythAdapter} from "../src/SedaPythAdapter.sol";

contract DeployPythAdapterScript is Script {
    function run() external returns (address proxy) {
        address prover = vm.envAddress("PROVER_ADDRESS");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast();

        proxy = Upgrades.deployUUPSProxy(
            "SedaPythAdapter.sol:SedaPythAdapter", abi.encodeCall(SedaPythAdapter.initialize, (prover, owner))
        );

        vm.stopBroadcast();

        console2.log("SedaPythAdapter proxy:", proxy);
    }
}
