# Manual upgrade testing

End-to-end smoke test for the local UUPS upgrade flow against anvil. Complements the in-process Foundry tests under [`test/`](../test/) by exercising the actual `forge script` deploy/upgrade pipeline that production runs will use.

## When to run this

- After changing any of `script/Deploy*.s.sol`, `script/Upgrade*.s.sol`, the [`justfile`](../justfile), or the local mock implementations under [`script/mocks/`](../script/mocks/).
- Before tagging a release that touches the upgrade plumbing.
- As a sanity check after pulling main if you're about to do a real (non-mock) upgrade.

## Prerequisites

- `anvil` running on `127.0.0.1:8545` (default port).
- Foundry installed and on `PATH` (`forge`, `cast`).
- [`just`](https://github.com/casey/just) on `PATH` (every step below uses `just <recipe>`).
- `node` + `npx` on `PATH` (the OZ Upgrades plugin invokes
  `npx @openzeppelin/upgrades-core` over FFI to validate every upgrade).
- Working directory: repo root.

In a separate terminal:

```sh
anvil
```

## What we're verifying

1. Deploy scripts produce a UUPS proxy that the OZ Upgrades plugin recognizes.
2. The upgrade script can swap the implementation while preserving storage (owner, trusted keys, prover address).
3. The post-upgrade `initializeV2()` call (gated by `reinitializer(2)`) actually executes — proven by the second call reverting with `InvalidInitialization`.

The two contract families are tested independently (`FastProver`, `SedaPythAdapter`).

## Common defaults

| Var | Default | Source |
| --- | --- | --- |
| `RPC_URL` | `http://127.0.0.1:8545` | anvil default |
| `OWNER` | `0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266` | anvil account 0 |
| `PRIVATE_KEY` | `0xac09…ff80` | anvil account 0 (well-known, local-only) |

All commands below assume those defaults. Override either by exporting in your
shell (`export RPC_URL=...; just <recipe>`), prefixing per-call
(`RPC_URL=... just <recipe>`), or copying [`.env.example`](../.env.example) to
`.env` (auto-loaded by `just`).

## FastProver flow

### 1. Run the upgrade unit tests first

```sh
just test-upgrade
```

This compiles from clean and runs both upgrade tests through the real OpenZeppelin
Upgrades validator (initializer + ERC-7201 namespaced storage layout). Expect both
`test_upgradePreservesStateAndExposesV2Surface` cases to pass. If they don't, stop —
fix that before exercising the live flow.

### 2. Deploy a fresh prover

```sh
just deploy-prover
```

Capture the printed `FastProver proxy: 0x...` line:

```sh
export PROVER_PROXY=0x...
```

### 3. Confirm V1 surface

```sh
cast call $PROVER_PROXY "owner()(address)" --rpc-url http://127.0.0.1:8545
# expect: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

cast call $PROVER_PROXY "version()(uint256)" --rpc-url http://127.0.0.1:8545
# expect: REVERT (V1 has no version() function)
```

### 4. Seed state we want to preserve across the upgrade

```sh
cast send $PROVER_PROXY "addTrustedKey(address)" 0x000000000000000000000000000000000000CAFE \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

cast call $PROVER_PROXY "isTrustedKey(address)(bool)" \
  0x000000000000000000000000000000000000CAFE \
  --rpc-url http://127.0.0.1:8545
# expect: true
```

### 5. Run the upgrade

```sh
just upgrade-prover $PROVER_PROXY
```

Expect `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` at the bottom of the output.

### 6. Verify state preserved and V2 surface reachable

```sh
cast call $PROVER_PROXY "owner()(address)" --rpc-url http://127.0.0.1:8545
# expect: same owner as step 3

cast call $PROVER_PROXY "isTrustedKey(address)(bool)" \
  0x000000000000000000000000000000000000CAFE \
  --rpc-url http://127.0.0.1:8545
# expect: true (state survived the upgrade)

cast call $PROVER_PROXY "version()(uint256)" --rpc-url http://127.0.0.1:8545
# expect: 2
```

### 7. Confirm `initializeV2()` actually ran

```sh
cast send $PROVER_PROXY "initializeV2()" \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Expect a revert with `InvalidInitialization`. Why: `reinitializer(2)` was already consumed by the upgrade script's `CALL_INITIALIZE_V2=true` path, so the second invocation must fail. A *successful* second call would mean the upgrade silently skipped the init.

## SedaPythAdapter flow

Use `deploy-all` to provision both proxies in one shot, then upgrade only the adapter.

```sh
just deploy-all
```

Capture the `SedaPythAdapter proxy: 0x...` line:

```sh
export ADAPTER_PROXY=0x...

cast call $ADAPTER_PROXY "getProver()(address)" --rpc-url http://127.0.0.1:8545
cast call $ADAPTER_PROXY "owner()(address)"     --rpc-url http://127.0.0.1:8545

just upgrade-pyth-adapter $ADAPTER_PROXY

cast call $ADAPTER_PROXY "version()(uint256)"   --rpc-url http://127.0.0.1:8545
# expect: 2
cast call $ADAPTER_PROXY "getProver()(address)" --rpc-url http://127.0.0.1:8545
# expect: same prover as before upgrade

cast send $ADAPTER_PROXY "initializeV2()" \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# expect: REVERT InvalidInitialization
```

## Pass/fail checklist

- [ ] `forge build` clean.
- [ ] `just test-upgrade` green.
- [ ] `just deploy-prover` succeeds and prints proxy address.
- [ ] After `just upgrade-prover`: `version()` returns `2` and seeded trusted-key state is preserved.
- [ ] Re-calling `initializeV2()` reverts with `InvalidInitialization`.
- [ ] Same passes for `just deploy-all` + `just upgrade-pyth-adapter` (`version()`, `getProver()` unchanged, double-init reverts).

If every box checks, the local upgrade plumbing is healthy.

## Notes for the future

- Default `*_IMPLEMENTATION_ARTIFACT` values point at the local mock implementations under [`script/mocks/`](../script/mocks/) (`FastProverV2Mock`, `SedaPythAdapterV2Mock`). When a real V2 ships in `src/`, override via env:

  ```sh
  PROVER_IMPLEMENTATION_ARTIFACT=FastProverV2.sol:FastProverV2 \
    just upgrade-prover $PROVER_PROXY
  ```

- **Side-effect import required for any new V2.** `forge script`'s `vm.getCode` resolver only sees contracts transitively imported by the script file, even though `forge build` produces the artifact in `out/`. The current upgrade scripts add a `// forge-lint: disable-next-line(unused-import)` for `FastProverV2Mock` / `SedaPythAdapterV2Mock` so the mocks resolve. When you point `*_IMPLEMENTATION_ARTIFACT` at a real V2 (or a different mock), add the same import line to [`script/UpgradeFastProver.s.sol`](../script/UpgradeFastProver.s.sol) / [`script/UpgradePythAdapter.s.sol`](../script/UpgradePythAdapter.s.sol). Without it the script reverts with `vm.getCode: no matching artifact found` after the OZ validator subprocess returns `SUCCESS` (the failure is in Foundry's resolver, not the validator).

- The upgrade scripts encode `initializeV2()` (no-arg) when `CALL_INITIALIZE_V2=true`. If your real V2's reinitializer takes arguments, build the calldata yourself and pass it via `INITIALIZE_DATA` (hex):

  ```sh
  INITIALIZE_DATA=$(cast calldata "initializeV2(address,uint256)" 0x... 42) \
    just upgrade-prover $PROVER_PROXY
  ```

- Anvil has no persistence between restarts. Re-run `just deploy-*` whenever you bounce it.
- Mainnet/testnet runs use the same scripts but with `RPC_URL`, `OWNER`, and signer flags pointing elsewhere. Never reuse the local default `PRIVATE_KEY` outside anvil.
- The Foundry tests in [`test/`](../test/) cover the upgrade logic in isolation (no on-chain broadcast). This document covers the broadcast pipeline. Both should pass — they catch different classes of regressions.
