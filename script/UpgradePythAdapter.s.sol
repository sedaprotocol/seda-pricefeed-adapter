// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract UpgradePythAdapterScript is Script {
    /// @notice Upgrade the SedaPythAdapter UUPS proxy at `PROXY_ADDRESS` to `IMPLEMENTATION_ARTIFACT`.
    /// @dev Init calldata, in priority order:
    ///      1. `INITIALIZE_DATA` (hex bytes) — used as-is. Required when V2's reinitializer takes args.
    ///      2. `CALL_INITIALIZE_V2=true` — encodes `initializeV2()` (no-arg). Convenience for the local mock.
    ///      3. Otherwise, no init call is performed.
    function run() external {
        address proxy = vm.envAddress("PROXY_ADDRESS");
        string memory implementation = vm.envString("IMPLEMENTATION_ARTIFACT");

        bytes memory data;
        string memory rawData = vm.envOr("INITIALIZE_DATA", string(""));
        if (bytes(rawData).length > 0) {
            data = vm.parseBytes(rawData);
        } else if (vm.envOr("CALL_INITIALIZE_V2", false)) {
            data = abi.encodeWithSignature("initializeV2()");
        }

        vm.startBroadcast();
        Upgrades.upgradeProxy(proxy, implementation, data);
        vm.stopBroadcast();
    }
}
