# seda-pricefeed-adapter

Foundry-based SEDA price feed adapter project with OpenZeppelin UUPS upgrade flow.

## Prerequisites

- [Foundry](https://getfoundry.sh) (`forge`, `cast`, `anvil` on `PATH`)
- [`just`](https://github.com/casey/just) (`brew install just`) — task runner
- [Node.js](https://nodejs.org) (LTS, `node` + `npx` on `PATH`) — required by the
  [OpenZeppelin Foundry Upgrades](https://github.com/OpenZeppelin/openzeppelin-foundry-upgrades)
  plugin, which shells out to `npx @openzeppelin/upgrades-core` over FFI to
  validate UUPS implementations (initializer + ERC-7201 namespaced storage layout).
  Used by both the upgrade tests and every deploy/upgrade script.

Optional: copy [`.env.example`](.env.example) to `.env` for non-local deployments.

Run `just` (no args) at any time to see the full recipe list grouped by purpose.

## Local workflow

Start a local chain:

```sh
anvil
```

Build and run tests:

```sh
just build       # Optional; `just test` does its own clean + build first.
just test        # Full suite (runs the OZ Upgrades validator on *Upgrade.t.sol).
just test-upgrade  # Only the upgrade tests (slowest path; iterate in isolation).
```

Forge flags pass through `just test`, so single-file runs are one-liners:

```sh
just test --match-path test/FastProverUpgrade.t.sol -vvv
just test --match-contract FastProver --isolate
```

Why `just test` does a clean rebuild: the upgrade tests use `Upgrades.deployUUPSProxy` /
`Upgrades.upgradeProxy`, which shell out to `npx @openzeppelin/upgrades-core` to validate
the implementation (initializer + ERC-7201 storage layout). The validator rejects partial
`build_info` artifacts produced by incremental compiles, so the `test` recipe depends on
`rebuild` (`forge clean && forge build`) before `forge test`.

Before opening a PR, run the full CI pipeline locally:

```sh
just ci
```

This follows `.github/workflows/test.yml`: `forge fmt --check`, `forge build`, contract
sizes (`forge build --sizes src/*`), then `just test --isolate -vvv` (same clean rebuild +
tests as CI, including the OZ validator), then `forge coverage --report summary --report lcov`
with the default Foundry profile. It also prints tool versions and exits early if `node` /
`npx` are missing. GitHub additionally filters `lcov` for `src/` and posts coverage on PRs —
not replicated locally. Local `just ci` always uses the `pr` profile; pushes to `main` on
GitHub use the heavier `ci` profile for fuzz/invariants.

Optional: `just coverage` runs summary + `lcov` without the rest of CI.

If `just ci` passes locally, the PR workflow should pass too (same sequence and
equivalent env for tests/coverage).

## Deploy

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

## Upgrade

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

## Trusted-key admin

Add and/or remove trusted keys on a deployed prover (positional CSVs):

```sh
just update-prover-keys 0x<PROVER_ADDRESS> 0xabc...,0xdef...
just update-prover-keys 0x<PROVER_ADDRESS> "" 0xabc...
```

For an end-to-end smoke test of the full deploy + upgrade pipeline against
anvil (including state seeding and reinitializer verification), see
[docs/upgrade-testing.md](docs/upgrade-testing.md).

## Useful checks

Verify state after deployment or upgrade:

```sh
cast call <PROVER_PROXY> "owner()(address)" --rpc-url http://127.0.0.1:8545
cast call <PROVER_PROXY> "getAllTrustedKeys()(address[])" --rpc-url http://127.0.0.1:8545
cast call <ADAPTER_PROXY> "owner()(address)" --rpc-url http://127.0.0.1:8545
cast call <ADAPTER_PROXY> "getProver()(address)" --rpc-url http://127.0.0.1:8545
cast call <PROXY_ADDRESS> "version()(uint256)" --rpc-url http://127.0.0.1:8545
```

`version()` exists only after upgrading to one of the local V2 mock implementations.
