// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {FastProver} from "../src/prover/FastProver.sol";

contract DeployFastProverScript is Script {
    /// @dev ERC1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant _IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

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

        _saveDeployment(proxy);
    }

    function _saveDeployment(address proxy) internal {
        string memory name = vm.envOr("DEPLOYMENT_NAME", string(""));
        if (bytes(name).length == 0) return;

        address impl = address(uint160(uint256(vm.load(proxy, _IMPL_SLOT))));

        string memory fp = "fp";
        vm.serializeAddress(fp, "proxy", proxy);
        string memory fpJson = vm.serializeAddress(fp, "implementation", impl);

        string memory c = "contracts";
        string memory cJson = vm.serializeString(c, "FastProver", fpJson);

        string memory root = "root";
        vm.serializeString(root, "network", name);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "deployer", msg.sender);
        vm.serializeString(root, "version", _gitVersion());
        vm.serializeUint(root, "timestamp", block.timestamp);
        string memory rootJson = vm.serializeString(root, "contracts", cJson);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), "-", name, ".json");
        vm.writeJson(rootJson, path);
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

    function _parseAddresses(string memory csv) internal pure returns (address[] memory addresses) {
        if (bytes(csv).length == 0) return new address[](0);

        string[] memory parts = vm.split(csv, ",");
        addresses = new address[](parts.length);
        for (uint256 i = 0; i < parts.length; ++i) {
            addresses[i] = vm.parseAddress(parts[i]);
        }
    }
}
