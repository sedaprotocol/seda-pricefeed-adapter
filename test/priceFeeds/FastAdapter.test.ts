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

// Standard test program IDs
const EXEC_PROGRAM_ID = ethers.id("exec_program");
const TALLY_PROGRAM_ID = ethers.id("tally_program");

describe("FastAdapter", () => {
  // Fixture function
  async function deployFastAdapterFixture() {
    const [owner, user] = await ethers.getSigners();

    const FastProver = await ethers.getContractFactory("FastProver");
    const fastProver = (await upgrades.deployProxy(
      FastProver,
      [owner.address],
      { initializer: "initialize" },
    )) as unknown as FastProver;

    const FastAdapter = await ethers.getContractFactory("FastAdapter");
    const fastAdapter = await upgrades.deployProxy(
      FastAdapter,
      [await fastProver.getAddress(), owner.address],
      { initializer: "initialize" },
    );

    return { fastAdapter, fastProver, owner, user };
  }

  // Helper to register a drId with program config
  async function registerDrId(adapter: FastAdapter, drId: string) {
    await adapter.registerDataRequest(drId, {
      execProgramId: EXEC_PROGRAM_ID,
      tallyProgramId: TALLY_PROGRAM_ID,
    });
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

    it("Should not initialize with zero owner address", async () => {
      const [owner] = await ethers.getSigners();
      const FastProver = await ethers.getContractFactory("FastProver");
      const fastProver = (await upgrades.deployProxy(
        FastProver,
        [owner.address],
        { initializer: "initialize" },
      )) as unknown as FastProver;

      const FastAdapter = await ethers.getContractFactory("FastAdapter");
      await expect(
        upgrades.deployProxy(
          FastAdapter,
          [await fastProver.getAddress(), ethers.ZeroAddress],
          { initializer: "initialize" },
        ),
      )
        .to.be.revertedWithCustomError(FastAdapter, "ZeroAddressNotAllowed")
        .withArgs("owner");
    });

    it("Should not initialize with zero prover address", async () => {
      const [owner] = await ethers.getSigners();
      const FastAdapter = await ethers.getContractFactory("FastAdapter");
      await expect(
        upgrades.deployProxy(
          FastAdapter,
          [ethers.ZeroAddress, owner.address],
          { initializer: "initialize" },
        ),
      )
        .to.be.revertedWithCustomError(FastAdapter, "ZeroAddressNotAllowed")
        .withArgs("prover");
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
          { initializer: "initialize" },
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

    describe("Data Request Registry", () => {
      it("Should allow owner to register and unregister data requests", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);
        const drId = ethers.id("test_dr_id");

        // Register
        await expect(
          fastAdapter.registerDataRequest(drId, {
            execProgramId: EXEC_PROGRAM_ID,
            tallyProgramId: TALLY_PROGRAM_ID,
          }),
        ).to.emit(fastAdapter, "DataRequestRegistered");

        expect(await fastAdapter.isDataRequestRegistered(drId)).to.be.true;

        // Unregister
        await expect(fastAdapter.unregisterDataRequest(drId)).to.emit(
          fastAdapter,
          "DataRequestUnregistered",
        );

        expect(await fastAdapter.isDataRequestRegistered(drId)).to.be.false;
      });

      it("Should revert when non-owner tries to register", async () => {
        const { fastAdapter, user } = await loadFixture(
          deployFastAdapterFixture,
        );
        await expect(
          fastAdapter.connect(user).registerDataRequest(ethers.id("test"), {
            execProgramId: EXEC_PROGRAM_ID,
            tallyProgramId: TALLY_PROGRAM_ID,
          }),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "OwnableUnauthorizedAccount",
        );
      });

      it("Should revert when unregistering non-existent drId", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);
        await expect(
          fastAdapter.unregisterDataRequest(ethers.id("nonexistent")),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert when registering with zero execProgramId", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);
        await expect(
          fastAdapter.registerDataRequest(ethers.id("test"), {
            execProgramId: ethers.ZeroHash,
            tallyProgramId: TALLY_PROGRAM_ID,
          }),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert when registering with zero tallyProgramId", async () => {
        const { fastAdapter } = await loadFixture(deployFastAdapterFixture);
        await expect(
          fastAdapter.registerDataRequest(ethers.id("test"), {
            execProgramId: EXEC_PROGRAM_ID,
            tallyProgramId: ethers.ZeroHash,
          }),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
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

  describe("Core Price Feed Operations", () => {
    let fastAdapter: FastAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let btcDrId: string;
    let btcRawId: string;
    let btcAssetId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFastAdapterFixture);
      fastAdapter = fixture.fastAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      // Register BTC/USD feed
      btcDrId = ethers.id("btc_dr_id");
      btcRawId = ethers.id("BTC/USD");
      await registerDrId(fastAdapter, btcDrId);
      btcAssetId = computeAssetId(EXEC_PROGRAM_ID, TALLY_PROGRAM_ID, btcRawId);
    });

    describe("updatePriceFeeds", () => {
      it("Should update price feeds with valid data", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcRawId,
          50000n,
          100n,
        );

        await expect(fastAdapter.updatePriceFeeds([updateData])).to.emit(
          fastAdapter,
          "PriceFeedUpdate",
        );

        const price = await fastAdapter.getPriceUnsafe(btcAssetId);
        expect(price.price).to.equal(50000n);
        expect(price.conf).to.equal(100n);
      });

      it("Should handle multiple updates in batch", async () => {
        // Register ETH feed
        const ethDrId = ethers.id("eth_dr_id");
        const ethRawId = ethers.id("ETH/USD");
        await registerDrId(fastAdapter, ethDrId);
        const ethAssetId = computeAssetId(EXEC_PROGRAM_ID, TALLY_PROGRAM_ID, ethRawId);

        const btcData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n);
        const ethData = await createValidUpdateData(trustedKey, ethDrId, ethRawId, 3000n, 50n);

        await fastAdapter.updatePriceFeeds([btcData, ethData]);

        const btcPrice = await fastAdapter.getPriceUnsafe(btcAssetId);
        const ethPrice = await fastAdapter.getPriceUnsafe(ethAssetId);

        expect(btcPrice.price).to.equal(50000n);
        expect(ethPrice.price).to.equal(3000n);
      });

      it("Should update existing price with newer timestamp", async () => {
        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 50000n, 100n);

        const assetIds = await fastAdapter.getAssetIds();
        const assetId = assetIds[0];
        const initialPriceInfo = await fastAdapter.getPriceInfo(assetId);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 51000n, 120n);

        const updatedPriceInfo = await fastAdapter.getPriceInfo(assetId);
        expect(updatedPriceInfo.price).to.equal(51000n);
        expect(updatedPriceInfo.publishTime).to.be.greaterThan(
          initialPriceInfo.publishTime,
        );
      });

      it("Should revert when paused", async () => {
        await fastAdapter.pause();
        const updateData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n);

        await expect(
          fastAdapter.updatePriceFeeds([updateData]),
        ).to.be.revertedWithCustomError(fastAdapter, "EnforcedPause");
      });

      it("Should revert with invalid exit code", async () => {
        const invalidPayload = await createInvalidExitCodePayload(trustedKey, btcDrId, btcRawId);

        await expect(
          fastAdapter.updatePriceFeeds([invalidPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert with empty batch", async () => {
        const emptyPayload = await createEmptyBatchPayload(trustedKey, btcDrId);

        await expect(
          fastAdapter.updatePriceFeeds([emptyPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert with unregistered drId", async () => {
        const unregisteredDrId = ethers.id("unregistered_dr");
        const updateData = await createValidUpdateData(
          trustedKey,
          unregisteredDrId,
          btcRawId,
          50000n,
          100n,
        );

        await expect(
          fastAdapter.updatePriceFeeds([updateData]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should prevent replay: same result cannot update a different feed", async () => {
        const ethDrId = ethers.id("eth_dr_id");
        const ethRawId = ethers.id("ETH/USD");
        await registerDrId(fastAdapter, ethDrId);

        // Create an update for BTC
        const btcUpdate = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n);

        // The BTC update has drId=btcDrId, so it only updates BTC feed
        await fastAdapter.updatePriceFeeds([btcUpdate]);

        // ETH feed should not be updated
        const ethAssetId = computeAssetId(EXEC_PROGRAM_ID, TALLY_PROGRAM_ID, ethRawId);
        await expect(
          fastAdapter.getPriceUnsafe(ethAssetId),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");
      });
    });

    describe("updatePriceFeedsIfNecessary", () => {
      it("Should update when publish time is newer", async () => {
        const oldTime = createPastTimestamp(3600);
        const newTime = Math.floor(Date.now() / 1000);

        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 40000n, 100n, oldTime);

        const updateData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n, newTime);

        await fastAdapter.updatePriceFeedsIfNecessary(
          [updateData],
          [btcAssetId],
          [newTime],
        );

        const price = await fastAdapter.getPriceUnsafe(btcAssetId);
        expect(price.price).to.equal(50000n);
      });

      it("Should not update when publish time is older", async () => {
        const oldTime = createPastTimestamp(3600);
        const newerTime = Math.floor(Date.now() / 1000);

        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 50000n, 100n, newerTime);

        const updateData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 40000n, 100n, oldTime);

        await expect(
          fastAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [btcAssetId],
            [oldTime],
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "NoFreshUpdate");
      });
    });

    describe("parsePriceFeedUpdates*", () => {
      it("Should parse price feed updates", async () => {
        const pastTime = createPastTimestamp(1800);
        const updateData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n, pastTime);

        const priceFeeds = await fastAdapter.parsePriceFeedUpdates.staticCall(
          [updateData],
          [btcAssetId],
          0,
          Math.floor(Date.now() / 1000) + 3600,
        );

        expect(priceFeeds.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(btcAssetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
      });

      it("Should parse with configuration and store updates", async () => {
        const updateData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n);

        const [priceFeeds, slots] =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [btcAssetId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            true,
          );

        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].id).to.equal(btcAssetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
        expect(slots).to.have.length(1);
        expect(slots[0]).to.equal(0);
      });

      it("Should revert when paused and trying to store", async () => {
        await fastAdapter.pause();
        const updateData = await createValidUpdateData(trustedKey, btcDrId, btcRawId, 50000n, 100n);

        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig(
            [updateData],
            [btcAssetId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            true,
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "EnforcedPause");
      });
    });
  });

  describe("IPyth Interface Compliance", () => {
    let fastAdapter: FastAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let btcDrId: string;
    let btcRawId: string;
    let btcAssetId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFastAdapterFixture);
      fastAdapter = fixture.fastAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      btcDrId = ethers.id("btc_dr_id");
      btcRawId = ethers.id("BTC/USD");
      await registerDrId(fastAdapter, btcDrId);
      btcAssetId = computeAssetId(EXEC_PROGRAM_ID, TALLY_PROGRAM_ID, btcRawId);
    });

    describe("Price Retrieval Functions", () => {
      it("Should return prices for existing assets and revert for non-existent ones", async () => {
        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 50000n, 100n);

        const price = await fastAdapter.getPriceUnsafe(btcAssetId);
        expect(price.price).to.equal(50000n);
        expect(price.conf).to.equal(100n);
        expect(price.expo).to.equal(-8);
        expect(price.publishTime).to.be.greaterThan(0);

        const emaPrice = await fastAdapter.getEmaPriceUnsafe(btcAssetId);
        expect(emaPrice.price).to.equal(50000n);
        expect(emaPrice.conf).to.equal(100n);

        const nonExistentId = ethers.id("non_existent");
        await expect(
          fastAdapter.getPriceUnsafe(nonExistentId),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");
      });
    });

    describe("Age-Limited Price Functions", () => {
      it("Should return prices within age limits", async () => {
        const pastTime = createPastTimestamp(10);
        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 50000n, 100n, pastTime);

        const price = await fastAdapter.getPriceNoOlderThan(btcAssetId, 86400);
        expect(price.price).to.equal(50000n);
      });

      it("Should revert for stale prices", async () => {
        const oldTime = createPastTimestamp(3700);
        await submitPriceUpdate(fastAdapter, trustedKey, btcDrId, btcRawId, 50000n, 100n, oldTime);

        await expect(fastAdapter.getPriceNoOlderThan(btcAssetId, 3600))
          .to.be.revertedWithCustomError(fastAdapter, "StalePrice");
      });
    });

    describe("Fee and TWAP Functions", () => {
      it("Should return zero fee", async () => {
        const fee = await fastAdapter.getUpdateFee([ethers.toUtf8Bytes("test")]);
        expect(fee).to.equal(0);
      });

      it("Should revert TWAP functions with NotImplemented", async () => {
        await expect(
          fastAdapter.getTwapUpdateFee([ethers.toUtf8Bytes("test")]),
        ).to.be.revertedWithCustomError(fastAdapter, "TwapNotImplemented");
      });
    });
  });

  describe("Security", () => {
    it("Should reject ETH sent to update functions", async () => {
      const { fastAdapter, fastProver } = await loadFixture(deployFastAdapterFixture);
      const trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      const drId = ethers.id("btc_dr_id");
      const rawId = ethers.id("BTC/USD");
      await registerDrId(fastAdapter, drId);
      const assetId = computeAssetId(EXEC_PROGRAM_ID, TALLY_PROGRAM_ID, rawId);

      const updateData = await createValidUpdateData(trustedKey, drId, rawId, 50000n, 100n);

      await expect(
        fastAdapter.updatePriceFeeds([updateData], { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");
    });

    it("Should upgrade and preserve state", async () => {
      const { fastAdapter } = await loadFixture(deployFastAdapterFixture);
      const initialProver = await fastAdapter.getProver();

      const FastAdapterV2 = await ethers.getContractFactory("FastAdapter");
      const upgradedContract = await upgrades.upgradeProxy(fastAdapter, FastAdapterV2);

      expect(await upgradedContract.getProver()).to.equal(initialProver);
    });

    it("Should revert when trying to reinitialize", async () => {
      const { fastAdapter, owner } = await loadFixture(deployFastAdapterFixture);

      await expect(
        fastAdapter.initialize(await fastAdapter.getProver(), await owner.getAddress()),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidInitialization");
    });
  });

  describe("Edge Cases & Utilities", () => {
    it("Should return empty asset IDs initially", async () => {
      const { fastAdapter } = await loadFixture(deployFastAdapterFixture);
      const assetIds = await fastAdapter.getAssetIds();
      expect(assetIds.length).to.equal(0);
    });
  });
});
