# SEDA PriceFeedAdapter

A Pyth-compatible price feed adapter for the [SEDA Protocol](https://www.seda.xyz/) FAST oracle path. SEDA FAST signs oracle results with ECDSA, and this adapter verifies those signatures on-chain and exposes the resulting prices through the standard `IPyth` interface.

For architecture details, see [DESIGN.md](DESIGN.md).

## Overview

The **SedaPythAdapter** (`contracts/SedaPythAdapter.sol`) accepts signed SEDA FAST oracle results, verifies them through the **FastProver** (`contracts/prover/FastProver.sol`), and writes per-feed prices into namespaced storage keyed by `feedId`. Clients read prices through the Pyth interface (`getPriceUnsafe`, `getPriceNoOlderThan`, `parsePriceFeedUpdates`, ...). Shared SEDA verification logic lives in `contracts/base/BaseSedaAdapter.sol` so future adapters (e.g. a Chainlink-style adapter) can reuse it.

Both contracts are UUPS-upgradeable and use ERC-7201 namespaced storage.

## Feed identity

```
feedId = keccak256(abi.encode(drId, symbolId))
```

- `drId` is the SEDA data request id. It commits to the oracle program (exec + tally) and the full `execInputs` (including the batch symbol list).
- `symbolId` is the per-symbol identifier carried in each `SedaPriceUpdate` entry (for Pyth-compatible deployments, this is the Pyth price feed id).

This shape is interim: changing the batch (adding or removing a symbol) changes the `drId` and therefore rekeys every feed. Consumers integrating this version effectively hard-code a fixed batch.

## Prerequisites

- [Bun](https://bun.sh)
- **Base Sepolia (example):** `DEPLOYER_PRIVATE_KEY`; optional `BASE_SEPOLIA_RPC_URL`; `BASESCAN_API_KEY` if you verify contracts (see `hardhat.config.ts`)

## Quick start

```bash
bun install
bun run compile
bun test
```

## Deploy

The repository ships a single deployment script that deploys FastProver and SedaPythAdapter (both as UUPS proxies) and registers the SEDA FAST testnet signer as a trusted key on the prover:

```bash
bunx hardhat run scripts/deploy-seda-pyth.ts --network baseSepolia
```

You can also use `--network local` against a node at `http://127.0.0.1:8545` (see `hardhat.config.ts`). Add other networks there as needed.

The script prints the two proxy addresses and the trusted key on completion.

## Pushing updates

Any account can push updates; the prover enforces that the signature comes from a trusted SEDA FAST signer, and the adapter enforces `consensus == true` and `exitCode == 0`.

Each element of `updateData` is an ABI-encoded `BaseSedaAdapter.SignedPayload`:

```solidity
struct SignedPayload {
    bytes data;      // ABI-encoded SedaDataTypes.Result
    bytes signature; // SEDA FAST ECDSA signature over deriveResultId(result)
}
```

The oracle program's tally output (`result.result`) must ABI-encode a non-empty `SedaPythAdapter.SedaPriceUpdate[]`:

```solidity
struct SedaPriceUpdate {
    bytes32 symbolId;              // e.g. Pyth price feed id
    PythAdapterStorage.PriceInfo priceInfo;
}
```

Submit through either `updatePriceFeeds(bytes[])` or `updatePriceFeedsIfNecessary(bytes[], bytes32[], uint64[])`. See `scripts/test-e2e.ts` for a full end-to-end example.

## Reading prices

```solidity
IPyth pyth = IPyth(adapter);
PythStructs.Price memory p = pyth.getPriceUnsafe(feedId);
// or, with a freshness bound:
PythStructs.Price memory p2 = pyth.getPriceNoOlderThan(feedId, maxAgeSeconds);
```

`feedId` is computed client-side via `keccak256(abi.encode(drId, symbolId))`.

## Development

### Quality gates

```bash
bun run check           # lint + Solidity format check
bun run lint            # TypeScript (Biome) + Solidity (solhint)
bun run lint:ts:fix
bun run lint:sol:fix
bun run format:sol:fix
```

### Tests with reporting

```bash
bun run test:gas        # REPORT_GAS=true
bun run test:coverage   # COVERAGE=true + hardhat coverage
```

### Cleanup

```bash
bun run clean           # hardhat clean + cache/coverage dirs
```

## Security

- Only the FastProver's trusted signer set can produce accepted signatures.
- The adapter additionally requires every accepted result to be in consensus with `exitCode == 0`.
- Owner controls: updating the prover address, pausing updates, and authorizing upgrades.
- Storage uses ERC-7201 namespaced layouts; upgrades are UUPS with `onlyOwner` authorization.

## License

MIT. See [LICENSE](LICENSE).

---

contracts/
├── SedaPythAdapter.sol
├── base/
│   ├── BaseUpgradeable.sol
│   ├── BaseSedaAdapter.sol
│   └── SedaAdapterStorage.sol
├── prover/
│   ├── FastProver.sol
│   ├── FastProverStorage.sol
│   └── SedaDataTypes.sol
└── pyth/
    ├── BasePythAdapter.sol
    ├── PythAdapterStorage.sol
    └── external/
        ├── IPyth.sol
        ├── IPythEvents.sol
        ├── PythStructs.sol
        └── PythErrors.sol