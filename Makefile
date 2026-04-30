.PHONY: build clean test test-upgrade test-upgrade-prover test-upgrade-pyth-adapter deploy-prover deploy-pyth-adapter deploy-all upgrade-prover upgrade-pyth-adapter update-prover-keys

RPC_URL ?= http://127.0.0.1:8545
PRIVATE_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER ?= 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
PROVER_ADDRESS ?=
PROXY_ADDRESS ?=
TRUSTED_KEYS ?=
ADD_TRUSTED_KEYS ?=
REMOVE_TRUSTED_KEYS ?=
PROVER_IMPLEMENTATION_ARTIFACT ?= FastProverV2Mock.sol:FastProverV2Mock
PYTH_ADAPTER_IMPLEMENTATION_ARTIFACT ?= SedaPythAdapterV2Mock.sol:SedaPythAdapterV2Mock

build:
	forge build

clean:
	forge clean

test:
	forge test

test-upgrade:
	forge test --match-path test/*Upgrade.t.sol -vv

test-upgrade-prover:
	forge test --match-path test/FastProverUpgrade.t.sol -vv

test-upgrade-pyth-adapter:
	forge test --match-path test/SedaPythAdapterUpgrade.t.sol -vv

deploy-prover:
	forge clean
	forge build
	OWNER=$(OWNER) TRUSTED_KEYS=$(TRUSTED_KEYS) forge script script/DeployFastProver.s.sol:DeployFastProverScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --broadcast

deploy-pyth-adapter:
	forge clean
	forge build
	PROVER_ADDRESS=$(PROVER_ADDRESS) OWNER=$(OWNER) forge script script/DeployPythAdapter.s.sol:DeployPythAdapterScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --broadcast

deploy-all:
	forge clean
	forge build
	OWNER=$(OWNER) TRUSTED_KEYS=$(TRUSTED_KEYS) forge script script/DeployAll.s.sol:DeployAllScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --broadcast

upgrade-prover:
	forge clean
	forge build
	PROXY_ADDRESS=$(PROXY_ADDRESS) IMPLEMENTATION_ARTIFACT=$(PROVER_IMPLEMENTATION_ARTIFACT) CALL_INITIALIZE_V2=true forge script script/UpgradeFastProver.s.sol:UpgradeFastProverScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --sender $(OWNER) --broadcast

upgrade-pyth-adapter:
	forge clean
	forge build
	PROXY_ADDRESS=$(PROXY_ADDRESS) IMPLEMENTATION_ARTIFACT=$(PYTH_ADAPTER_IMPLEMENTATION_ARTIFACT) CALL_INITIALIZE_V2=true forge script script/UpgradePythAdapter.s.sol:UpgradePythAdapterScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --sender $(OWNER) --broadcast

update-prover-keys:
	forge build
	PROVER_ADDRESS=$(PROVER_ADDRESS) ADD_TRUSTED_KEYS=$(ADD_TRUSTED_KEYS) REMOVE_TRUSTED_KEYS=$(REMOVE_TRUSTED_KEYS) forge script script/UpdateFastProverKeys.s.sol:UpdateFastProverKeysScript --rpc-url $(RPC_URL) --private-key $(PRIVATE_KEY) --sender $(OWNER) --broadcast
