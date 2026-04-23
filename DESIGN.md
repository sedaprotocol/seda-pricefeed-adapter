# SedaPythAdapter — Design

This repo implements a Pyth-compatible price feed adapter for the SEDA Protocol FAST path. The adapter accepts ECDSA-signed SEDA FAST oracle results, verifies them on-chain, and exposes prices through the standard `IPyth` interface.

The design prioritizes a small verification surface, minimal per-feed storage, and the ability to migrate to a richer signature scheme without rewriting consumers. SEDA verification logic lives in a shared base (`BaseSedaAdapter`) so adapters for other price feed interfaces (e.g. Chainlink) can reuse it.

## Components

### SedaPythAdapter (`contracts/SedaPythAdapter.sol`)

UUPS-upgradeable adapter that inherits `BaseSedaAdapter` (SEDA verification + prover management) and `BasePythAdapter` (IPyth surface). Its responsibilities are limited to the Pyth-specific mapping:

- Invoke `_verifySedaResult` on each `updateData` blob (see `BaseSedaAdapter`).
- Decode `result.result` as a non-empty `SedaPythAdapter.SedaPriceUpdate[]`.
- Compute the per-feed id and apply updates into namespaced storage, keeping only the latest entry per feed.

### BaseSedaAdapter (`contracts/base/BaseSedaAdapter.sol`)

Abstract contract (UUPS + Ownable + Pausable via `BaseUpgradeable`) that encapsulates shared SEDA verification:

- `SignedPayload` wire type and `_verifySedaResult(bytes)` helper.
- Delegation of signature verification to `FastProver`.
- Enforcement of `result.consensus == true` and `result.exitCode == 0`.
- `feedId = keccak256(abi.encode(drId, symbolId))` derivation.
- Prover address storage (`SedaAdapterStorage`), `updateProver`, `getProver`.

### FastProver (`contracts/prover/FastProver.sol`)

UUPS-upgradeable prover holding a trusted signer set. Verifies a single ECDSA signature over `SedaDataTypes.deriveResultId(result)` and reverts if the recovered address is not trusted.

Only the owner can manage the trusted signer set and pause the prover.

### BasePythAdapter (`contracts/pyth/BasePythAdapter.sol`)

Oracle-agnostic IPyth implementation. Handles the full Pyth surface (`updatePriceFeeds`, `updatePriceFeedsIfNecessary`, `parsePriceFeedUpdates`, `parsePriceFeedUpdatesWithConfig`, getters, etc.) and delegates authenticity checks and id mapping to the concrete adapter via `_processUpdateData`.

Storage only advances when the new `publishTime` is strictly newer.

## Wire format

Each element of `updateData` is an ABI-encoded `BaseSedaAdapter.SignedPayload`:

```solidity
struct SignedPayload {
    bytes data;      // ABI-encoded SedaDataTypes.Result
    bytes signature; // SEDA FAST ECDSA signature over deriveResultId(result)
}
```

The oracle program's tally output (`result.result`) ABI-encodes a non-empty `SedaPythAdapter.SedaPriceUpdate[]`:

```solidity
struct SedaPriceUpdate {
    bytes32 symbolId;
    PythAdapterStorage.PriceInfo priceInfo;
}
```

`PriceInfo` mirrors the Pyth-shaped fields: `price`, `conf`, `expo`, `publishTime`, `emaPrice`, `emaConf`.

## Verification flow

```
updatePriceFeeds(bytes[] updateData)
  for each blob:
    SignedPayload payload         = abi.decode(blob)
    SedaDataTypes.Result result   = abi.decode(payload.data)
    bytes32 resultId              = deriveResultId(result)
    FastProver.verifyData(resultId, payload.signature)   // reverts if untrusted
    require(result.consensus)
    require(result.exitCode == 0)
    SedaPriceUpdate[] ups         = abi.decode(result.result)
    require(ups.length > 0)
    for each update:
      feedId = keccak256(abi.encode(result.drId, update.symbolId))
      _applyUpdate(feedId, update.priceInfo)   // only if strictly newer
```

`_applyUpdate` is shared with the parse path so that `parsePriceFeedUpdatesWithConfig(..., storeUpdatesIfFresh=true)` applies the same freshness semantics without reverting on non-fresh data.

## Feed identity

```
feedId = keccak256(abi.encode(drId, symbolId))
```

- `drId` is the SEDA data request id. It commits to the oracle program (exec + tally program IDs), the `execInputs`, and the request metadata.
- `symbolId` is the per-symbol identifier chosen by the oracle program and carried in each `SedaPriceUpdate`. For Pyth-compatible deployments this is the Pyth price feed id.

This shape is interim. Because the `drId` commits to the full `execInputs` (the batch symbol list), adding or removing a symbol in the batch changes the `drId` and therefore rekeys every feed in the batch. Consumers on this version effectively hard-code the batch. A future signature-scheme upgrade will decouple the feed id from the batch composition; migrating at that point is a consumer-side change (recompute `feedId`s from the new scheme).

## Storage and upgrades

Two namespaced ERC-7201 layouts:

- `sedaadapter.storage.v1` — `SedaAdapterStorage.Layout { address sedaProver; }` (owned by `BaseSedaAdapter`; reusable across adapters that verify SEDA FAST results).
- `pythadapter.storage.v1` — `PythAdapterStorage.Layout { bytes32[] feedIds; mapping(bytes32 => PriceInfo) priceInfos; }` (defined in `contracts/pyth/PythAdapterStorage.sol`).

Upgrades are UUPS, gated by `onlyOwner` via `BaseUpgradeable._authorizeUpgrade`. State-changing externals use `onlyProxy` so the implementation cannot be used directly. Constructors call `_disableInitializers()`.

When extending a layout, only append new fields within the existing version or add a new versioned layout; never reorder or repurpose existing slots.

## Trust model

- Signature authenticity is enforced by `FastProver`'s trusted signer set. A compromised signer can forge arbitrary results within the Pyth data shape; the adapter has no additional defense-in-depth against this.
- Consumers trust the oracle program (`execProgramId`, `tallyProgramId`) and its `execInputs`. The on-chain contract does not pin a specific `(execProgramId, tallyProgramId, execInputs)` tuple; instead, consumers hard-code the `feedId` they are willing to read, which indirectly commits to a `drId`.
- Replay protection comes from the `publishTime` monotonicity check in `_applyUpdate`. The same signed result can be replayed by any caller but will never overwrite a newer price, and cannot be used to update a different feed (the `feedId` is bound to the signed `drId` and to the `symbolId` inside the signed payload).
- Exit code and consensus are enforced on every accepted result.

## Pyth interface surface

All methods are exposed from `BasePythAdapter` and routed through the adapter:

| Function | Notes |
|---|---|
| `getPriceUnsafe(id)` / `getPriceNoOlderThan(id, age)` | Returns the latest stored price for `id`. |
| `getEmaPriceUnsafe(id)` / `getEmaPriceNoOlderThan(id, age)` | EMA variant. |
| `updatePriceFeeds(bytes[])` | Verifies and applies every update (advances storage only if strictly newer). |
| `updatePriceFeedsIfNecessary(bytes[], bytes32[], uint64[])` | Pyth parity: reverts with `NoFreshUpdate` if nothing to do. |
| `parsePriceFeedUpdates(...)` / `parsePriceFeedUpdatesUnique(...)` / `parsePriceFeedUpdatesWithConfig(...)` | Parse-only or parse-and-store depending on flags. |
| `getUpdateFee(bytes[])` | Always `0`. |
| `getTwapUpdateFee(...)`, `parseTwapPriceFeedUpdates(...)` | Revert with `TwapNotImplemented`. |

## Emergency controls

- Adapter owner can `pause()` / `unpause()` to disable all update paths (getters remain live).
- Prover owner can `pause()` / `unpause()` to disable verification and can rotate the trusted signer set.
- Ownership of both contracts is intended to be held by the same governance account.
