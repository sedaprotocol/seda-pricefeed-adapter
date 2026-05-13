// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {SedaPythAdapter} from "../src/SedaPythAdapter.sol";

contract DeployPythAdapterScript is Script {
    /// @dev ERC1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant _IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external returns (address proxy) {
        address prover = vm.envAddress("PROVER_ADDRESS");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast();

        proxy = Upgrades.deployUUPSProxy(
            "SedaPythAdapter.sol:SedaPythAdapter", abi.encodeCall(SedaPythAdapter.initialize, (prover, owner))
        );

        vm.stopBroadcast();

        console2.log("SedaPythAdapter proxy:", proxy);

        _saveDeployment(proxy);
    }

    function _saveDeployment(address proxy) internal {
        string memory name = vm.envOr("DEPLOYMENT_NAME", string(""));
        if (bytes(name).length == 0) return;

        address impl = address(uint160(uint256(vm.load(proxy, _IMPL_SLOT))));

        string memory sa = "sa";
        vm.serializeAddress(sa, "proxy", proxy);
        string memory saJson = vm.serializeAddress(sa, "implementation", impl);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), "-", name, ".json");

        if (vm.isFile(path)) {
            vm.writeJson(saJson, path, ".contracts.SedaPythAdapter");
        } else {
            string memory c = "contracts";
            string memory cJson = vm.serializeString(c, "SedaPythAdapter", saJson);

            string memory root = "root";
            vm.serializeString(root, "network", name);
            vm.serializeUint(root, "chainId", block.chainid);
            vm.serializeAddress(root, "deployer", msg.sender);
            vm.serializeString(root, "version", _gitVersion());
            vm.serializeUint(root, "timestamp", block.timestamp);
            string memory rootJson = vm.serializeString(root, "contracts", cJson);

            vm.writeJson(rootJson, path);
        }
        console2.log("Deployment saved to:", path);
    }

    function _gitVersion() internal returns (string memory) {
        string[] memory cmd = new string[](5);
        cmd[0] = "git";
        cmd[1] = "describe";
        cmd[2] = "--tags";
        cmd[3] = "--always";
        cmd[4] = "--dirty";
        return vm.trim(string(vm.ffi(cmd)));
    }
}
