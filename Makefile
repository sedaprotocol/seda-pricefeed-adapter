.PHONY: build clean test test-upgrade deploy-local upgrade-local

RPC_URL ?= http://127.0.0.1:8545
PRIVATE_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER ?= 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
SEDA_PROVER ?= 0x1000000000000000000000000000000000000001
IMPLEMENTATION_ARTIFACT ?= SedaPythAdapterV2Mock.sol:SedaPythAdapterV2Mock

build:
	forge build

clean:
	forge clean

test:
	forge test

test-upgrade:
	forge test --match-test test_upgradePreservesStateAndExposesV2Surface -vv

deploy-local:
	forge clean
	forge build
	SEDA_PROVER=$(SEDA_PROVER) OWNER=$(OWNER) forge script script/DeploySedaPythAdapter.s.sol:DeploySedaPythAdapterScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --broadcast

upgrade-local:
	forge clean
	forge build
	PROXY_ADDRESS=$(PROXY_ADDRESS) IMPLEMENTATION_ARTIFACT=$(IMPLEMENTATION_ARTIFACT) CALL_INITIALIZE_V2=true forge script script/UpgradeSedaPythAdapter.s.sol:UpgradeSedaPythAdapterScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --sender $(OWNER) --broadcast
