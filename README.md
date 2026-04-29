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

Deploy the proxy locally:

```sh
make deploy-local
```

This deploys `SedaPythAdapter` behind a UUPS proxy using:

- `SEDA_PROVER=0x1000000000000000000000000000000000000001`
- `OWNER=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266`
- Anvil account `0`

Upgrade the existing proxy locally:

```sh
make upgrade-local PROXY_ADDRESS=0x...
```

The local upgrade target uses the test-only implementation `SedaPythAdapterV2Mock`.

## Useful checks

Verify proxy state after deployment or upgrade:

```sh
cast call <PROXY_ADDRESS> "owner()(address)" --rpc-url http://127.0.0.1:8545
cast call <PROXY_ADDRESS> "getProver()(address)" --rpc-url http://127.0.0.1:8545
cast call <PROXY_ADDRESS> "version()(uint256)" --rpc-url http://127.0.0.1:8545
```

`version()` exists only after upgrading to `SedaPythAdapterV2Mock`.
