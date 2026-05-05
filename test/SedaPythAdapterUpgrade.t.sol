// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {SedaPythAdapter} from "../src/SedaPythAdapter.sol";
import {SedaPythAdapterV2Mock} from "../script/mocks/SedaPythAdapterV2Mock.sol";

/// @notice Validates the SedaPythAdapter UUPS upgrade flow end-to-end via the OpenZeppelin
///         Upgrades plugin, which runs initializer + ERC-7201 namespaced storage layout
///         validation under the hood. Requires `node`/`npx` on PATH and `ffi = true` in foundry.toml.
contract SedaPythAdapterUpgradeTest is Test {
    address internal constant PROVER = address(0x1000000000000000000000000000000000000001);
    address internal constant OWNER = address(0xBEEF);

    function test_upgradePreservesStateAndExposesV2Surface() external {
        address proxy = Upgrades.deployUUPSProxy(
            "SedaPythAdapter.sol:SedaPythAdapter", abi.encodeCall(SedaPythAdapter.initialize, (PROVER, OWNER))
        );

        SedaPythAdapter adapterV1 = SedaPythAdapter(proxy);
        assertEq(adapterV1.owner(), OWNER);
        assertEq(adapterV1.getProver(), PROVER);

        Upgrades.upgradeProxy(
            proxy,
            "SedaPythAdapterV2Mock.sol:SedaPythAdapterV2Mock",
            abi.encodeCall(SedaPythAdapterV2Mock.initializeV2, ()),
            OWNER
        );

        SedaPythAdapterV2Mock adapterV2 = SedaPythAdapterV2Mock(proxy);
        assertEq(adapterV2.owner(), OWNER);
        assertEq(adapterV2.getProver(), PROVER);
        assertEq(adapterV2.version(), 2);
    }
}
