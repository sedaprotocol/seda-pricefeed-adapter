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

/// @notice End-to-end test against a real captured SEDA FAST oracle response.
///
/// Drives a full `updatePriceFeeds` against a payload signed by the live FAST signer,
/// then asserts the stored `PriceInfo` matches the values the SEDA service reported in
/// the same vector. This is the strongest available regression test for the wire format,
/// `deriveResultId` hashing, the FAST `v ∈ {0,1}` normalization branch in
/// `FastProver._verifySignature`, and the `SedaPriceUpdate[]` decoding in
/// `SedaPythAdapter._processUpdateData`.
///
/// Vector: [test/fixtures/fast-service-execution.json](../fixtures/fast-service-execution.json).
contract SedaPythAdapterFastServiceTest is Test {
    address internal constant OWNER = address(0xBEEF);

    /// @dev Ethereum address of the SEDA FAST signer, derived offline from compressed
    ///      pubkey `0x021eacf821d4d21ad61515fc1212ca75739730bf0abcf4925045e3ebde0f93a7e8`
    ///      (`ethers.computeAddress(<pubkey>)`). Hardcoded so the test asserts against
    ///      a known external operator identity, not just whatever recovery returns.
    address internal constant EXPECTED_SIGNER = 0x593CEBb17C116D48d69b108711f2D8C419ed8758;

    /// @dev Per-symbol id from the captured `execute.result` JSON, used together with
    ///      `drId` to compute the canonical `feedId`.
    bytes32 internal constant SYMBOL_ID = 0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e;

    string internal vectorJson;

    FastProver internal fastProver;
    SedaPythAdapter internal adapter;

    function setUp() public {
        vectorJson = vm.readFile("test/fixtures/fast-service-execution.json");

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
    /// @dev Cheap fixture-integrity guard: catches silent corruption if the JSON is
    ///      ever re-imported from a different SEDA vector.
    function test_vectorRequestMatchesResponse() public view {
        string memory requestId = vm.parseJsonString(vectorJson, ".request.execProgramId");
        string memory responseId = vm.parseJsonString(vectorJson, ".response.data.dataRequest.execProgramId");
        assertEq(requestId, responseId);
    }

    /// @notice `ecrecover(deriveResultId(result), normalize(sig)) == EXPECTED_SIGNER`.
    /// @dev Pure offline check — does not touch the deployed contracts.
    function test_signerRecoveryMatchesExpectedAddress() public view {
        SedaDataTypes.Result memory result = _loadResult();
        bytes memory sig = _loadSignature();

        bytes32 resultId = SedaDataTypes.deriveResultId(result);

        // The SEDA FAST service emits `v ∈ {0, 1}`; lift to canonical `{27, 28}` so
        // the precompile-style `ecrecover` accepts it. (`FastProver._verifySignature`
        // does the same on-chain; here we mirror it for the offline check.)
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
    ///         stored feed matches the values reported by the FAST oracle program.
    function test_endToEnd_acceptsRealProductionVector() public {
        SedaDataTypes.Result memory result = _loadResult();
        bytes memory sig = _loadSignature();

        BaseSedaAdapter.SignedPayload memory payload =
            BaseSedaAdapter.SignedPayload({data: abi.encode(result), signature: sig});
        bytes[] memory blob = new bytes[](1);
        blob[0] = abi.encode(payload);

        adapter.updatePriceFeeds(blob);

        // Expected values are the human-readable feed reported in the vector's
        // `execute.result` JSON (decoded by the oracle program off-chain).
        bytes32 feedId = SedaPayloads.computeFeedId(result.drId, SYMBOL_ID);
        BasePythAdapter.PriceInfo memory info = adapter.getPriceInfo(feedId);

        assertEq(info.price, int64(7_597_665_123_165));
        assertEq(info.conf, uint64(1_797_622_665));
        assertEq(info.expo, int32(-8));
        assertEq(info.publishTime, uint64(1_776_787_268));
        assertEq(info.emaPrice, int64(7_597_665_123_165));
        assertEq(info.emaConf, uint64(1_797_622_665));
    }

    // ============ Internals ============

    /// @dev Reconstructs the `Result` struct from the captured JSON. The SEDA service
    ///      emits hex without a `0x` prefix, so each field is read as a string and
    ///      run through `vm.parseBytes32` / `vm.parseBytes` after prepending `0x`.
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

    /// @dev Reads a hex-encoded string field and prepends `0x` so it can be passed to
    ///      `vm.parseBytes` / `vm.parseBytes32` (which require the prefix).
    function _hex(string memory key) private view returns (string memory) {
        return string.concat("0x", vm.parseJsonString(vectorJson, key));
    }

    /// @dev `paybackAddress` and `sedaPayload` are emitted as `""` when unset; treat
    ///      empty strings as empty `bytes` (skipping the `vm.parseBytes("0x")` round-trip).
    function _maybeBytes(string memory key) private view returns (bytes memory) {
        string memory raw = vm.parseJsonString(vectorJson, key);
        if (bytes(raw).length == 0) return bytes("");
        return vm.parseBytes(string.concat("0x", raw));
    }
}
