# seda-pricefeed-adapter

Foundry-based SEDA price feed adapter project with OpenZeppelin UUPS upgrade flow.

## Local workflow

Start a local chain:

```sh
anvil
```

Build and run tests:

```sh
make build
make test
make test-upgrade
```

Run upgrade smoke tests individually:

```sh
make test-upgrade-prover
make test-upgrade-pyth-adapter
```

Deploy the prover only:

```sh
make deploy-prover
```

Deploy the Pyth adapter only:

```sh
make deploy-pyth-adapter PROVER_ADDRESS=0x...
```

Deploy both contracts in order:

```sh
make deploy-all
```

Default local values:

- `OWNER=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266`
- Anvil account `0`

You can optionally seed prover signer keys during deployment:

```sh
make deploy-prover TRUSTED_KEYS=0xabc...,0xdef...
make deploy-all TRUSTED_KEYS=0xabc...,0xdef...
```

Upgrade the prover locally:

```sh
make upgrade-prover PROXY_ADDRESS=0x...
```

Upgrade the Pyth adapter locally:

```sh
make upgrade-pyth-adapter PROXY_ADDRESS=0x...
```

Update prover trusted keys after deployment:

```sh
make update-prover-keys PROVER_ADDRESS=0x... ADD_TRUSTED_KEYS=0xabc...,0xdef...
make update-prover-keys PROVER_ADDRESS=0x... REMOVE_TRUSTED_KEYS=0xabc...
```

Local upgrade targets use test-only implementations:

- `FastProverV2Mock`
- `SedaPythAdapterV2Mock`

For an end-to-end smoke test of the full deploy + upgrade pipeline against anvil
(including state seeding and reinitializer verification), see
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
