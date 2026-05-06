// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {FastProver} from "../../src/prover/FastProver.sol";
import {FastProverV2Mock} from "../../script/mocks/FastProverV2Mock.sol";

/// @notice Validates the FastProver UUPS upgrade flow end-to-end via the OpenZeppelin Upgrades
///         plugin, which runs initializer + ERC-7201 namespaced storage layout validation under
///         the hood. Requires `node`/`npx` on PATH and `ffi = true` in foundry.toml.
contract FastProverUpgradeTest is Test {
    address internal constant OWNER = address(0xBEEF);
    address internal constant TRUSTED_KEY = address(0xCAFE);

    function test_upgradePreservesStateAndExposesV2Surface() external {
        address proxy =
            Upgrades.deployUUPSProxy("FastProver.sol:FastProver", abi.encodeCall(FastProver.initialize, (OWNER)));

        FastProver proverV1 = FastProver(proxy);
        vm.prank(OWNER);
        proverV1.addTrustedKey(TRUSTED_KEY);

        assertTrue(proverV1.isTrustedKey(TRUSTED_KEY));
        assertEq(proverV1.getTrustedKeysCount(), 1);
        assertEq(proverV1.owner(), OWNER);

        Upgrades.upgradeProxy(
            proxy, "FastProverV2Mock.sol:FastProverV2Mock", abi.encodeCall(FastProverV2Mock.initializeV2, ()), OWNER
        );

        FastProverV2Mock proverV2 = FastProverV2Mock(proxy);
        assertTrue(proverV2.isTrustedKey(TRUSTED_KEY));
        assertEq(proverV2.getTrustedKeysCount(), 1);
        assertEq(proverV2.owner(), OWNER);
        assertEq(proverV2.version(), 2);
    }
}
