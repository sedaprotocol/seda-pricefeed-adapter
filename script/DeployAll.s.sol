// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {FastProver} from "../src/prover/FastProver.sol";
import {SedaPythAdapter} from "../src/SedaPythAdapter.sol";

contract DeployAllScript is Script {
    function run() external returns (address proverProxy, address adapterProxy) {
        address owner = vm.envAddress("OWNER");
        address[] memory trustedKeys = _parseAddresses(vm.envOr("TRUSTED_KEYS", string("")));

        vm.startBroadcast();

        proverProxy =
            Upgrades.deployUUPSProxy("FastProver.sol:FastProver", abi.encodeCall(FastProver.initialize, (owner)));

        FastProver prover = FastProver(proverProxy);
        for (uint256 i = 0; i < trustedKeys.length; ++i) {
            prover.addTrustedKey(trustedKeys[i]);
        }

        adapterProxy = Upgrades.deployUUPSProxy(
            "SedaPythAdapter.sol:SedaPythAdapter", abi.encodeCall(SedaPythAdapter.initialize, (proverProxy, owner))
        );

        vm.stopBroadcast();

        console2.log("FastProver proxy:", proverProxy);
        console2.log("SedaPythAdapter proxy:", adapterProxy);
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
