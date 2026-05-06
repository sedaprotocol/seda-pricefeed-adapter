// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UnsafeUpgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {BaseSedaAdapter} from "../../src/base/BaseSedaAdapter.sol";
import {BaseUpgradeable} from "../../src/base/BaseUpgradeable.sol";
import {BasePythAdapter} from "../../src/pyth/BasePythAdapter.sol";
import {FastProver} from "../../src/prover/FastProver.sol";
import {IPythEvents} from "../../src/pyth/external/IPythEvents.sol";
import {PythErrors} from "../../src/pyth/external/PythErrors.sol";
import {PythStructs} from "../../src/pyth/external/PythStructs.sol";
import {SedaPythAdapter} from "../../src/SedaPythAdapter.sol";
import {SedaPayloads} from "../helpers/SedaPayloads.sol";

/// @notice Unit + flow tests for SedaPythAdapter. Upgrade safety + ERC-7201 layout
///         validation live in `SedaPythAdapter.upgrade.t.sol`; this file uses
///         `UnsafeUpgrades` to skip the per-test OZ validator subprocess (irrelevant
///         for runtime tests, slow when invoked once per `setUp()`).
///
///         The `_authorizeUpgrade` paths (zero-impl + non-owner) are covered once in
///         the sibling `prover/FastProver.t.sol` via the shared `BaseUpgradeable`;
///         not duplicated here.
contract SedaPythAdapterTest is Test {
    address internal constant OWNER = address(0xBEEF);
    address internal constant USER = address(0xCAFE);

    FastProver internal fastProver;
    SedaPythAdapter internal adapter;

    uint256 internal trustedPrivKey;
    address internal trusted;

    bytes32 internal constant BTC_DR_ID = keccak256("btc_dr_id");
    bytes32 internal constant BTC_SYMBOL_ID = keccak256("BTC/USD");
    bytes32 internal constant ETH_DR_ID = keccak256("eth_dr_id");
    bytes32 internal constant ETH_SYMBOL_ID = keccak256("ETH/USD");

    function setUp() public {
        // Anchor block.timestamp to a realistic value so age-limited getters work
        // without timestamp underflow when subtracting recent publish times.
        vm.warp(1_700_000_000);

        address proverImpl = address(new FastProver());
        fastProver =
            FastProver(UnsafeUpgrades.deployUUPSProxy(proverImpl, abi.encodeCall(FastProver.initialize, (OWNER))));

        address adapterImpl = address(new SedaPythAdapter());
        adapter = SedaPythAdapter(
            UnsafeUpgrades.deployUUPSProxy(
                adapterImpl, abi.encodeCall(SedaPythAdapter.initialize, (address(fastProver), OWNER))
            )
        );

        (trustedPrivKey, trusted) = SedaPayloads.trustedKey("trusted1");
        vm.prank(OWNER);
        fastProver.addTrustedKey(trusted);

        vm.deal(address(this), 10 ether);
    }

    // ============ Init / admin ============

    function test_initialize_setsOwnerAndProver() public view {
        assertEq(adapter.owner(), OWNER);
        assertEq(adapter.getProver(), address(fastProver));
    }

    function test_initialize_revertsOnZeroAddresses() public {
        address impl = address(new SedaPythAdapter());

        vm.expectRevert(abi.encodeWithSelector(BaseUpgradeable.ZeroAddressNotAllowed.selector, "owner"));
        UnsafeUpgrades.deployUUPSProxy(
            impl, abi.encodeCall(SedaPythAdapter.initialize, (address(fastProver), address(0)))
        );

        vm.expectRevert(abi.encodeWithSelector(BaseUpgradeable.ZeroAddressNotAllowed.selector, "prover"));
        UnsafeUpgrades.deployUUPSProxy(impl, abi.encodeCall(SedaPythAdapter.initialize, (address(0), OWNER)));
    }

    function test_initialize_revertsOnSecondCall() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        adapter.initialize(address(fastProver), OWNER);
    }

    function test_updateProver_emitsAndUpdatesGetter() public {
        address newProver = address(new FastProver());

        vm.expectEmit(address(adapter));
        emit BaseSedaAdapter.ProverUpdated(address(fastProver), newProver);

        vm.prank(OWNER);
        adapter.updateProver(newProver);

        assertEq(adapter.getProver(), newProver);
    }

    function test_updateProver_revertsOnZeroAddress() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(BaseUpgradeable.ZeroAddressNotAllowed.selector, "prover"));
        adapter.updateProver(address(0));
    }

    function test_updateProver_revertsWhenCalledOnImplementationDirectly() public {
        // Locate the live implementation behind the proxy and call updateProver on it.
        // The `onlyProxy` modifier should reject — this guards against operators
        // accidentally administering the implementation contract.
        address impl = address(uint160(uint256(vm.load(address(adapter), _erc1967ImplSlot()))));

        vm.prank(OWNER);
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        SedaPythAdapter(impl).updateProver(address(0xABCD));
    }

    /// @notice `onlyOwner` short-circuits before any state check, so this single
    ///         test covers the entire admin surface (`pause`, `unpause`, `updateProver`)
    ///         without per-test seeding.
    function test_adminSurface_revertsForNonOwner() public {
        bytes memory expected = abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, USER);

        vm.startPrank(USER);
        vm.expectRevert(expected);
        adapter.pause();
        vm.expectRevert(expected);
        adapter.unpause();
        vm.expectRevert(expected);
        adapter.updateProver(USER);
        vm.stopPrank();
    }

    function test_updatePriceFeeds_revertsWhenPaused() public {
        // Covers the `whenNotPaused` modifier. `updatePriceFeedsIfNecessary` shares
        // the same modifier and is intentionally not retested here.
        vm.prank(OWNER);
        adapter.pause();

        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));

        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        adapter.updatePriceFeeds(blob);
    }

    function test_parsePriceFeedUpdatesWithConfig_storeMode_revertsWhenPaused() public {
        // Covers the inline `if (paused()) revert` branch in `SedaPythAdapter`'s
        // override (distinct code path from the modifier above).
        vm.prank(OWNER);
        adapter.pause();

        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));
        bytes32[] memory ids = _singleId(_btcFeedId());

        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        adapter.parsePriceFeedUpdatesWithConfig(blob, ids, 0, _maxT(), false, false, true);
    }

    // ============ Flows: updatePriceFeeds ============

    function test_updatePriceFeeds_storesPriceAndEmits() public {
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));

        // Only `id` is indexed; we assert the indexed topic and the data triple.
        vm.expectEmit(true, false, false, true, address(adapter));
        emit IPythEvents.PriceFeedUpdate(_btcFeedId(), _now(), int64(50_000), uint64(100));

        adapter.updatePriceFeeds(blob);

        PythStructs.Price memory price = adapter.getPriceUnsafe(_btcFeedId());
        assertEq(price.price, 50_000);
        assertEq(price.conf, 100);
    }

    function test_updatePriceFeeds_handlesBatchAcrossSymbols() public {
        bytes[] memory blob = new bytes[](2);
        blob[0] = _validBtc(50_000, 100, _now());
        blob[1] = SedaPayloads.createValidUpdateData(trustedPrivKey, ETH_DR_ID, ETH_SYMBOL_ID, 3_000, 50, _now());

        adapter.updatePriceFeeds(blob);

        assertEq(adapter.getPriceUnsafe(_btcFeedId()).price, 50_000);
        assertEq(adapter.getPriceUnsafe(SedaPayloads.computeFeedId(ETH_DR_ID, ETH_SYMBOL_ID)).price, 3_000);
    }

    function test_updatePriceFeeds_advancesOnNewerStaysOnOlder() public {
        // Combines the "newer-wins" and "stale-silently-ignored" assertions: both
        // exercise the same `_applyUpdate` strictly-newer rule from opposite sides.
        uint64 t0 = _now() - 100;
        uint64 t1 = _now();
        uint64 stale = _now() - 3_600;

        adapter.updatePriceFeeds(_singleBlob(_validBtc(40_000, 100, t0)));
        assertEq(adapter.getPriceInfo(_btcFeedId()).publishTime, t0);

        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 120, t1)));
        BasePythAdapter.PriceInfo memory afterAdvance = adapter.getPriceInfo(_btcFeedId());
        assertEq(afterAdvance.price, 50_000);
        assertEq(afterAdvance.publishTime, t1);

        adapter.updatePriceFeeds(_singleBlob(_validBtc(99_999, 100, stale)));
        BasePythAdapter.PriceInfo memory afterStale = adapter.getPriceInfo(_btcFeedId());
        assertEq(afterStale.price, 50_000, "stale update must not overwrite");
        assertEq(afterStale.publishTime, t1);
    }

    function test_updatePriceFeeds_revertsOnInvalidExitCode() public {
        bytes[] memory blob =
            _singleBlob(SedaPayloads.createInvalidExitCodePayload(trustedPrivKey, BTC_DR_ID, BTC_SYMBOL_ID, _now()));
        vm.expectRevert(abi.encodeWithSelector(BaseSedaAdapter.InvalidResult.selector, "Oracle execution failed"));
        adapter.updatePriceFeeds(blob);
    }

    function test_updatePriceFeeds_revertsOnNonConsensus() public {
        bytes[] memory blob =
            _singleBlob(SedaPayloads.createNonConsensusPayload(trustedPrivKey, BTC_DR_ID, BTC_SYMBOL_ID, _now()));
        vm.expectRevert(
            abi.encodeWithSelector(BaseSedaAdapter.InvalidResult.selector, "Oracle result not in consensus")
        );
        adapter.updatePriceFeeds(blob);
    }

    function test_updatePriceFeeds_revertsOnEmptyUpdates() public {
        bytes[] memory blob = _singleBlob(SedaPayloads.createEmptyUpdatesPayload(trustedPrivKey, BTC_DR_ID));
        vm.expectRevert(abi.encodeWithSelector(BaseSedaAdapter.InvalidResult.selector, "No price updates"));
        adapter.updatePriceFeeds(blob);
    }

    function test_updatePriceFeeds_replayIsolatedAcrossDrId() public {
        // The same symbol under a different drId yields a different feedId; the
        // first submission must not populate the second feedId.
        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, _now())));

        bytes32 otherFeedId = SedaPayloads.computeFeedId(keccak256("other_dr_id"), BTC_SYMBOL_ID);
        vm.expectRevert(PythErrors.PriceFeedNotFound.selector);
        adapter.getPriceUnsafe(otherFeedId);
    }

    // ============ Flows: updatePriceFeedsIfNecessary ============

    function test_updatePriceFeedsIfNecessary_runsWhenAnyFeedNeedsRefresh() public {
        // Pre-populate ETH at a stored timestamp; request refresh based on a per-id
        // claim that ETH should be at a much newer time. The loop must hit the second
        // entry (ETH) and break before checking the first (BTC), which has no claim.
        uint64 tBtcStored = _now() - 5_000;
        uint64 tEthStored = _now() - 4_950;
        uint64 tEthNew = _now() - 100;

        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, tBtcStored)));
        adapter.updatePriceFeeds(
            _singleBlob(
                SedaPayloads.createValidUpdateData(trustedPrivKey, ETH_DR_ID, ETH_SYMBOL_ID, 3_000, 50, tEthStored)
            )
        );

        bytes[] memory blob = _singleBlob(
            SedaPayloads.createValidUpdateData(trustedPrivKey, ETH_DR_ID, ETH_SYMBOL_ID, 3_100, 50, tEthNew)
        );

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = _btcFeedId();
        ids[1] = SedaPayloads.computeFeedId(ETH_DR_ID, ETH_SYMBOL_ID);

        uint64[] memory times = new uint64[](2);
        times[0] = tBtcStored - 1_000; // BTC: claim stale enough to NOT request refresh
        times[1] = tEthNew; //            ETH: claim newer than stored -> needsUpdate

        adapter.updatePriceFeedsIfNecessary(blob, ids, times);

        assertEq(adapter.getPriceUnsafe(SedaPayloads.computeFeedId(ETH_DR_ID, ETH_SYMBOL_ID)).price, 3_100);
    }

    function test_updatePriceFeedsIfNecessary_revertsWithNoFreshUpdate() public {
        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, _now())));

        bytes[] memory blob = _singleBlob(_validBtc(40_000, 100, _now() - 3_600));
        bytes32[] memory ids = _singleId(_btcFeedId());
        uint64[] memory times = new uint64[](1);
        times[0] = _now() - 3_600;

        vm.expectRevert(PythErrors.NoFreshUpdate.selector);
        adapter.updatePriceFeedsIfNecessary(blob, ids, times);
    }

    function test_updatePriceFeedsIfNecessary_revertsOnLengthMismatch() public {
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));
        bytes32[] memory ids = _singleId(_btcFeedId());
        uint64[] memory times = new uint64[](0);

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.updatePriceFeedsIfNecessary(blob, ids, times);
    }

    // ============ Flows: parsePriceFeedUpdates* family ============

    function test_parsePriceFeedUpdates_returnsRequestedFeeds() public {
        uint64 pubT = _now() - 1_800;
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, pubT));

        PythStructs.PriceFeed[] memory feeds = adapter.parsePriceFeedUpdates(blob, _singleId(_btcFeedId()), 0, _maxT());

        assertEq(feeds.length, 1);
        assertEq(feeds[0].id, _btcFeedId());
        assertEq(feeds[0].price.price, 50_000);
    }

    function test_parsePriceFeedUpdatesWithConfig_storesAndReturnsSlots() public {
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));

        (PythStructs.PriceFeed[] memory feeds, uint64[] memory slots) =
            adapter.parsePriceFeedUpdatesWithConfig(blob, _singleId(_btcFeedId()), 0, _maxT(), false, false, true);

        assertEq(feeds.length, 1);
        assertEq(feeds[0].price.price, 50_000);
        assertEq(slots.length, 1);
        assertEq(slots[0], 0); // SEDA does not use Pyth-style slots; always zero.

        // Storage was updated by the parse-with-store path.
        assertEq(adapter.getPriceUnsafe(_btcFeedId()).price, 50_000);
    }

    function test_parsePriceFeedUpdates_ignoresExtrasWhenSubsetRequested() public {
        SedaPayloads.Row[] memory rows = new SedaPayloads.Row[](2);
        rows[0] = SedaPayloads.Row(BTC_SYMBOL_ID, 50_000, 100, _now() - 200, -8);
        rows[1] = SedaPayloads.Row(ETH_SYMBOL_ID, 3_000, 50, _now() - 150, -8);

        bytes[] memory blob = _singleBlob(SedaPayloads.createValidUpdateDataMulti(trustedPrivKey, BTC_DR_ID, rows));

        PythStructs.PriceFeed[] memory feeds = adapter.parsePriceFeedUpdates(blob, _singleId(_btcFeedId()), 0, _maxT());

        assertEq(feeds.length, 1);
        assertEq(feeds[0].id, _btcFeedId());
        assertEq(feeds[0].price.price, 50_000);

        // The ETH row was decoded but not requested — its feed must remain unset.
        bytes32 ethFeedId = SedaPayloads.computeFeedId(BTC_DR_ID, ETH_SYMBOL_ID);
        vm.expectRevert(PythErrors.PriceFeedNotFound.selector);
        adapter.getPriceUnsafe(ethFeedId);
    }

    function test_parsePriceFeedUpdatesWithConfig_strictMinimality_passesOnExactMatch() public {
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));

        (PythStructs.PriceFeed[] memory feeds,) =
            adapter.parsePriceFeedUpdatesWithConfig(blob, _singleId(_btcFeedId()), 0, _maxT(), false, true, false);

        assertEq(feeds.length, 1);
        assertEq(feeds[0].id, _btcFeedId());
    }

    function test_parsePriceFeedUpdatesWithConfig_strictMinimality_revertsOnExtras() public {
        SedaPayloads.Row[] memory rows = new SedaPayloads.Row[](2);
        rows[0] = SedaPayloads.Row(BTC_SYMBOL_ID, 50_000, 100, _now() - 200, -8);
        rows[1] = SedaPayloads.Row(ETH_SYMBOL_ID, 3_000, 50, _now() - 150, -8);

        bytes[] memory blob = _singleBlob(SedaPayloads.createValidUpdateDataMulti(trustedPrivKey, BTC_DR_ID, rows));

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.parsePriceFeedUpdatesWithConfig(blob, _singleId(_btcFeedId()), 0, _maxT(), false, true, false);
    }

    function test_parsePriceFeedUpdatesUnique_keepsEarliestInWindow() public {
        SedaPayloads.Row[] memory rows = new SedaPayloads.Row[](2);
        rows[0] = SedaPayloads.Row(BTC_SYMBOL_ID, 99_999, 1, _now() - 100, -8); // late
        rows[1] = SedaPayloads.Row(BTC_SYMBOL_ID, 50_000, 100, _now() - 400, -8); // early

        bytes[] memory blob = _singleBlob(SedaPayloads.createValidUpdateDataMulti(trustedPrivKey, BTC_DR_ID, rows));

        PythStructs.PriceFeed[] memory feeds =
            adapter.parsePriceFeedUpdatesUnique(blob, _singleId(_btcFeedId()), 0, _maxT());

        assertEq(feeds.length, 1);
        assertEq(feeds[0].price.price, 50_000);
        assertEq(feeds[0].price.publishTime, _now() - 400);
    }

    function test_parsePriceFeedUpdatesUnique_keepsFirstSeenOnTies() public {
        // Same publishTime — uniqueness "earliest" is undefined for ties, so the
        // contract's documented behavior is "first encountered". Both `Unique` and
        // the non-unique parse should agree on the first row.
        uint64 t = _now() - 120;
        SedaPayloads.Row[] memory rows = new SedaPayloads.Row[](2);
        rows[0] = SedaPayloads.Row(BTC_SYMBOL_ID, 11_111, 1, t, -8);
        rows[1] = SedaPayloads.Row(BTC_SYMBOL_ID, 22_222, 2, t, -8);

        bytes[] memory blob = _singleBlob(SedaPayloads.createValidUpdateDataMulti(trustedPrivKey, BTC_DR_ID, rows));

        PythStructs.PriceFeed[] memory uniqueFeeds =
            adapter.parsePriceFeedUpdatesUnique(blob, _singleId(_btcFeedId()), 0, _maxT());
        assertEq(uniqueFeeds[0].price.price, 11_111);

        PythStructs.PriceFeed[] memory plainFeeds =
            adapter.parsePriceFeedUpdates(blob, _singleId(_btcFeedId()), 0, _maxT());
        assertEq(plainFeeds[0].price.price, 11_111);
    }

    function test_parsePriceFeedUpdates_revertsWhenOutsideWindow() public {
        uint64 pubT = _now() - 800;
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, pubT));

        // Below window
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        adapter.parsePriceFeedUpdates(blob, _singleId(_btcFeedId()), pubT + 60, _maxT());

        // Above window
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        adapter.parsePriceFeedUpdates(blob, _singleId(_btcFeedId()), 0, pubT - 60);
    }

    function test_parsePriceFeedUpdatesWithConfig_doesNotDowngradeStorageOnOlderSecondRow() public {
        uint64 tHi = _now() - 50;
        uint64 tLo = _now() - 200;

        SedaPayloads.Row[] memory rows = new SedaPayloads.Row[](2);
        rows[0] = SedaPayloads.Row(BTC_SYMBOL_ID, 51_000, 100, tHi, -8);
        rows[1] = SedaPayloads.Row(BTC_SYMBOL_ID, 40_000, 100, tLo, -8);

        bytes[] memory blob = _singleBlob(SedaPayloads.createValidUpdateDataMulti(trustedPrivKey, BTC_DR_ID, rows));

        adapter.parsePriceFeedUpdatesWithConfig(blob, _singleId(_btcFeedId()), 0, _maxT(), false, false, true);

        BasePythAdapter.PriceInfo memory info = adapter.getPriceInfo(_btcFeedId());
        assertEq(info.publishTime, tHi);
        assertEq(info.price, 51_000);
    }

    function test_parsePriceFeedUpdates_keepsLatestWhenUniquenessOff() public {
        // Uniqueness OFF + chronological rows: selector should pick the latest match.
        uint64 tFirst = _now() - 300;
        uint64 tSecond = _now() - 100;

        SedaPayloads.Row[] memory rows = new SedaPayloads.Row[](2);
        rows[0] = SedaPayloads.Row(BTC_SYMBOL_ID, 40_000, 10, tFirst, -8);
        rows[1] = SedaPayloads.Row(BTC_SYMBOL_ID, 50_000, 100, tSecond, -8);

        bytes[] memory blob = _singleBlob(SedaPayloads.createValidUpdateDataMulti(trustedPrivKey, BTC_DR_ID, rows));

        PythStructs.PriceFeed[] memory feeds = adapter.parsePriceFeedUpdates(blob, _singleId(_btcFeedId()), 0, _maxT());

        assertEq(feeds[0].price.price, 50_000);
        assertEq(feeds[0].price.publishTime, tSecond);
    }

    // ============ IPyth surface ============

    function test_ipythGetters_happyPath() public {
        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, _now() - 10)));

        PythStructs.Price memory unsafe_ = adapter.getPriceUnsafe(_btcFeedId());
        assertEq(unsafe_.price, 50_000);
        assertEq(unsafe_.conf, 100);
        assertEq(unsafe_.expo, -8);

        PythStructs.Price memory aged = adapter.getPriceNoOlderThan(_btcFeedId(), 86_400);
        assertEq(aged.price, 50_000);

        PythStructs.Price memory ema = adapter.getEmaPriceUnsafe(_btcFeedId());
        assertEq(ema.price, 50_000);
        assertEq(ema.conf, 100);

        PythStructs.Price memory agedEma = adapter.getEmaPriceNoOlderThan(_btcFeedId(), 86_400);
        assertEq(agedEma.price, 50_000);

        // Unknown feed id reverts.
        vm.expectRevert(PythErrors.PriceFeedNotFound.selector);
        adapter.getPriceUnsafe(keccak256("non_existent"));
    }

    function test_getPriceNoOlderThan_revertsForStalePrice() public {
        // Cross-reference: the same code path applies to `getEmaPriceNoOlderThan`
        // (both go through `_getPrice(_, age, _)`); not retested separately.
        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, _now() - 3_700)));

        vm.expectRevert(PythErrors.StalePrice.selector);
        adapter.getPriceNoOlderThan(_btcFeedId(), 3_600);
    }

    function test_ageLimitedGetters_revertsOnFuturePublishTime() public {
        // Distinct branch in `_getPrice`: `block.timestamp < info.publishTime`.
        uint64 future = _now() + 500_000;
        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, future)));

        vm.expectRevert(PythErrors.StalePrice.selector);
        adapter.getPriceNoOlderThan(_btcFeedId(), 86_400);

        vm.expectRevert(PythErrors.StalePrice.selector);
        adapter.getEmaPriceNoOlderThan(_btcFeedId(), 86_400);
    }

    function test_getUpdateFee_returnsZero() public view {
        bytes[] memory blob = new bytes[](1);
        blob[0] = hex"deadbeef";
        assertEq(adapter.getUpdateFee(blob), 0);
    }

    function test_twapFunctions_revertNotImplemented() public {
        bytes[] memory blob = new bytes[](1);
        blob[0] = hex"deadbeef";

        vm.expectRevert(BasePythAdapter.TwapNotImplemented.selector);
        adapter.getTwapUpdateFee(blob);

        vm.expectRevert(BasePythAdapter.TwapNotImplemented.selector);
        adapter.parseTwapPriceFeedUpdates(blob, _singleId(_btcFeedId()));
    }

    function test_getFeedIds_emptyThenPopulated() public {
        assertEq(adapter.getFeedIds().length, 0);
        adapter.updatePriceFeeds(_singleBlob(_validBtc(50_000, 100, _now())));
        bytes32[] memory feedIds = adapter.getFeedIds();
        assertEq(feedIds.length, 1);
        assertEq(feedIds[0], _btcFeedId());
    }

    // ============ Security ============

    function test_payableEntrypoints_rejectMsgValue() public {
        bytes[] memory blob = _singleBlob(_validBtc(50_000, 100, _now()));
        bytes32[] memory ids = _singleId(_btcFeedId());
        uint64[] memory times = new uint64[](1);
        times[0] = _now() + 60;

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.updatePriceFeeds{value: 1}(blob);

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.updatePriceFeedsIfNecessary{value: 1}(blob, ids, times);

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.parsePriceFeedUpdates{value: 1}(blob, ids, 0, _maxT());

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.parsePriceFeedUpdatesUnique{value: 1}(blob, ids, 0, _maxT());

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.parsePriceFeedUpdatesWithConfig{value: 1}(blob, ids, 0, _maxT(), false, false, false);

        vm.expectRevert(PythErrors.InvalidArgument.selector);
        adapter.parseTwapPriceFeedUpdates{value: 1}(blob, ids);
    }

    // ============ Fuzz ============

    /// @notice After applying any sequence of single-feed updates, the stored
    ///         `publishTime` equals `max(times)`. Locks down the strictly-newer rule
    ///         in `_applyUpdate` across orderings the deterministic tests don't reach.
    function testFuzz_storedPublishTimeIsMonotonic(uint64[5] memory times, int64[5] memory prices) public {
        uint64 expectedMax = 0;
        for (uint256 i = 0; i < 5; ++i) {
            uint64 t = times[i];
            if (t == 0) continue; // 0 is the "uninitialized" sentinel; skip to avoid spurious no-ops.

            adapter.updatePriceFeeds(_singleBlob(_validBtc(prices[i], 100, t)));
            if (t > expectedMax) expectedMax = t;
        }

        BasePythAdapter.PriceInfo memory stored = adapter.getPriceInfo(_btcFeedId());
        assertEq(stored.publishTime, expectedMax, "stored publishTime must equal max(applied times)");
    }

    // ============ Internals ============

    /// @dev `vm.warp`-anchored, narrowed to uint64 for the SEDA wire types.
    function _now() private view returns (uint64) {
        return uint64(block.timestamp);
    }

    /// @dev Generous upper bound for parse window tests.
    function _maxT() private view returns (uint64) {
        return uint64(block.timestamp + 3_600);
    }

    function _btcFeedId() private pure returns (bytes32) {
        return SedaPayloads.computeFeedId(BTC_DR_ID, BTC_SYMBOL_ID);
    }

    function _validBtc(int64 price, uint64 conf, uint64 publishTime) private view returns (bytes memory) {
        return SedaPayloads.createValidUpdateData(trustedPrivKey, BTC_DR_ID, BTC_SYMBOL_ID, price, conf, publishTime);
    }

    function _singleBlob(bytes memory data) private pure returns (bytes[] memory blob) {
        blob = new bytes[](1);
        blob[0] = data;
    }

    function _singleId(bytes32 id) private pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = id;
    }

    /// @dev EIP-1967 implementation slot: `keccak256("eip1967.proxy.implementation") - 1`.
    function _erc1967ImplSlot() private pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }
}
