# Task runner. Run `just` (no args) for the recipe list.
# https://github.com/casey/just

set dotenv-load := true
set positional-arguments := true

# --- Defaults (override via env, .env, or `just VAR=value <recipe>`) --------
rpc_url := env_var_or_default("RPC_URL", "http://127.0.0.1:8545")
private_key := env_var_or_default("PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
owner := env_var_or_default("OWNER", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")

# Implementation artifacts for the upgrade tests.
prover_v2_artifact := env_var_or_default("PROVER_IMPLEMENTATION_ARTIFACT", "FastProverV2Mock.sol:FastProverV2Mock")
adapter_v2_artifact := env_var_or_default("PYTH_ADAPTER_IMPLEMENTATION_ARTIFACT", "SedaPythAdapterV2Mock.sol:SedaPythAdapterV2Mock")

# Sender flags. If ACCOUNT is set, use the encrypted keystore; otherwise fall
# back to the (anvil-only) raw private key. Set ACCOUNT for any non-local run:
#   cast wallet import deployer --interactive   # one-time
#   ACCOUNT=deployer just deploy-all             # per-run
account := env_var_or_default("ACCOUNT", "")
sender_flags := if account != "" { "--account " + account } else { "--private-key " + private_key }

# Default recipe: list everything.
default:
    @just --list

# --- Build / clean ---------------------------------------------------------

[group('build')]
build:
    forge build

[group('build')]
clean:
    forge clean

# `forge clean && forge build`. The OZ upgrades-core validator (used by every
# recipe that calls `Upgrades.*`: test, deploy-*, upgrade-*) needs a single
# full build_info; `forge build`'s incremental output is partial.
# Clean compile so the OZ upgrades-core validator gets a full build_info.
[group('build')]
rebuild:
    forge clean
    forge build

# --- Tests -----------------------------------------------------------------

# Extra CLI args go straight to forge:
#   just test --isolate -vvv
#   just test --match-contract FastProver
#   just test --match-path test/FastProverUpgrade.t.sol
# Shebang + "$@" preserves quoting so globs in flags (e.g.
# `--match-path 'test/*Upgrade.t.sol'`) are not expanded by the shell.
# Requires `node`/`npx` on PATH (OZ validator FFI used by upgrade tests).
# Run the full Foundry test suite (extra args forwarded to `forge test`).
[group('test')]
test *args: rebuild
    #!/usr/bin/env bash
    set -euo pipefail
    exec forge test "$@"

# Convenience: only the upgrade tests (slowest path; iterate on them in isolation).
[group('test')]
test-upgrade:
    just test --match-path "test/*Upgrade.t.sol" -vv

[group('test')]
coverage:
    forge coverage --report summary --report lcov

# --- Deploy ----------------------------------------------------------------

# Deploy a fresh FastProver UUPS proxy. Optional positional CSV of trusted keys.
[group('deploy')]
deploy-prover trusted_keys="": rebuild
    OWNER={{ owner }} TRUSTED_KEYS={{ trusted_keys }} \
      forge script script/DeployFastProver.s.sol:DeployFastProverScript \
      --rpc-url {{ rpc_url }} {{ sender_flags }} --broadcast

# Deploy SedaPythAdapter against an existing prover.
[group('deploy')]
deploy-pyth-adapter prover_address: rebuild
    PROVER_ADDRESS={{ prover_address }} OWNER={{ owner }} \
      forge script script/DeployPythAdapter.s.sol:DeployPythAdapterScript \
      --rpc-url {{ rpc_url }} {{ sender_flags }} --broadcast

# Deploy both proxies in one shot. Optional positional CSV of trusted keys.
[group('deploy')]
deploy-all trusted_keys="": rebuild
    OWNER={{ owner }} TRUSTED_KEYS={{ trusted_keys }} \
      forge script script/DeployAll.s.sol:DeployAllScript \
      --rpc-url {{ rpc_url }} {{ sender_flags }} --broadcast

# --- Upgrade ---------------------------------------------------------------

# Upgrade FastProver implementation behind an existing proxy.
[group('upgrade')]
upgrade-prover proxy_address: rebuild
    PROXY_ADDRESS={{ proxy_address }} \
    IMPLEMENTATION_ARTIFACT={{ prover_v2_artifact }} \
    CALL_INITIALIZE_V2=true \
      forge script script/UpgradeFastProver.s.sol:UpgradeFastProverScript \
      --rpc-url {{ rpc_url }} {{ sender_flags }} \
      --sender {{ owner }} --broadcast

# Upgrade SedaPythAdapter implementation behind an existing proxy.
[group('upgrade')]
upgrade-pyth-adapter proxy_address: rebuild
    PROXY_ADDRESS={{ proxy_address }} \
    IMPLEMENTATION_ARTIFACT={{ adapter_v2_artifact }} \
    CALL_INITIALIZE_V2=true \
      forge script script/UpgradePythAdapter.s.sol:UpgradePythAdapterScript \
      --rpc-url {{ rpc_url }} {{ sender_flags }} \
      --sender {{ owner }} --broadcast

# --- CI --------------------------------------------------------------------

# Mirrors `.github/workflows/test.yml` step order. GitHub uses profile `pr` on PRs
# and `ci` on pushes to main — locally we always use `pr` (lighter fuzz). GitHub-only:
# lcov filter + coverage PR comment + artifact upload. Needs `node`/`npx` on PATH.
# Run the same checks as the GitHub PR pipeline locally.
[group('ci')]
ci:
    #!/usr/bin/env bash
    set -euo pipefail
    export FOUNDRY_PROFILE=pr
    # No-op until you commit `.gas-snapshot`; then drift fails the run (same as CI).
    export FORGE_SNAPSHOT_CHECK=true

    echo "▶ Tool versions (parity with CI banner)"
    echo "Foundry profile: $FOUNDRY_PROFILE"
    forge --version
    command -v node >/dev/null && node --version && npx --version || {
      echo "error: node/npx not on PATH (required for OZ upgrade tests)" >&2
      exit 1
    }

    echo "▶ Check formatting (forge fmt --check)"
    forge fmt --check

    echo "▶ Compile (forge build)"
    forge build

    echo "▶ Contract sizes (forge build --sizes src/*)"
    forge build --sizes src/*

    echo "▶ Tests (same as CI: rebuild + forge test --isolate -vvv)"
    just test --isolate -vvv

    echo "▶ Coverage (summary + lcov, matches CI)"
    FOUNDRY_PROFILE=default forge coverage --report summary --report lcov

    echo ""
    echo "✓ All CI checks passed locally"

# --- Trusted keys ----------------------------------------------------------

# Add and/or remove trusted keys on a deployed prover. Pass CSVs.
[group('admin')]
update-prover-keys prover_address add_keys="" remove_keys="":
    just build
    PROVER_ADDRESS={{ prover_address }} \
    ADD_TRUSTED_KEYS={{ add_keys }} \
    REMOVE_TRUSTED_KEYS={{ remove_keys }} \
      forge script script/UpdateFastProverKeys.s.sol:UpdateFastProverKeysScript \
      --rpc-url {{ rpc_url }} {{ sender_flags }} \
      --sender {{ owner }} --broadcast
