// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UnsafeUpgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

import {BaseSedaAdapter} from "../../src/base/BaseSedaAdapter.sol";
import {BasePythAdapter} from "../../src/pyth/BasePythAdapter.sol";
import {FastProver} from "../../src/prover/FastProver.sol";
import {SedaDataTypes} from "../../src/prover/SedaDataTypes.sol";
import {SedaPythAdapter} from "../../src/SedaPythAdapter.sol";
import {SedaPayloads} from "../helpers/SedaPayloads.sol";

/// @notice Shared end-to-end test logic for captured SEDA FAST oracle vectors.
///
/// Each concrete subclass points at a different fixture file via `_fixturePath()`.
/// The tests exercise the full wire format: `deriveResultId` hashing, FAST `v ∈ {0,1}`
/// normalization in `FastProver._verifySignature`, and `SedaPriceUpdate[]` decoding
/// in `SedaPythAdapter._processUpdateData`.
abstract contract BaseFastServiceTest is Test {
    address internal constant OWNER = address(0xBEEF);

    /// @dev Ethereum address of the SEDA FAST signer, derived offline from compressed
    ///      pubkey `0x021eacf821d4d21ad61515fc1212ca75739730bf0abcf4925045e3ebde0f93a7e8`
    ///      (`ethers.computeAddress(<pubkey>)`). Hardcoded so the test asserts against
    ///      a known external operator identity, not just whatever recovery returns.
    address internal constant EXPECTED_SIGNER = 0x593CEBb17C116D48d69b108711f2D8C419ed8758;

    string internal vectorJson;

    FastProver internal fastProver;
    SedaPythAdapter internal adapter;

    /// @dev Override to return the path to the test vector JSON file.
    function _fixturePath() internal pure virtual returns (string memory);

    function setUp() public {
        vectorJson = vm.readFile(_fixturePath());

        address proverImpl = address(new FastProver());
        fastProver =
            FastProver(UnsafeUpgrades.deployUUPSProxy(proverImpl, abi.encodeCall(FastProver.initialize, (OWNER))));

        address adapterImpl = address(new SedaPythAdapter());
        adapter = SedaPythAdapter(
            UnsafeUpgrades.deployUUPSProxy(
                adapterImpl, abi.encodeCall(SedaPythAdapter.initialize, (address(fastProver), OWNER))
            )
        );

        vm.prank(OWNER);
        fastProver.addTrustedKey(EXPECTED_SIGNER);
    }

    /// @notice The captured request and response refer to the same `execProgramId`.
    function test_vectorRequestMatchesResponse() public view {
        string memory requestId = vm.parseJsonString(vectorJson, ".request.execProgramId");
        string memory responseId = vm.parseJsonString(vectorJson, ".response.data.dataRequest.execProgramId");
        assertEq(requestId, responseId);
    }

    /// @notice The symbol IDs in the ABI-encoded result match the feed IDs in the request.
    /// @dev Override in subclasses whose fixture uses a different request schema.
    function test_vectorFeedIdsMatchRequest() public view virtual {
        SedaDataTypes.Result memory result = _loadResult();
        SedaPythAdapter.SedaPriceUpdate[] memory updates =
            abi.decode(result.result, (SedaPythAdapter.SedaPriceUpdate[]));

        for (uint256 i = 0; i < updates.length; ++i) {
            string memory path = string.concat(".request.execInputs.feeds[", vm.toString(i), "].pythFeedId");
            bytes32 expected = vm.parseJsonBytes32(vectorJson, path);
            assertEq(updates[i].symbolId, expected);
        }
    }

    /// @notice `ecrecover(deriveResultId(result), normalize(sig)) == EXPECTED_SIGNER`.
    function test_signerRecoveryMatchesExpectedAddress() public view {
        SedaDataTypes.Result memory result = _loadResult();
        bytes memory sig = _loadSignature();

        bytes32 resultId = SedaDataTypes.deriveResultId(result);

        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
        }

        address recovered = ecrecover(resultId, v, r, s);
        assertEq(recovered, EXPECTED_SIGNER);
    }

    /// @notice Submits the captured payload via `updatePriceFeeds` and asserts the
    ///         stored feeds match the values reported by the FAST oracle program.
    function test_endToEnd_acceptsRealProductionVector() public {
        SedaDataTypes.Result memory result = _loadResult();
        bytes memory sig = _loadSignature();

        BaseSedaAdapter.SignedPayload memory payload =
            BaseSedaAdapter.SignedPayload({data: abi.encode(result), signature: sig});
        bytes[] memory blob = new bytes[](1);
        blob[0] = abi.encode(payload);

        adapter.updatePriceFeeds(blob);

        SedaPythAdapter.SedaPriceUpdate[] memory updates =
            abi.decode(result.result, (SedaPythAdapter.SedaPriceUpdate[]));
        assertTrue(updates.length > 0, "fixture must contain at least one feed");

        for (uint256 i = 0; i < updates.length; ++i) {
            bytes32 feedId = SedaPayloads.computeFeedId(result.drId, updates[i].symbolId);
            BasePythAdapter.PriceInfo memory info = adapter.getPriceInfo(feedId);

            assertEq(info.price, updates[i].priceInfo.price);
            assertEq(info.conf, updates[i].priceInfo.conf);
            assertEq(info.expo, updates[i].priceInfo.expo);
            assertEq(info.publishTime, updates[i].priceInfo.publishTime);
            assertEq(info.emaPrice, updates[i].priceInfo.emaPrice);
            assertEq(info.emaConf, updates[i].priceInfo.emaConf);
        }
    }

    // ============ Internals ============

    function _loadResult() private view returns (SedaDataTypes.Result memory result) {
        result.drId = vm.parseBytes32(_hex(".response.data.dataResult.drId"));
        result.gasUsed = uint128(vm.parseUint(vm.parseJsonString(vectorJson, ".response.data.dataResult.gasUsed")));
        result.blockHeight =
            uint64(vm.parseUint(vm.parseJsonString(vectorJson, ".response.data.dataResult.blockHeight")));
        result.blockTimestamp =
            uint64(vm.parseUint(vm.parseJsonString(vectorJson, ".response.data.dataResult.blockTimestamp")));
        result.consensus = vm.parseJsonBool(vectorJson, ".response.data.dataResult.consensus");
        result.exitCode = uint8(vm.parseJsonUint(vectorJson, ".response.data.dataResult.exitCode"));
        result.version = vm.parseJsonString(vectorJson, ".response.data.dataResult.version");
        result.result = vm.parseBytes(_hex(".response.data.dataResult.result"));
        result.paybackAddress = _maybeBytes(".response.data.dataResult.paybackAddress");
        result.sedaPayload = _maybeBytes(".response.data.dataResult.sedaPayload");
    }

    function _loadSignature() private view returns (bytes memory) {
        return vm.parseBytes(_hex(".response.data.signature"));
    }

    function _hex(string memory key) private view returns (string memory) {
        return string.concat("0x", vm.parseJsonString(vectorJson, key));
    }

    function _maybeBytes(string memory key) private view returns (bytes memory) {
        string memory raw = vm.parseJsonString(vectorJson, key);
        if (bytes(raw).length == 0) return bytes("");
        return vm.parseBytes(string.concat("0x", raw));
    }
}

/// @notice Single-feed vector (BTC-USD only, legacy request schema).
/// Vector: test/fixtures/fast-service-execution-single-feed.json
contract FastServiceSingleFeedTest is BaseFastServiceTest {
    function _fixturePath() internal pure override returns (string memory) {
        return "test/fixtures/fast-service-execution-single-feed.json";
    }

    /// @dev Legacy fixture uses a flat request schema without a `feeds[]` array.
    function test_vectorFeedIdsMatchRequest() public pure override {
        // skip — old request format has no feeds[] array
    }
}

/// @notice Multi-feed vector (BTC-USD + ETH-USD).
/// Vector: test/fixtures/fast-service-execution-multi-feed.json
contract FastServiceMultiFeedTest is BaseFastServiceTest {
    function _fixturePath() internal pure override returns (string memory) {
        return "test/fixtures/fast-service-execution-multi-feed.json";
    }
}
