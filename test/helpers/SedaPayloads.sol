// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {BaseSedaAdapter} from "../../src/base/BaseSedaAdapter.sol";
import {BasePythAdapter} from "../../src/pyth/BasePythAdapter.sol";
import {SedaDataTypes} from "../../src/prover/SedaDataTypes.sol";
import {SedaPythAdapter} from "../../src/SedaPythAdapter.sol";

/// @title  SedaPayloads
/// @notice Test-only helpers for building signed SEDA payloads.
/// @dev    Re-uses the live struct types (`SignedPayload`, `SedaPriceUpdate`, `PriceInfo`,
///         `SedaDataTypes.Result`) so the encoding stays bit-identical to what the
///         contracts decode — there is no schema drift risk.
library SedaPayloads {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev Mirrors `SedaDataTypes.VERSION`; mixed into `deriveResultId` for domain separation.
    string internal constant SEDA_VERSION = "0.0.1";

    /// @dev secp256k1 curve order; used to clamp keccak outputs into the valid private-key range `[1, n-1]`.
    uint256 private constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    /// @notice One row of a multi-feed payload.
    struct Row {
        bytes32 symbolId;
        int64 price;
        uint64 conf;
        uint64 publishTime;
        int32 expo;
    }

    // ============ Key helpers ============

    /// @notice Derives a deterministic `(privKey, address)` pair from a label.
    function trustedKey(string memory label) internal pure returns (uint256 privKey, address addr) {
        privKey = (uint256(keccak256(bytes(label))) % (SECP256K1_N - 1)) + 1;
        addr = vm.addr(privKey);
    }

    /// @notice `keccak256(abi.encode(drId, symbolId))` — identical to
    ///         `BaseSedaAdapter._computeFeedId`, lifted here for test-side assertions.
    function computeFeedId(bytes32 drId, bytes32 symbolId) internal pure returns (bytes32) {
        return keccak256(abi.encode(drId, symbolId));
    }

    // ============ Single-update payloads ============

    /// @notice Signed blob carrying a single valid `SedaPriceUpdate`. `expo` is fixed
    ///         to -8 to match the SEDA FAST oracle program; tests needing a different
    ///         exponent should use `createValidUpdateDataMulti` or build a `Result`
    ///         manually and call `signResult`.
    function createValidUpdateData(
        uint256 privKey,
        bytes32 drId,
        bytes32 symbolId,
        int64 price,
        uint64 conf,
        uint64 publishTime
    ) internal pure returns (bytes memory) {
        return _buildFromUpdates(privKey, drId, _singleRow(symbolId, price, conf, publishTime), true, 0);
    }

    /// @notice Signed payload with `result.exitCode == 1`. Triggers
    ///         `InvalidResult("Oracle execution failed")` in `_verifySedaResult`.
    /// @dev    `publishTime` is caller-supplied so this helper stays `pure`.
    function createInvalidExitCodePayload(uint256 privKey, bytes32 drId, bytes32 symbolId, uint64 publishTime)
        internal
        pure
        returns (bytes memory)
    {
        return _buildFromUpdates(privKey, drId, _singleRow(symbolId, 50_000, 100, publishTime), true, 1);
    }

    /// @notice Signed payload with `result.consensus == false`. Triggers
    ///         `InvalidResult("Oracle result not in consensus")` in `_verifySedaResult`.
    function createNonConsensusPayload(uint256 privKey, bytes32 drId, bytes32 symbolId, uint64 publishTime)
        internal
        pure
        returns (bytes memory)
    {
        return _buildFromUpdates(privKey, drId, _singleRow(symbolId, 50_000, 100, publishTime), false, 0);
    }

    /// @notice Signed payload carrying an empty `SedaPriceUpdate[]`. Triggers
    ///         `InvalidResult("No price updates")` in `SedaPythAdapter._processUpdateData`.
    function createEmptyUpdatesPayload(uint256 privKey, bytes32 drId) internal pure returns (bytes memory) {
        SedaPythAdapter.SedaPriceUpdate[] memory empty = new SedaPythAdapter.SedaPriceUpdate[](0);
        return _buildFromUpdates(privKey, drId, empty, true, 0);
    }

    // ============ Multi-update payload (one signed blob, many feeds) ============

    /// @notice Signed blob carrying multiple `SedaPriceUpdate` rows under a single `drId`.
    function createValidUpdateDataMulti(uint256 privKey, bytes32 drId, Row[] memory rows)
        internal
        pure
        returns (bytes memory)
    {
        SedaPythAdapter.SedaPriceUpdate[] memory ups = new SedaPythAdapter.SedaPriceUpdate[](rows.length);
        for (uint256 i = 0; i < rows.length; ++i) {
            ups[i] = SedaPythAdapter.SedaPriceUpdate({
                symbolId: rows[i].symbolId,
                priceInfo: BasePythAdapter.PriceInfo({
                    publishTime: rows[i].publishTime,
                    expo: rows[i].expo,
                    price: rows[i].price,
                    conf: rows[i].conf,
                    emaPrice: rows[i].price,
                    emaConf: rows[i].conf
                })
            });
        }
        return _buildFromUpdates(privKey, drId, ups, true, 0);
    }

    // ============ Result + signature ============

    /// @notice ABI-encodes a `Result`, signs `deriveResultId(result)`, and wraps both
    ///         in a `SignedPayload`. Emits raw secp256k1 `v ∈ {0, 1}` (subtracts 27
    ///         from `vm.sign`'s canonical value) so every signed payload exercises
    ///         the FAST normalization branch in `FastProver._verifySignature`.
    function signResult(SedaDataTypes.Result memory result, uint256 privKey) internal pure returns (bytes memory) {
        bytes32 resultId = SedaDataTypes.deriveResultId(result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, resultId);
        bytes memory sig = abi.encodePacked(r, s, v - 27);

        BaseSedaAdapter.SignedPayload memory payload =
            BaseSedaAdapter.SignedPayload({data: abi.encode(result), signature: sig});
        return abi.encode(payload);
    }

    // ============ Internals ============

    function _singleRow(bytes32 symbolId, int64 price, uint64 conf, uint64 publishTime)
        private
        pure
        returns (SedaPythAdapter.SedaPriceUpdate[] memory ups)
    {
        ups = new SedaPythAdapter.SedaPriceUpdate[](1);
        ups[0] = SedaPythAdapter.SedaPriceUpdate({
            symbolId: symbolId,
            priceInfo: BasePythAdapter.PriceInfo({
                publishTime: publishTime, expo: -8, price: price, conf: conf, emaPrice: price, emaConf: conf
            })
        });
    }

    /// @dev Wraps an in-memory update array in a `Result + SignedPayload` blob.
    ///      `blockTimestamp` is set to `max(updates.publishTime)`; empty arrays
    ///      default to `0` so the helper stays `pure`.
    function _buildFromUpdates(
        uint256 privKey,
        bytes32 drId,
        SedaPythAdapter.SedaPriceUpdate[] memory ups,
        bool consensus,
        uint8 exitCode
    ) private pure returns (bytes memory) {
        uint64 maxT = 0;
        for (uint256 i = 0; i < ups.length; ++i) {
            if (ups[i].priceInfo.publishTime > maxT) maxT = ups[i].priceInfo.publishTime;
        }

        SedaDataTypes.Result memory result = SedaDataTypes.Result({
            drId: drId,
            gasUsed: 100_000,
            blockHeight: 0,
            blockTimestamp: maxT,
            consensus: consensus,
            exitCode: exitCode,
            version: SEDA_VERSION,
            result: abi.encode(ups),
            paybackAddress: bytes(""),
            sedaPayload: bytes("")
        });

        return signResult(result, privKey);
    }
}
