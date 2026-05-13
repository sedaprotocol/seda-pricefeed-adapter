# seda-pricefeed-adapter

A Pyth-compatible price feed adapter for the
[SEDA Protocol](https://seda.xyz) FAST oracle path. SEDA FAST signs oracle
results with ECDSA, and this adapter verifies those signatures on-chain and
exposes the resulting prices through the standard
[`IPyth`](https://docs.pyth.network/) interface.

## Overview

The **SedaPythAdapter** (`src/SedaPythAdapter.sol`) accepts signed SEDA FAST
oracle results, verifies them through the **FastProver**
(`src/prover/FastProver.sol`), and writes per-feed prices into namespaced
storage keyed by `feedId`. Clients read prices through the Pyth interface
(`getPriceUnsafe`, `getPriceNoOlderThan`, `parsePriceFeedUpdates`, ...).
Shared SEDA verification logic lives in `src/base/BaseSedaAdapter.sol` so
future adapters (e.g. a Chainlink-style adapter) can reuse it.

Both contracts are UUPS-upgradeable and use ERC-7201 namespaced storage.

### Feed identity

```
feedId = keccak256(abi.encode(drId, symbolId))
```

- `drId` is the SEDA data request id. It commits to the oracle program
  (exec + tally) and the full `execInputs` (including the batch symbol list).
- `symbolId` is the per-symbol identifier carried in each `SedaPriceUpdate`
  entry (for Pyth-compatible deployments, this is the Pyth price feed id).

> **Note:** This shape is interim — changing the batch (adding or removing a
> symbol) changes the `drId` and therefore rekeys every feed. Consumers
> integrating this version effectively hard-code a fixed batch.

### Pushing updates

Any account can push updates; the prover enforces that the signature comes
from a trusted SEDA FAST signer, and the adapter enforces `consensus == true`
and `exitCode == 0`.

Each element of `updateData` is an ABI-encoded `BaseSedaAdapter.SignedPayload`:

```solidity
struct SignedPayload {
    bytes data;      // ABI-encoded SedaDataTypes.Result
    bytes signature; // SEDA FAST ECDSA signature over deriveResultId(result)
}
```

The oracle program's tally output (`result.result`) must ABI-encode a
non-empty `SedaPythAdapter.SedaPriceUpdate[]`:

```solidity
struct SedaPriceUpdate {
    bytes32 symbolId;                      // e.g. Pyth price feed id
    BasePythAdapter.PriceInfo priceInfo;    // price, conf, expo, ema, publishTime
}
```

Submit through either `updatePriceFeeds(bytes[])` or
`updatePriceFeedsIfNecessary(bytes[], bytes32[], uint64[])`.

### Reading prices

```solidity
IPyth pyth = IPyth(adapter);
PythStructs.Price memory p = pyth.getPriceUnsafe(feedId);
// or, with a freshness bound:
PythStructs.Price memory p2 = pyth.getPriceNoOlderThan(feedId, maxAgeSeconds);
```

`feedId` is computed client-side via `keccak256(abi.encode(drId, symbolId))`.

## Prerequisites

- [Foundry](https://getfoundry.sh) (`forge`, `cast`, `anvil` on `PATH`)
- [`just`](https://github.com/casey/just) (`brew install just`) — task runner
- [Node.js](https://nodejs.org) (LTS, `node` + `npx` on `PATH`) — required by the
  [OpenZeppelin Foundry Upgrades](https://github.com/OpenZeppelin/openzeppelin-foundry-upgrades)
  plugin, which shells out to `npx @openzeppelin/upgrades-core` over FFI to
  validate UUPS implementations (initializer + ERC-7201 namespaced storage layout).
  Used by both the upgrade tests and every deploy/upgrade script.

Optional: copy [`.env.example`](.env.example) to `.env` for live network deployments.

Run `just` (no args) at any time to see the full recipe list grouped by purpose.

## Development

### Build & test

```sh
just build       # Optional; `just test` does its own clean + build first.
just test        # Full suite (runs the OZ Upgrades validator on *.upgrade.t.sol).
just test-upgrade  # Only the upgrade tests (slowest path; iterate in isolation).
```

Forge flags pass through `just test`, so single-file runs are one-liners:

```sh
just test --match-path test/prover/FastProver.upgrade.t.sol -vvv
just test --match-contract FastProver --isolate
```

Why `just test` does a clean rebuild: the upgrade tests use `Upgrades.deployUUPSProxy` /
`Upgrades.upgradeProxy`, which shell out to `npx @openzeppelin/upgrades-core` to validate
the implementation (initializer + ERC-7201 storage layout). The validator rejects partial
`build_info` artifacts produced by incremental compiles, so the `test` recipe depends on
`rebuild` (`forge clean && forge build`) before `forge test`.

### CI

Before opening a PR, run the full CI pipeline locally:

```sh
just ci
```

This follows `.github/workflows/test.yml`: `forge fmt --check`, `forge build`, contract
sizes (`forge build --sizes src/*`), then `just test --isolate -vvv` (same clean rebuild +
tests as CI, including the OZ validator), then `forge coverage` (summary + lcov, default
profile, scoped to `src/` via `--no-match-coverage '(script\|test\|lib)/'` so deploy/upgrade
scripts and the V2 mocks under `script/mocks/` don't skew the totals). It also prints tool
versions and exits early if `node` / `npx` are missing. GitHub additionally posts the
coverage summary on PRs — not replicated locally. Local `just ci` always uses the `pr`
profile; pushes to `main` on GitHub use the heavier `ci` profile for fuzz/invariants.

Optional: `just coverage` runs summary + `lcov` without the rest of CI.

If `just ci` passes locally, the PR workflow should pass too (same sequence and
equivalent env for tests/coverage).

### Local deploy (anvil)

Start a local chain:

```sh
anvil
```

Deploy the prover only:

```sh
just deploy-prover
```

Deploy the Pyth adapter against an existing prover:

```sh
just deploy-pyth-adapter 0x<PROVER_ADDRESS>
```

Deploy both contracts in one shot:

```sh
just deploy-all
```

Default local values (override via `.env` or shell env):

- `OWNER=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266` (anvil account 0)
- `PRIVATE_KEY=0xac09…ff80` (anvil account 0; never reuse outside anvil)
- `RPC_URL=http://127.0.0.1:8545`

Optionally seed prover signer keys at deploy time (positional CSV):

```sh
just deploy-prover 0xabc...,0xdef...
just deploy-all 0xabc...,0xdef...
```

## Deploy (live network)

### 1. One-time wallet setup

Import your deployer key into Foundry's encrypted keystore:

```sh
cast wallet import deployer --interactive
```

Fund the deployer address with the target network's native token (e.g. via
faucet for testnets).

### 2. Configure `.env`

```sh
cp .env.example .env
```

Edit `.env` for the target network:

```sh
RPC_URL=https://your-rpc-endpoint
PRIVATE_KEY=
ACCOUNT=deployer
OWNER=0xYOUR_DEPLOYER_ADDRESS
```

When `ACCOUNT` is set, every `just` recipe uses the encrypted keystore
(`--account deployer`) and ignores `PRIVATE_KEY`.

### 3. Deploy the FastProver

```sh
just deploy-prover
# With trusted signer keys:
just deploy-prover "0xSIGNER1,0xSIGNER2"
```

Save the proxy address from the output (`FastProver proxy: 0x...`).

Verify on-chain:

```sh
cast call <PROVER_PROXY> "owner()(address)" --rpc-url $RPC_URL
cast call <PROVER_PROXY> "VERSION()(uint256)" --rpc-url $RPC_URL
cast call <PROVER_PROXY> "paused()(bool)" --rpc-url $RPC_URL
cast call <PROVER_PROXY> "getAllTrustedKeys()(address[])" --rpc-url $RPC_URL
```

### 4. Deploy the SedaPythAdapter

```sh
just deploy-pyth-adapter <PROVER_PROXY>
```

Save the adapter proxy address from the output (`SedaPythAdapter proxy: 0x...`).

Verify on-chain:

```sh
cast call <ADAPTER_PROXY> "owner()(address)" --rpc-url $RPC_URL
cast call <ADAPTER_PROXY> "getProver()(address)" --rpc-url $RPC_URL
```

### 5. Verify source code

Both proxies are ERC1967; source verification targets the **implementation**
contracts. Read each implementation address from its proxy's ERC1967 slot:

```sh
cast storage <PROXY> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url $RPC_URL
```

Strip the leading `0x000000000000000000000000` to get the implementation address.

**Sourcify (no API key required):**

```sh
forge verify-contract <PROVER_IMPL> src/prover/FastProver.sol:FastProver \
  --chain <CHAIN_ID> --verifier sourcify \
  --verifier-url <SOURCIFY_API_URL>

forge verify-contract <ADAPTER_IMPL> src/SedaPythAdapter.sol:SedaPythAdapter \
  --chain <CHAIN_ID> --verifier sourcify \
  --verifier-url <SOURCIFY_API_URL>
```

**Etherscan-compatible explorer (Etherscan, Blockscout, etc.):**

```sh
forge verify-contract <PROVER_IMPL> src/prover/FastProver.sol:FastProver \
  --chain <CHAIN_ID> --verifier etherscan \
  --etherscan-api-key <API_KEY> --watch

forge verify-contract <ADAPTER_IMPL> src/SedaPythAdapter.sol:SedaPythAdapter \
  --chain <CHAIN_ID> --verifier etherscan \
  --etherscan-api-key <API_KEY> --watch
```

If the explorer uses a non-default API URL, add `--verifier-url <URL>`.

### 6. Record the deployment

Set `DEPLOYMENT_NAME` before deploying and the scripts automatically write
proxy/implementation addresses, deployer, chain ID, git version, and block
timestamp to `deployments/<CHAIN_ID>-<DEPLOYMENT_NAME>.json`:

```sh
DEPLOYMENT_NAME=my-testnet just deploy-prover
DEPLOYMENT_NAME=my-testnet just deploy-pyth-adapter <PROVER_PROXY>
```

When deploying step-by-step, `DeployFastProver` creates the file and
`DeployPythAdapter` appends to it. `DeployAll` writes both in one shot.

If `DEPLOYMENT_NAME` is unset, no file is written (opt-in).

## Operations

### Trusted-key admin

The FastProver tracks trusted ECDSA signers by their **Ethereum address** (the
last 20 bytes of `keccak256(uncompressed_public_key)`). If you have a compressed
public key (33 bytes, starts with `02` or `03`), derive the address with:

```sh
cast keccak 0x<UNCOMPRESSED_64_BYTES>   # last 40 hex chars = address
```

Decompressing the key requires an external tool (e.g. `openssl`, Python, or
`chisel`); `cast` does not support compressed-to-uncompressed conversion
directly.

Add and/or remove trusted keys on a deployed prover (positional CSVs):

```sh
just update-prover-keys 0x<PROVER_ADDRESS> "0xADDR1,0xADDR2"           # add
just update-prover-keys 0x<PROVER_ADDRESS> "" "0xADDR1"                # remove
just update-prover-keys 0x<PROVER_ADDRESS> "0xNEW" "0xOLD1,0xOLD2"    # add + remove
```

Verify after updating:

```sh
cast call <PROVER_PROXY> "isTrustedKey(address)(bool)" 0xADDR --rpc-url $RPC_URL
cast call <PROVER_PROXY> "getAllTrustedKeys()(address[])" --rpc-url $RPC_URL
cast call <PROVER_PROXY> "getTrustedKeysCount()(uint256)" --rpc-url $RPC_URL
```

### Upgrade

Upgrade the prover behind an existing proxy:

```sh
just upgrade-prover 0x<PROXY_ADDRESS>
```

Upgrade the Pyth adapter behind an existing proxy:

```sh
just upgrade-pyth-adapter 0x<PROXY_ADDRESS>
```

By default the upgrade recipes target the V2 mock implementations
(`FastProverV2Mock`, `SedaPythAdapterV2Mock`). Override per call when a real V2
ships in `src/`:

```sh
PROVER_IMPLEMENTATION_ARTIFACT=FastProverV2.sol:FastProverV2 \
  just upgrade-prover 0x<PROXY_ADDRESS>

PYTH_ADAPTER_IMPLEMENTATION_ARTIFACT=SedaPythAdapterV2.sol:SedaPythAdapterV2 \
  just upgrade-pyth-adapter 0x<PROXY_ADDRESS>
```

### Upgrade testing

For an end-to-end smoke test of the full deploy + upgrade pipeline against
anvil (including state seeding and reinitializer verification), see
[docs/upgrade-testing.md](docs/upgrade-testing.md).

## Security

- Only the FastProver's trusted signer set can produce accepted signatures.
- The adapter additionally requires every accepted result to have consensus
  with `exitCode == 0`.
- Owner controls: updating the prover address, pausing updates, and
  authorizing upgrades.
- Storage uses ERC-7201 namespaced layouts; upgrades are UUPS with `onlyOwner`
  authorization.

## License

MIT. See [LICENSE](LICENSE).
