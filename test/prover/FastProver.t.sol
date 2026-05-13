// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UnsafeUpgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import {BaseUpgradeable} from "../../src/base/BaseUpgradeable.sol";
import {FastProver} from "../../src/prover/FastProver.sol";
import {SedaPayloads} from "../helpers/SedaPayloads.sol";

/// @notice Unit tests for FastProver runtime behavior. Upgrade safety + ERC-7201 layout
///         validation live in `FastProver.upgrade.t.sol`; this file uses `UnsafeUpgrades`
///         to skip the per-test OZ validator subprocess (which is irrelevant for runtime
///         tests and slow when invoked once per `setUp()`).
contract FastProverTest is Test {
    address internal constant OWNER = address(0xBEEF);
    address internal constant USER = address(0xCAFE);

    FastProver internal prover;

    uint256 internal trustedPrivKey1;
    address internal trusted1;
    uint256 internal trustedPrivKey2;
    address internal trusted2;
    uint256 internal untrustedPrivKey;
    address internal untrusted;

    function setUp() public {
        address impl = address(new FastProver());
        address proxy = UnsafeUpgrades.deployUUPSProxy(impl, abi.encodeCall(FastProver.initialize, (OWNER)));
        prover = FastProver(proxy);

        (trustedPrivKey1, trusted1) = SedaPayloads.trustedKey("trusted1");
        (trustedPrivKey2, trusted2) = SedaPayloads.trustedKey("trusted2");
        (untrustedPrivKey, untrusted) = SedaPayloads.trustedKey("untrusted");
    }

    // ============ Init ============

    function test_initialize_setsOwnerAndVersion() public view {
        assertEq(prover.owner(), OWNER);
        assertEq(prover.VERSION(), 1);
    }

    function test_initialize_revertsOnZeroOwner() public {
        address impl = address(new FastProver());
        vm.expectRevert(abi.encodeWithSelector(BaseUpgradeable.ZeroAddressNotAllowed.selector, "owner"));
        UnsafeUpgrades.deployUUPSProxy(impl, abi.encodeCall(FastProver.initialize, (address(0))));
    }

    function test_initialize_revertsOnSecondCall() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        prover.initialize(USER);
    }

    // ============ Trusted-key management ============

    function test_addTrustedKey_storesAndEmits() public {
        vm.expectEmit(address(prover));
        emit FastProver.TrustedKeyAdded(trusted1, OWNER);

        vm.prank(OWNER);
        prover.addTrustedKey(trusted1);

        assertTrue(prover.isTrustedKey(trusted1));
        assertEq(prover.getTrustedKeysCount(), 1);
    }

    function test_removeTrustedKey_clearsAndEmits() public {
        vm.startPrank(OWNER);
        prover.addTrustedKey(trusted1);
        prover.addTrustedKey(trusted2);

        vm.expectEmit(address(prover));
        emit FastProver.TrustedKeyRemoved(trusted2, OWNER);

        prover.removeTrustedKey(trusted2);
        vm.stopPrank();

        assertFalse(prover.isTrustedKey(trusted2));
        assertTrue(prover.isTrustedKey(trusted1));
        assertEq(prover.getTrustedKeysCount(), 1);
    }

    function test_getAllTrustedKeys_reflectsAddRemoveSequence() public {
        vm.startPrank(OWNER);

        assertEq(prover.getAllTrustedKeys().length, 0);

        prover.addTrustedKey(trusted1);
        address[] memory afterFirst = prover.getAllTrustedKeys();
        assertEq(afterFirst.length, 1);
        assertEq(afterFirst[0], trusted1);

        prover.addTrustedKey(trusted2);
        address[] memory afterSecond = prover.getAllTrustedKeys();
        assertEq(afterSecond.length, 2);
        assertEq(afterSecond[0], trusted1);
        assertEq(afterSecond[1], trusted2);

        prover.removeTrustedKey(trusted1);
        address[] memory afterRemoval = prover.getAllTrustedKeys();
        assertEq(afterRemoval.length, 1);
        // Swap-pop puts the previously-last element at index 0.
        assertEq(afterRemoval[0], trusted2);

        vm.stopPrank();
    }

    function test_addTrustedKey_revertsOnDuplicate() public {
        vm.startPrank(OWNER);
        prover.addTrustedKey(trusted1);

        vm.expectRevert(abi.encodeWithSelector(FastProver.DuplicateTrustedKey.selector, trusted1));
        prover.addTrustedKey(trusted1);
        vm.stopPrank();
    }

    function test_addTrustedKey_revertsOnZeroAddress() public {
        vm.prank(OWNER);
        vm.expectRevert(FastProver.InvalidKeyAddress.selector);
        prover.addTrustedKey(address(0));
    }

    /// @notice `onlyOwner` short-circuits before either `DuplicateTrustedKey` or
    ///         `TrustedKeyNotFound` runs, so one `USER`-pranked block covers both
    ///         entry points without needing per-test seeding.
    function test_keyManagement_revertsForNonOwner() public {
        bytes memory expected = abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, USER);

        vm.startPrank(USER);
        vm.expectRevert(expected);
        prover.addTrustedKey(trusted1);
        vm.expectRevert(expected);
        prover.removeTrustedKey(trusted1);
        vm.stopPrank();
    }

    function test_removeTrustedKey_revertsForUnknownKey() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(FastProver.TrustedKeyNotFound.selector, trusted1));
        prover.removeTrustedKey(trusted1);
    }

    // ============ verifyData ============

    function test_verifyData_recoversTrustedSigner() public {
        vm.prank(OWNER);
        prover.addTrustedKey(trusted1);

        bytes32 dataHash = keccak256("test data");
        // Sign with raw v ∈ {0,1} to exercise the FAST normalization branch in
        // `_verifySignature` (matches what the SEDA FAST service emits on the wire).
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedPrivKey1, dataHash);
        bytes memory rawSig = abi.encodePacked(r, s, v - 27);

        assertEq(prover.verifyData(dataHash, rawSig), trusted1);

        // Canonical v ∈ {27,28} skips the normalization branch — exercise it too.
        bytes memory canonicalSig = abi.encodePacked(r, s, v);
        assertEq(prover.verifyData(dataHash, canonicalSig), trusted1);
    }

    function test_verifyData_revertsForUntrustedSigner() public {
        vm.prank(OWNER);
        prover.addTrustedKey(trusted1);

        bytes32 dataHash = keccak256("test data");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(untrustedPrivKey, dataHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(abi.encodeWithSelector(FastProver.SignatureVerificationFailed.selector, untrusted));
        prover.verifyData(dataHash, sig);
    }

    function test_verifyData_revertsForMalformedSignature() public {
        vm.prank(OWNER);
        prover.addTrustedKey(trusted1);

        bytes memory bogus = hex"1234";
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, uint256(2)));
        prover.verifyData(keccak256("test data"), bogus);
    }

    // ============ Pause ============

    /// @notice `onlyOwner` short-circuits before any pause-state check, so this
    ///         covers both `pause()` and `unpause()` without seeding paused state.
    function test_pauseUnpause_revertsForNonOwner() public {
        bytes memory expected = abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, USER);

        vm.startPrank(USER);
        vm.expectRevert(expected);
        prover.pause();
        vm.expectRevert(expected);
        prover.unpause();
        vm.stopPrank();
    }

    function test_verifyData_revertsWhenPaused() public {
        vm.startPrank(OWNER);
        prover.addTrustedKey(trusted1);
        prover.pause();
        vm.stopPrank();

        bytes32 dataHash = keccak256("test data");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedPrivKey1, dataHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        prover.verifyData(dataHash, sig);
    }

    /// @dev Covers the `_unpause();` body in `BaseUpgradeable.unpause` — the only
    ///      line in the shared base not exercised by any other test's setup.
    function test_unpause_clearsPauseFlag() public {
        vm.startPrank(OWNER);
        prover.pause();
        assertTrue(prover.paused());
        prover.unpause();
        assertFalse(prover.paused());
        vm.stopPrank();
    }

    function test_keyManagement_allowedWhenPaused() public {
        vm.startPrank(OWNER);
        prover.addTrustedKey(trusted1);
        prover.pause();

        // Add + remove still work while paused — these are admin operations and
        // intentionally not gated by `whenNotPaused`.
        prover.addTrustedKey(trusted2);
        prover.removeTrustedKey(trusted1);
        vm.stopPrank();

        assertTrue(prover.isTrustedKey(trusted2));
        assertFalse(prover.isTrustedKey(trusted1));
        assertEq(prover.getTrustedKeysCount(), 1);
    }

    // ============ UUPS authorization (covered here only — shared base) ============

    function test_upgradeToAndCall_revertsOnZeroImplementation() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(BaseUpgradeable.ZeroAddressNotAllowed.selector, "implementation"));
        prover.upgradeToAndCall(address(0), "");
    }

    function test_upgradeToAndCall_revertsForNonOwner() public {
        // Use any non-zero impl so the call gets past the zero-address guard
        // and reaches the `onlyOwner` check inside `_authorizeUpgrade`.
        address fakeImpl = address(0xDEAD);
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, USER));
        prover.upgradeToAndCall(fakeImpl, "");
    }

    // ============ Fuzz ============

    /// @notice After any sequence of add/remove ops, the contract's view of the trusted
    ///         set matches a Solidity-side mirror. Exercises the swap-pop loop in
    ///         `removeTrustedKey` across orderings the deterministic tests don't reach.
    function testFuzz_trustedKeySetMembershipUnderRandomOps(uint8[10] memory seeds, bool[10] memory addOp) public {
        vm.startPrank(OWNER);

        bool[256] memory expectedIn;

        for (uint256 i = 0; i < seeds.length; ++i) {
            uint8 s = seeds[i];
            if (s == 0) continue; // skip slot 0 to avoid the deterministic-keygen → address(0) edge case

            (, address k) = SedaPayloads.trustedKey(string(abi.encodePacked("fuzz-", s)));

            if (addOp[i]) {
                if (!expectedIn[s]) {
                    prover.addTrustedKey(k);
                    expectedIn[s] = true;
                }
            } else if (expectedIn[s]) {
                prover.removeTrustedKey(k);
                expectedIn[s] = false;
            }
        }

        vm.stopPrank();

        uint256 expectedCount;
        for (uint256 s = 1; s < 256; ++s) {
            if (expectedIn[s]) {
                expectedCount++;
                // forge-lint: disable-next-line(unsafe-typecast)
                (, address k) = SedaPayloads.trustedKey(string(abi.encodePacked("fuzz-", uint8(s))));
                assertTrue(prover.isTrustedKey(k), "expected key not present");
            }
        }
        assertEq(prover.getAllTrustedKeys().length, expectedCount, "list length mismatch");
        assertEq(prover.getTrustedKeysCount(), expectedCount, "count getter mismatch");
    }
}
