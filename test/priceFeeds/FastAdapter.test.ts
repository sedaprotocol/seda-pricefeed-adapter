import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import type { Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import type { FastAdapter } from "../../typechain-types/contracts/FastAdapter";
import type { FastProver } from "../../typechain-types/contracts/FastProver";
import {
  computeAssetId,
  createEmptyBatchPayload,
  createInvalidExitCodePayload,
  createPastTimestamp,
  createValidUpdateData,
  submitPriceUpdate,
} from "../helpers/priceFeedHelpers";
import { createTrustedKey } from "../helpers/proverHelpers";

describe("FastAdapter", () => {
  // Fixture function
  async function deployFastAdapterFixture() {
    const [owner, user] = await ethers.getSigners();

    // Deploy FastProver contract
    const FastProver = await ethers.getContractFactory("FastProver");
    const fastProver = (await upgrades.deployProxy(
      FastProver,
      [owner.address],
      {
        initializer: "initialize",
      },
    )) as unknown as FastProver;

    // Deploy FastAdapter
    const FastAdapter = await ethers.getContractFactory("FastAdapter");
    const fastAdapter = await upgrades.deployProxy(
      FastAdapter,
      [await fastProver.getAddress(), owner.address],
      {
        initializer: "initialize",
      },
    );

    return {
      fastAdapter,
      fastProver,
      owner,
      user,
    };
  }

  describe("Initialization", () => {
    it("Should initialize with correct parameters", async () => {
      const { fastAdapter, fastProver, owner } = await loadFixture(
        deployFastAdapterFixture,
      );

      expect(await fastAdapter.owner()).to.equal(owner.address);
      expect(await fastAdapter.getProver()).to.equal(
        await fastProver.getAddress(),
      );
    });
  });

  describe("Access Control", () => {
    describe("Prover Management", () => {
      it("Should allow owner to update prover", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const [newOwner] = await ethers.getSigners();
        const NewFastProver = await ethers.getContractFactory("FastProver");
        const newFastProver = await upgrades.deployProxy(
          NewFastProver,
          [newOwner.address],
          {
            initializer: "initialize",
          },
        );

        await expect(fastAdapter.updateProver(await newFastProver.getAddress()))
          .to.emit(fastAdapter, "ProverUpdated")
          .withArgs(
            await fastProver.getAddress(),
            await newFastProver.getAddress(),
          );

        expect(await fastAdapter.getProver()).to.equal(
          await newFastProver.getAddress(),
        );
      });

      it("Should revert when non-owner tries to update prover", async () => {
        const { fastAdapter, user } = await loadFixture(
          deployFastAdapterFixture,
        );

        await expect(
          fastAdapter.connect(user).updateProver(user.address),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "OwnableUnauthorizedAccount",
        );
      });

      it("Should revert when updating prover to zero address", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);

        await expect(
          fastAdapter.updateProver(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(fastAdapter, "ZeroAddressNotAllowed");
      });
    });

    describe("Pausable Functions", () => {
      it("Should allow owner to pause/unpause", async () => {
        const { fastAdapter, owner } = await loadFixture(
          deployFastAdapterFixture,
        );

        await expect(fastAdapter.pause())
          .to.emit(fastAdapter, "Paused")
          .withArgs(owner.address);

        await expect(fastAdapter.unpause())
          .to.emit(fastAdapter, "Unpaused")
          .withArgs(owner.address);
      });

      it("Should revert when non-owner tries to pause", async () => {
        const { fastAdapter, user } = await loadFixture(
          deployFastAdapterFixture,
        );

        await expect(
          fastAdapter.connect(user).pause(),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "OwnableUnauthorizedAccount",
        );
      });
    });
  });

  describe("Price Feed Updates", () => {
    describe("Valid Updates", () => {
      it("Should successfully submit and store price update", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        // Add trusted key
        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        // Submit price update
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        // Verify asset was added to list
        const assetIds = await fastAdapter.getAssetIds();
        expect(assetIds.length).to.equal(1);

        // Verify price info
        const assetId = assetIds[0];
        const priceInfo = await fastAdapter.getPriceInfo(assetId);
        expect(priceInfo.price).to.equal(50000n);
        expect(priceInfo.conf).to.equal(100n);
        expect(priceInfo.publishTime).to.be.greaterThan(0);
      });

      it("Should handle multiple price updates", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        // Submit multiple updates
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );
        await submitPriceUpdate(fastAdapter, trustedKey, "ETH/USD", 3000n, 50n);

        const assetIds = await fastAdapter.getAssetIds();
        expect(assetIds.length).to.equal(2);
      });

      it("Should update existing price with newer timestamp", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        // Submit initial price
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        const assetIds = await fastAdapter.getAssetIds();
        const assetId = assetIds[0];
        const initialPriceInfo = await fastAdapter.getPriceInfo(assetId);

        // Wait a bit and submit updated price
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          51000n,
          120n,
        );

        const updatedPriceInfo = await fastAdapter.getPriceInfo(assetId);
        expect(updatedPriceInfo.price).to.equal(51000n);
        expect(updatedPriceInfo.publishTime).to.be.greaterThan(
          initialPriceInfo.publishTime,
        );
      });
    });

    describe("Invalid Updates", () => {
      it("Should revert with invalid signature", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const invalidPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes data, bytes signature)"],
          [{ data: ethers.toUtf8Bytes("invalid"), signature: "0x1234" }],
        );

        // Invalid signature length (2 bytes)
        await expect(fastAdapter.updatePriceFeeds([invalidPayload]))
          .to.be.revertedWithCustomError(
            fastProver,
            "ECDSAInvalidSignatureLength",
          )
          .withArgs(2);
      });

      it("Should revert with empty batch", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        const emptyBatch = {
          programConfig: {
            execProgramId: ethers.id("exec_program"),
            tallyProgramId: ethers.id("tally_program"),
          },
          result: {
            drId: ethers.id("dr_id"),
            gasUsed: 100000,
            blockHeight: 12345,
            blockTimestamp: Math.floor(Date.now() / 1000),
            consensus: true,
            exitCode: 0,
            version: "0.0.1",
            result: ethers.AbiCoder.defaultAbiCoder().encode(
              [
                "tuple(bytes32 id,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
              ],
              [[]], // Empty PriceUpdate array
            ),
            paybackAddress: "0x0000000000000000000000000000000000000000",
            sedaPayload: "0x",
          },
        };

        const priceUpdateBatch = ethers.AbiCoder.defaultAbiCoder().encode(
          [
            "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
          ],
          [emptyBatch],
        );

        const dataHash = ethers.keccak256(priceUpdateBatch);
        const signature = await trustedKey.signingKey.sign(dataHash);
        const serializedSignature = ethers.Signature.from(signature).serialized;

        const signedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes data, bytes signature)"],
          [{ data: priceUpdateBatch, signature: serializedSignature }],
        );

        await expect(
          fastAdapter.updatePriceFeeds([signedPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert with invalid exit code", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        const priceUpdate = {
          id: ethers.id("BTC/USD"),
          priceInfo: {
            publishTime: Math.floor(Date.now() / 1000),
            expo: -8,
            price: 50000n,
            conf: 100n,
            emaPrice: 50000n,
            emaConf: 100n,
          },
        };

        const result = {
          drId: ethers.id("dr_id"),
          gasUsed: 100000,
          blockHeight: 12345,
          blockTimestamp: Math.floor(Date.now() / 1000),
          consensus: true,
          exitCode: 1, // Invalid exit code
          version: "0.0.1",
          result: ethers.AbiCoder.defaultAbiCoder().encode(
            [
              "tuple(bytes32 id,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
            ],
            [[priceUpdate]],
          ),
          paybackAddress: "0x0000000000000000000000000000000000000000",
          sedaPayload: "0x",
        };

        const batch = {
          programConfig: {
            execProgramId: ethers.id("exec_program"),
            tallyProgramId: ethers.id("tally_program"),
          },
          result: result,
        };

        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          [
            "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
          ],
          [batch],
        );

        const dataHash = ethers.keccak256(data);
        const signature = await trustedKey.signingKey.sign(dataHash);
        const serializedSignature = ethers.Signature.from(signature).serialized;

        // Fix: Use struct syntax to match contract
        const signedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes data, bytes signature)"],
          [{ data, signature: serializedSignature }],
        );

        await expect(
          fastAdapter.updatePriceFeeds([signedPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert when paused", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);

        await fastAdapter.pause();

        // Fix: Use struct syntax to match contract
        const invalidPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes data, bytes signature)"],
          [{ data: ethers.toUtf8Bytes("test"), signature: "0x1234" }],
        );

        await expect(
          fastAdapter.updatePriceFeeds([invalidPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "EnforcedPause");
      });
    });

    describe("Edge Cases", () => {
      it("Should return empty asset IDs initially", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);

        const assetIds = await fastAdapter.getAssetIds();
        expect(assetIds.length).to.equal(0);
      });

      it("Should return zero price info for non-existent asset", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);

        const nonExistentAssetId = ethers.id("non_existent");
        const priceInfo = await fastAdapter.getPriceInfo(nonExistentAssetId);

        expect(priceInfo.price).to.equal(0);
        expect(priceInfo.conf).to.equal(0);
        expect(priceInfo.publishTime).to.equal(0);
      });

      it("Should revert with invalid signature", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const invalidPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes data, bytes signature)"],
          [{ data: ethers.toUtf8Bytes("invalid"), signature: "0x1234" }],
        );

        // The error comes from ECDSA.recover() which throws ECDSAInvalidSignatureLength
        await expect(
          fastAdapter.updatePriceFeeds([invalidPayload]),
        ).to.be.revertedWithCustomError(
          fastProver,
          "ECDSAInvalidSignatureLength",
        );
      });

      it("Should revert with ValidationFailed for invalid exit code", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        const invalidPayload = await createInvalidExitCodePayload(trustedKey);

        await expect(
          fastAdapter.updatePriceFeeds([invalidPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert with ValidationFailed for empty batch", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);

        const emptyPayload = await createEmptyBatchPayload(trustedKey);

        await expect(
          fastAdapter.updatePriceFeeds([emptyPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });
    });
  });

  describe("IPyth Interface", () => {
    let fastAdapter: FastAdapter;
    let fastProver: FastProver;
    let _owner: SignerWithAddress;
    let trustedKey: Wallet;
    let assetId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFastAdapterFixture);
      fastAdapter = fixture.fastAdapter;
      fastProver = fixture.fastProver;
      _owner = fixture.owner;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);
      assetId = computeAssetId("BTC/USD");
    });

    describe("getPriceUnsafe", () => {
      it("Should return price for existing asset", async () => {
        // First, submit a price update
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        const price = await fastAdapter.getPriceUnsafe(assetId);
        expect(price.price).to.equal(50000n);
        expect(price.conf).to.equal(100n);
        expect(price.expo).to.equal(-8);
        expect(price.publishTime).to.be.greaterThan(0);
      });

      it("Should revert for non-existent asset", async () => {
        const nonExistentId = ethers.id("non_existent");
        await expect(
          fastAdapter.getPriceUnsafe(nonExistentId),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");
      });
    });

    describe("getEmaPriceUnsafe", () => {
      it("Should return EMA price for existing asset", async () => {
        // Submit a price update
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        const emaPrice = await fastAdapter.getEmaPriceUnsafe(assetId);
        expect(emaPrice.price).to.equal(50000n); // EMA price should match regular price initially
        expect(emaPrice.conf).to.equal(100n);
        expect(emaPrice.expo).to.equal(-8);
        expect(emaPrice.publishTime).to.be.greaterThan(0);
      });

      it("Should revert for non-existent asset", async () => {
        const nonExistentId = ethers.id("non_existent");
        await expect(
          fastAdapter.getEmaPriceUnsafe(nonExistentId),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");
      });
    });

    describe("getPriceNoOlderThan", () => {
      it("Should return price within age limit", async () => {
        // Use a publish time that's clearly in the past to avoid timing issues
        const pastTime = createPastTimestamp(10); // 10 seconds ago

        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        // Use a reasonable age limit
        const price = await fastAdapter.getPriceNoOlderThan(assetId, 86400); // 24 hours
        expect(price.price).to.equal(50000n);
      });

      it("Should revert for non-existent asset", async () => {
        const nonExistentId = ethers.id("non_existent");
        await expect(
          fastAdapter.getPriceNoOlderThan(nonExistentId, 3600),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");
      });
    });

    describe("getEmaPriceNoOlderThan", () => {
      it("Should return EMA price within age limit", async () => {
        // Use a publish time that's clearly in the past to avoid timing issues
        const pastTime = createPastTimestamp(10); // 10 seconds ago
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        // Use a very large age limit to avoid any timing issues
        const emaPrice = await fastAdapter.getEmaPriceNoOlderThan(
          assetId,
          86400 * 365,
        ); // 1 year
        expect(emaPrice.price).to.equal(50000n);
      });
    });

    describe("getUpdateFee", () => {
      it("Should return zero fee", async () => {
        const fee = await fastAdapter.getUpdateFee([
          ethers.toUtf8Bytes("test"),
        ]);
        expect(fee).to.equal(0);
      });
    });

    describe("getTwapUpdateFee", () => {
      it("Should revert with NotImplemented", async () => {
        await expect(
          fastAdapter.getTwapUpdateFee([ethers.toUtf8Bytes("test")]),
        ).to.be.revertedWithCustomError(fastAdapter, "TwapNotImplemented");
      });
    });

    describe("updatePriceFeedsIfNecessary", () => {
      it("Should update when necessary", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        // Use a future timestamp to ensure update is needed
        const futureTime = createPastTimestamp(3600);

        await expect(
          fastAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [assetId],
            [futureTime],
          ),
        ).to.not.be.reverted;
      });

      it("Should revert with mismatched array lengths", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        await expect(
          fastAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [assetId],
            [0, 1], // Different lengths
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");
      });
    });

    describe("parsePriceFeedUpdates", () => {
      it("Should parse price feed updates", async () => {
        // Create update data with a timestamp that falls within our search range
        const pastTime = createPastTimestamp(1800); // 30 minutes ago
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        // Use staticCall to get the return value without executing a transaction
        const priceFeeds = await fastAdapter.parsePriceFeedUpdates.staticCall(
          [updateData],
          [assetId],
          0,
          Math.floor(Date.now() / 1000) + 3600, // Search up to 1 hour in the future
        );

        expect(priceFeeds.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(assetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
      });
    });

    describe("parsePriceFeedUpdatesWithConfig", () => {
      it("Should parse with configuration", async () => {
        // Create update data with a timestamp that falls within our search range
        const pastTime = createPastTimestamp(1800); // 30 minutes ago
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        // Use staticCall to get the return value without executing a transaction
        const result =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [assetId],
            0,
            Math.floor(Date.now() / 1000) + 3600, // Search up to 1 hour in the future
            false, // checkUniqueness
            false, // checkUpdateDataIsMinimal
            false, // storeUpdatesIfFresh
          );

        const [priceFeeds, slots] = result;
        expect(priceFeeds.length).to.equal(1);
        expect(slots.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(assetId);
      });
    });

    describe("parsePriceFeedUpdatesUnique", () => {
      it("Should parse with uniqueness check", async () => {
        // Create update data with a timestamp that falls within our search range
        const pastTime = createPastTimestamp(1800); // 30 minutes ago
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        // Use staticCall to get the return value without executing a transaction
        const priceFeeds =
          await fastAdapter.parsePriceFeedUpdatesUnique.staticCall(
            [updateData],
            [assetId],
            0,
            Math.floor(Date.now() / 1000) + 3600, // Search up to 1 hour in the future
          );

        expect(priceFeeds.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(assetId);
      });
    });

    describe("parseTwapPriceFeedUpdates", () => {
      it("Should revert with NotImplemented", async () => {
        await expect(
          fastAdapter.parseTwapPriceFeedUpdates(
            [ethers.toUtf8Bytes("test")],
            [assetId],
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "TwapNotImplemented");
      });
    });
  });

  describe("UUPS Upgrade", () => {
    it("Should upgrade and preserve state", async () => {
      const { fastAdapter } = await loadFixture(deployFastAdapterFixture);

      // Verify initial state
      const initialProver = await fastAdapter.getProver();

      // Upgrade the contract
      const FastAdapterV2 = await ethers.getContractFactory("FastAdapter");
      const upgradedContract = await upgrades.upgradeProxy(
        fastAdapter,
        FastAdapterV2,
      );

      // Verify state is preserved
      expect(await upgradedContract.getProver()).to.equal(initialProver);
    });
  });
});
