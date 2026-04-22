# Proposal: OP-batching-friendly FAST signature scheme

## Context

SEDA FAST currently signs `deriveResultId(result)` (see `SedaDataTypes.sol`). `result.drId` is a commitment over the full `RequestInputs`, which includes `execInputs`. For our price-feed programs that is the ticker list.

Consequences:

- Any change to the batch (adding/removing a symbol, reordering) changes `execInputs`, which changes `drId`, which changes `resultId`. A new signature is required *and* the on-chain `drIdRegistry` entry has to be re-registered.
- For OP execution this is a blocker. The batch has to be fluid, but the signature-as-identity is pinned to its exact shape.

The SEDA Core verification path is being deprecated, so this proposal only concerns the **FAST path** used by `FastAdapter` + `FastProver`. `CoreAdapter` is out of scope.

## Goals

1. Let the batch composition (symbol list) change without invalidating the signature’s usefulness as an attestation.
2. Keep a per-symbol on-chain `feedId` that is stable across batch edits. Adding or removing BTC-USDT must not move the ETH-USDT feed.
3. Keep the trust model explicit. The FAST service signer set is the root of trust, and we preserve a clean path to multi-signer / threshold later.
4. Fit cleanly under the IPyth-compatible surface (`BasePythAdapter`).

## Non-goals

- Replication-factor, consensus-filter, or tally-input binding.
- Admin allow-listing of feeds. The adapter becomes permissionless: anyone can push an update, and the `feedId` namespace isolates distinct (programs, inputs, symbol) tuples automatically.
- Fee / gas refund logic.

## Current state (for reference)

- `FastAdapter._verifyAndDecode` ABI-decodes a `SignedPayload { bytes data; bytes signature }`, treats `data` as a `SedaDataTypes.Result`, hashes it with `deriveResultId`, and verifies via `FastProver.verifyData`.
- `result.drId` is looked up in `drIdRegistry` to fetch the `(execProgramId, tallyProgramId)` pair.
- Global priceId = `keccak256(abi.encode(execProgramId, tallyProgramId, rawId))`.
- Updates land through `BasePythAdapter._applyUpdate`, which only advances storage when `publishTime` is strictly newer.

## Proposal

### 1. A new selectable signature scheme

The FAST service exposes a `signature` parameter (e.g. `signature=evm`) that clients can select when requesting an OP execution. Each scheme defines its own preimage and encoding. We add a single new scheme for EVM adapters. Other schemes can coexist for non-EVM consumers without breaking this one.

The scheme name is fixed as part of the preimage so that a message signed under scheme `X` cannot be misinterpreted as a message under scheme `Y`. A numeric `version` is included inside the preimage so small additions can be made without minting a new scheme string.

### 2. What the new scheme signs

The preimage drops `drId` / `resultId` and becomes a direct commitment over the fields the adapter actually needs:

| Field | Type | Notes |
|---|---|---|
| `schemeTag` | `bytes32` | `keccak256("seda.fast.evm.v1")`. Hard separator from any other scheme. |
| `version` | `uint16` | Bump when adding fields, paired with schemeTag. |
| `execProgramId` | `bytes32` | |
| `tallyProgramId` | `bytes32` | May be `bytes32(0)` when tally is eventually removed. |
| `exitCode` | `uint8` | Adapter must continue to require `== 0`. |
| `consensus` | `bool` | Adapter must continue to require `true`. |
| `timestamp` | `uint64` | Unix seconds. Becomes `publishTime` on storage. |
| `resultHash` | `bytes32` | `keccak256(result)`. Binds the payload without blowing up the preimage size. |

On-wire payload (proposed):

```solidity
struct FastEvmAttestation {
    uint16   version;       // 1
    bytes32  execProgramId;
    bytes32  tallyProgramId;
    uint8    exitCode;
    bool     consensus;
    uint64   timestamp;
    bytes    result;        // ABI-encoded program output (see §3)
    bytes    signature;     // 65-byte ECDSA (or, later, an array for threshold)
}
```

Preimage:

```
keccak256(abi.encode(
    keccak256("seda.fast.evm.v1"),
    version,
    execProgramId,
    tallyProgramId,
    exitCode,
    consensus,
    timestamp,
    keccak256(result)
))
```

Why no `chainId` or `verifyingContract` binding: this signature is an **attestation** (“the signer observed that program P run with config id1 produced value V for symbol id2 at time T”), not an authorization. A true observation stays true on every chain. Replay to another chain just delivers the same fact somewhere else, and `feedId` is already chain-independent: `feedId = keccak(execProgramId, tallyProgramId, id1, id2)`. `publishTime` monotonicity prevents stale replays from regressing any feed. If the scheme is ever repurposed to *authorize* anything chain-specific (refunds, slashing, bridge releases) the right fix is a new `schemeTag`, not an always-on `chainId` field.

Why not full EIP-712: the FAST service does not know the `verifyingContract` address, so the most useful half of an EIP-712 domain is unavailable. The other benefits (wallet-friendly display, standard typehash layout) are either irrelevant for a service signer or already covered by the fixed `schemeTag`.

### 3. Output schema and stable `feedId`

The oracle program’s tally output carries two extra committed values, both opaque to the adapter:

- `id1`: a hash of everything static about the execution that is *not* the symbol list (RPC endpoints, precision config, whatever is not batch-dependent). Stable across batch edits.
- `id2`: a symbol-dependent identifier (today just a symbol hash; tomorrow possibly the hash of a per-symbol input bundle).

The per-feed `id` the adapter stores and exposes becomes:

```
feedId = keccak256(abi.encode(execProgramId, tallyProgramId, id1, id2))
```

Shape-wise this matches today’s `keccak256(execProgramId, tallyProgramId, rawId)`, with `rawId` replaced by the richer `(id1, id2)` pair. Consequences:

- Adding or removing a symbol from a batch changes neither `id1` nor any existing symbol’s `id2`, so those `feedId`s are unchanged.
- A program logic change means a new `execProgramId`, which correctly produces a new `feedId`.
- A change to static config that the program bakes into `id1` also produces a new `feedId`. That is the right behaviour: consumers migrate intentionally.
- Collisions across deployments of different programs are impossible because `execProgramId` is part of the hash.

The adapter does not validate `id1` or `id2` semantically. That is the OP program’s responsibility. The signature still binds `execProgramId` and `tallyProgramId`, which pins the program logic that produced those IDs.

### 4. On-chain behaviour

The `FastAdapter` exposes a permissionless update path:

1. A caller submits an ABI-encoded `FastEvmAttestation`.
2. The adapter rebuilds the preimage exactly as defined in §2 and calls `FastProver.verifyData(preimage, signature)`. Only signers in `FastProver.trustedKeysList` pass. Signer membership is owner-managed via `addTrustedKey` / `removeTrustedKey`.
3. The adapter enforces `exitCode == 0`, `consensus == true`, and a generous sanity bound on `timestamp` vs `block.timestamp`. The timestamp is whatever the OP execution attested to, so in healthy operation it is close to `now`. The cap exists so that a buggy or rogue signer cannot freeze a feed forever by publishing a far-future timestamp. No lower bound is needed because `publishTime` monotonicity in `_applyUpdate` already makes stale pushes no-ops.
4. `result` is ABI-decoded as `PriceUpdate[]`, where each element carries `id1`, `id2`, and a Pyth-shaped `PriceInfo`. The adapter computes `feedId = keccak256(abi.encode(execProgramId, tallyProgramId, id1, id2))` per element and advances storage only when `publishTime` is strictly newer, matching Pyth semantics.

There is no per-drId registry and no admin-side feed allow-list. The `feedId` derivation isolates distinct `(programs, id1, id2)` tuples, so distinct configurations cannot collide or hijack each other.

Multi-signer / threshold verification is a future iteration and out of scope here. The preimage defined in §2 is designed to be reusable unchanged by a future `verifyThreshold(preimage, signatures[])` path.

## Alternatives considered

- **Merkle-of-symbols inside `execInputs`.** Keep today’s `deriveResultId` scheme and have the program hash the symbol list into a Merkle root. Per-symbol updates include an inclusion proof. Pros: no FAST service change. Cons: still requires re-signing when the symbol set changes; the drId still shifts whenever the root shifts, so the registry problem is not solved; larger calldata.
- **EIP-712 typed data.** Same information, heavier encoding. The `verifyingContract` domain piece is unavailable to the signer, so the marginal security benefit is small. Kept on the shelf in case we ever put these signatures in wallet UIs.
- **Narrower scheme that only signs `resultHash` + `timestamp`.** Minimal, but loses program-ID binding, so one compromised feed could be replayed as another. Rejected.
- **Keep `drId` binding but redefine `drId` upstream.** Requires changes inside the SEDA Core types we are deprecating. Not worth coupling into.

## Security review

Items worth calling out explicitly:

1. **Cross-chain and cross-adapter replay (not an attack here).** Without `chainId` or `verifyingContract` in the preimage, a signature is valid wherever a trusted signer is trusted. Because the signed message is an attestation of an observation (program + inputs + time → value) and `feedId` is chain-independent, replay to another chain or another adapter just delivers the same fact somewhere else and is bounded by per-feed `publishTime` monotonicity. Explicitly accepted, not mitigated. This changes only if the scheme is ever extended to *authorize* chain-specific actions, at which point a new `schemeTag` is required.
2. **Scheme confusion / downgrade.** Multiple co-existing schemes create a risk that a message signed under one scheme is accepted under another. Mitigation: fixed `schemeTag = keccak256("seda.fast.evm.v1")` as the first element of the preimage, plus a numeric `version`. Schemes never share a preimage prefix.
3. **Future-dated timestamps freeze the feed.** Because `_applyUpdate` only advances on strictly-newer timestamps, a single accidental or malicious update with a wildly future `timestamp` would lock out all legitimate updates until wall-clock catches up. The OP execution normally attests to its own execution time, so in healthy operation this is never close. A generous sanity cap (`timestamp <= block.timestamp + clockSkew`) is sufficient defence. Monotonicity already handles stale replays, so no lower bound is needed.
4. **Permissionless updates + signer compromise.** Dropping the allow-list means a single compromised signer key can mint any feed under any program ID the signer claims. Mitigations: rapid rotation via `FastProver.removeTrustedKey`, the pausable adapter (already present), and the planned move to multiple signers. This risk exists today too: the allow-list doesn’t help if the signer lies about which drId was executed. The change is honest about the actual trust boundary.
5. **Program-ID substitution.** A compromised signer can sign a result claiming a different `execProgramId`. Because `feedId` includes that program ID, the attack manifests as a new feed appearing rather than a hijack of an existing feed. Consumers reading the canonical `feedId` are unaffected. Document the canonical (`execProgramId`, `tallyProgramId`) pairs consumers should use.
6. **`tallyProgramId` eventual removal.** The proposal allows `tallyProgramId == bytes32(0)`. Consumers must be warned that `feedId` shape changes the day we retire tally, and there should be a one-time coordinated migration (new `id1`-based feed) rather than silent aliasing.
7. **Signature malleability.** `FastProver._verifySignature` normalises `v` and uses OZ `ECDSA.recover`, which rejects low-s malleability. Unchanged.
8. **Exit code / consensus semantics drift.** `exitCode == 0` and `consensus == true` must remain enforced even though they are signed. Do not trust the signer to self-gate: belt and braces.
9. **`schemeTag` typo / mismatch.** A one-character difference between the service and the contract silently bricks verification. Mitigation: pin the literal string in a shared test vector fixture that both sides import from.
10. **Multi-signer readiness.** Today’s single-signer shape is compatible with future k-of-n: same preimage, verifier loops over a bytes-array of signatures and checks threshold against `FastProver.trustedKeysList`. No change to the signed data needed. Worth nailing down ahead of time so we don’t paint ourselves into a corner.
11. **Schema evolution of `result`.** `id1` and `id2` are committed only via `keccak256(result)`. If the program adds fields, consumers must re-read against the updated program ID. Enforce that the adapter never decodes past its declared struct; reject extra trailing data if we want strict minimality.
12. **Free feed minting (DoS / storage bloat).** Permissionless creation means an attacker with a valid signer key can spray bogus feeds to grow storage. Same trust-bound as item 4. Add a circuit breaker via pause and consider a soft cap on how many distinct `feedId`s a single block can mint.

None of the items above are showstoppers for the new design. (2), (3), (6), (10), and (12) are the ones worth explicit decisions before we ship.

## Open questions

- Versioning: should we treat the current `deriveResultId`-based signature as `v1` and call this new scheme `v2`, so the label reflects the real sequence of signed formats the service has emitted? Concretely: `schemeTag = keccak256("seda.fast.evm.v2")` and the `version` field inside starts at `2`. Cosmetic, but nice.
- Do we need to sign **two** timestamps, one for when the OP execution happened (attestation freshness, anti-freeze sanity bound) and one for when the underlying data was observed according to its source (what Pyth-compatible consumers read via `getPriceNoOlderThan(age)`)? These can legitimately differ (e.g. the exchange API says `lastTradeAt = T_data` while FAST executes at `T_exec > T_data`). Collapsing them into one field forces the OP program to pick a convention and costs consumers the ability to distinguish stale data from slow attestation. Option A: keep one `timestamp` and let each OP program document which of the two it reports. Option B: sign both, store the data timestamp as `publishTime`, use the execution timestamp only for the sanity cap and monotonicity.
- Strict or permissive handling of trailing bytes / unknown fields in `result` and `FastEvmAttestation`.
- Do we want a small off-chain document pinning the canonical `(execProgramId, tallyProgramId, id1)` tuples consumers are expected to trust? This is how integrators know which constants to hard-code when deriving `feedId`; Pyth ships an equivalent list for their price IDs.
