// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UnsafeUpgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {SedaPythAdapter} from "../src/SedaPythAdapter.sol";
import {SedaPythAdapterV2Mock} from "./mocks/SedaPythAdapterV2Mock.sol";

contract SedaPythAdapterUpgradeTest is Test {
    address internal constant PROVER = address(0x1000000000000000000000000000000000000001);
    address internal constant OWNER = address(0xBEEF);

    function test_upgradePreservesStateAndExposesV2Surface() external {
        address implementationV1 = address(new SedaPythAdapter());
        address proxy = UnsafeUpgrades.deployUUPSProxy(
            implementationV1,
            abi.encodeCall(SedaPythAdapter.initialize, (PROVER, OWNER))
        );

        SedaPythAdapter adapterV1 = SedaPythAdapter(proxy);
        assertEq(adapterV1.owner(), OWNER);
        assertEq(adapterV1.getProver(), PROVER);

        address implementationV2 = address(new SedaPythAdapterV2Mock());
        UnsafeUpgrades.upgradeProxy(
            proxy,
            implementationV2,
            abi.encodeCall(SedaPythAdapterV2Mock.initializeV2, ()),
            OWNER
        );

        SedaPythAdapterV2Mock adapterV2 = SedaPythAdapterV2Mock(proxy);
        assertEq(adapterV2.owner(), OWNER);
        assertEq(adapterV2.getProver(), PROVER);
        assertEq(adapterV2.version(), 2);
    }
}
