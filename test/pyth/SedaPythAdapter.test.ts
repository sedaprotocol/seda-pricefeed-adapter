import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import type { Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import type { FastProver } from "../../typechain-types/contracts/prover/FastProver";
import type { SedaPythAdapter } from "../../typechain-types/contracts/SedaPythAdapter";
import {
  computeFeedId,
  createEmptyUpdatesPayload,
  createInvalidExitCodePayload,
  createPastTimestamp,
  createTrustedKey,
  createValidUpdateData,
  submitPriceUpdate,
} from "../helpers";

describe("SedaPythAdapter", () => {
  // Fixture function
  async function deploySedaPythAdapterFixture() {
    const [owner, user] = await ethers.getSigners();

    const FastProver = await ethers.getContractFactory("FastProver");
    const fastProver = (await upgrades.deployProxy(
      FastProver,
      [owner.address],
      { initializer: "initialize" },
    )) as unknown as FastProver;

    const SedaPythAdapter = await ethers.getContractFactory("SedaPythAdapter");
    const sedaPythAdapter = await upgrades.deployProxy(
      SedaPythAdapter,
      [await fastProver.getAddress(), owner.address],
      { initializer: "initialize" },
    );

    return { sedaPythAdapter, fastProver, owner, user };
  }

  describe("Initialization", () => {
    it("Should initialize with correct parameters", async () => {
      const { sedaPythAdapter, fastProver, owner } = await loadFixture(
        deploySedaPythAdapterFixture,
      );

      expect(await sedaPythAdapter.owner()).to.equal(owner.address);
      expect(await sedaPythAdapter.getProver()).to.equal(
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

      const SedaPythAdapter =
        await ethers.getContractFactory("SedaPythAdapter");
      await expect(
        upgrades.deployProxy(
          SedaPythAdapter,
          [await fastProver.getAddress(), ethers.ZeroAddress],
          { initializer: "initialize" },
        ),
      )
        .to.be.revertedWithCustomError(SedaPythAdapter, "ZeroAddressNotAllowed")
        .withArgs("owner");
    });

    it("Should not initialize with zero prover address", async () => {
      const [owner] = await ethers.getSigners();
      const SedaPythAdapter =
        await ethers.getContractFactory("SedaPythAdapter");
      await expect(
        upgrades.deployProxy(
          SedaPythAdapter,
          [ethers.ZeroAddress, owner.address],
          {
            initializer: "initialize",
          },
        ),
      )
        .to.be.revertedWithCustomError(SedaPythAdapter, "ZeroAddressNotAllowed")
        .withArgs("prover");
    });
  });

  describe("Access Control", () => {
    describe("Prover Management", () => {
      it("Should allow owner to update prover", async () => {
        const { sedaPythAdapter, fastProver } = await loadFixture(
          deploySedaPythAdapterFixture,
        );

        const [newOwner] = await ethers.getSigners();
        const NewFastProver = await ethers.getContractFactory("FastProver");
        const newFastProver = await upgrades.deployProxy(
          NewFastProver,
          [newOwner.address],
          { initializer: "initialize" },
        );

        await expect(
          sedaPythAdapter.updateProver(await newFastProver.getAddress()),
        )
          .to.emit(sedaPythAdapter, "ProverUpdated")
          .withArgs(
            await fastProver.getAddress(),
            await newFastProver.getAddress(),
          );

        expect(await sedaPythAdapter.getProver()).to.equal(
          await newFastProver.getAddress(),
        );
      });

      it("Should revert when non-owner tries to update prover", async () => {
        const { sedaPythAdapter, user } = await loadFixture(
          deploySedaPythAdapterFixture,
        );
        await expect(
          sedaPythAdapter.connect(user).updateProver(user.address),
        ).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "OwnableUnauthorizedAccount",
        );
      });

      it("Should revert when updating prover to zero address", async () => {
        const { sedaPythAdapter } = await loadFixture(
          deploySedaPythAdapterFixture,
        );
        await expect(
          sedaPythAdapter.updateProver(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "ZeroAddressNotAllowed",
        );
      });
    });

    describe("Pausable Functions", () => {
      it("Should allow owner to pause/unpause", async () => {
        const { sedaPythAdapter, owner } = await loadFixture(
          deploySedaPythAdapterFixture,
        );

        await expect(sedaPythAdapter.pause())
          .to.emit(sedaPythAdapter, "Paused")
          .withArgs(owner.address);

        await expect(sedaPythAdapter.unpause())
          .to.emit(sedaPythAdapter, "Unpaused")
          .withArgs(owner.address);
      });

      it("Should revert when non-owner tries to pause", async () => {
        const { sedaPythAdapter, user } = await loadFixture(
          deploySedaPythAdapterFixture,
        );
        await expect(
          sedaPythAdapter.connect(user).pause(),
        ).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "OwnableUnauthorizedAccount",
        );
      });
    });
  });

  describe("Core Price Feed Operations", () => {
    let sedaPythAdapter: SedaPythAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let btcDrId: string;
    let btcSymbolId: string;
    let btcFeedId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deploySedaPythAdapterFixture);
      sedaPythAdapter = fixture.sedaPythAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      btcDrId = ethers.id("btc_dr_id");
      btcSymbolId = ethers.id("BTC/USD");
      btcFeedId = computeFeedId(btcDrId, btcSymbolId);
    });

    describe("updatePriceFeeds", () => {
      it("Should update price feeds with valid data", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        await expect(sedaPythAdapter.updatePriceFeeds([updateData])).to.emit(
          sedaPythAdapter,
          "PriceFeedUpdate",
        );

        const price = await sedaPythAdapter.getPriceUnsafe(btcFeedId);
        expect(price.price).to.equal(50000n);
        expect(price.conf).to.equal(100n);
      });

      it("Should handle multiple updates in batch", async () => {
        const ethDrId = ethers.id("eth_dr_id");
        const ethSymbolId = ethers.id("ETH/USD");
        const ethFeedId = computeFeedId(ethDrId, ethSymbolId);

        const btcData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );
        const ethData = await createValidUpdateData(
          trustedKey,
          ethDrId,
          ethSymbolId,
          3000n,
          50n,
        );

        await sedaPythAdapter.updatePriceFeeds([btcData, ethData]);

        const btcPrice = await sedaPythAdapter.getPriceUnsafe(btcFeedId);
        const ethPrice = await sedaPythAdapter.getPriceUnsafe(ethFeedId);

        expect(btcPrice.price).to.equal(50000n);
        expect(ethPrice.price).to.equal(3000n);
      });

      it("Should update existing price with newer timestamp", async () => {
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        const feedIds = await sedaPythAdapter.getFeedIds();
        const feedId = feedIds[0];
        const initialPriceInfo = await sedaPythAdapter.getPriceInfo(feedId);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          51000n,
          120n,
        );

        const updatedPriceInfo = await sedaPythAdapter.getPriceInfo(feedId);
        expect(updatedPriceInfo.price).to.equal(51000n);
        expect(updatedPriceInfo.publishTime).to.be.greaterThan(
          initialPriceInfo.publishTime,
        );
      });

      it("Should revert when paused", async () => {
        await sedaPythAdapter.pause();
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        await expect(
          sedaPythAdapter.updatePriceFeeds([updateData]),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "EnforcedPause");
      });

      it("Should revert with invalid exit code", async () => {
        const invalidPayload = await createInvalidExitCodePayload(
          trustedKey,
          btcDrId,
          btcSymbolId,
        );

        await expect(
          sedaPythAdapter.updatePriceFeeds([invalidPayload]),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidResult");
      });

      it("Should revert with empty updates", async () => {
        const emptyPayload = await createEmptyUpdatesPayload(
          trustedKey,
          btcDrId,
        );

        await expect(
          sedaPythAdapter.updatePriceFeeds([emptyPayload]),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidResult");
      });

      it("Should prevent replay: same result cannot update a different feed", async () => {
        const ethSymbolId = ethers.id("ETH/USD");

        const btcUpdate = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        await sedaPythAdapter.updatePriceFeeds([btcUpdate]);

        // A feedId derived from a different drId has no stored price.
        const ethFeedId = computeFeedId(ethers.id("eth_dr_id"), ethSymbolId);
        await expect(
          sedaPythAdapter.getPriceUnsafe(ethFeedId),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "PriceFeedNotFound");
      });
    });

    describe("updatePriceFeedsIfNecessary", () => {
      it("Should update when publish time is newer", async () => {
        const oldTime = createPastTimestamp(3600);
        const newTime = Math.floor(Date.now() / 1000);

        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          40000n,
          100n,
          oldTime,
        );

        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          newTime,
        );

        await sedaPythAdapter.updatePriceFeedsIfNecessary(
          [updateData],
          [btcFeedId],
          [newTime],
        );

        const price = await sedaPythAdapter.getPriceUnsafe(btcFeedId);
        expect(price.price).to.equal(50000n);
      });

      it("Should not update when publish time is older", async () => {
        const oldTime = createPastTimestamp(3600);
        const newerTime = Math.floor(Date.now() / 1000);

        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          newerTime,
        );

        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          40000n,
          100n,
          oldTime,
        );

        await expect(
          sedaPythAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [btcFeedId],
            [oldTime],
          ),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "NoFreshUpdate");
      });
    });

    describe("parsePriceFeedUpdates*", () => {
      it("Should parse price feed updates", async () => {
        const pastTime = createPastTimestamp(1800);
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          pastTime,
        );

        const priceFeeds =
          await sedaPythAdapter.parsePriceFeedUpdates.staticCall(
            [updateData],
            [btcFeedId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
          );

        expect(priceFeeds.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(btcFeedId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
      });

      it("Should parse with configuration and store updates", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        const [priceFeeds, slots] =
          await sedaPythAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [btcFeedId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            true,
          );

        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].id).to.equal(btcFeedId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
        expect(slots).to.have.length(1);
        expect(slots[0]).to.equal(0);
      });

      it("Should revert when paused and trying to store", async () => {
        await sedaPythAdapter.pause();
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        await expect(
          sedaPythAdapter.parsePriceFeedUpdatesWithConfig(
            [updateData],
            [btcFeedId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            true,
          ),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "EnforcedPause");
      });
    });
  });

  describe("IPyth Interface Compliance", () => {
    let sedaPythAdapter: SedaPythAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let btcDrId: string;
    let btcSymbolId: string;
    let btcFeedId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deploySedaPythAdapterFixture);
      sedaPythAdapter = fixture.sedaPythAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      btcDrId = ethers.id("btc_dr_id");
      btcSymbolId = ethers.id("BTC/USD");
      btcFeedId = computeFeedId(btcDrId, btcSymbolId);
    });

    describe("Price Retrieval Functions", () => {
      it("Should return prices for existing assets and revert for non-existent ones", async () => {
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );

        const price = await sedaPythAdapter.getPriceUnsafe(btcFeedId);
        expect(price.price).to.equal(50000n);
        expect(price.conf).to.equal(100n);
        expect(price.expo).to.equal(-8);
        expect(price.publishTime).to.be.greaterThan(0);

        const emaPrice = await sedaPythAdapter.getEmaPriceUnsafe(btcFeedId);
        expect(emaPrice.price).to.equal(50000n);
        expect(emaPrice.conf).to.equal(100n);

        const nonExistentId = ethers.id("non_existent");
        await expect(
          sedaPythAdapter.getPriceUnsafe(nonExistentId),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "PriceFeedNotFound");
      });
    });

    describe("Age-Limited Price Functions", () => {
      it("Should return prices within age limits", async () => {
        const pastTime = createPastTimestamp(10);
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          pastTime,
        );

        const price = await sedaPythAdapter.getPriceNoOlderThan(
          btcFeedId,
          86400,
        );
        expect(price.price).to.equal(50000n);
      });

      it("Should revert for stale prices", async () => {
        const oldTime = createPastTimestamp(3700);
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          oldTime,
        );

        await expect(
          sedaPythAdapter.getPriceNoOlderThan(btcFeedId, 3600),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "StalePrice");
      });
    });

    describe("Fee and TWAP Functions", () => {
      it("Should return zero fee", async () => {
        const fee = await sedaPythAdapter.getUpdateFee([
          ethers.toUtf8Bytes("test"),
        ]);
        expect(fee).to.equal(0);
      });

      it("Should revert TWAP functions with NotImplemented", async () => {
        await expect(
          sedaPythAdapter.getTwapUpdateFee([ethers.toUtf8Bytes("test")]),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "TwapNotImplemented");
      });
    });
  });

  describe("Security", () => {
    it("Should reject ETH sent to update functions", async () => {
      const { sedaPythAdapter, fastProver } = await loadFixture(
        deploySedaPythAdapterFixture,
      );
      const trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      const drId = ethers.id("btc_dr_id");
      const symbolId = ethers.id("BTC/USD");

      const updateData = await createValidUpdateData(
        trustedKey,
        drId,
        symbolId,
        50000n,
        100n,
      );

      await expect(
        sedaPythAdapter.updatePriceFeeds([updateData], {
          value: ethers.parseEther("1"),
        }),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");
    });

    it("Should upgrade and preserve state", async () => {
      const { sedaPythAdapter } = await loadFixture(
        deploySedaPythAdapterFixture,
      );
      const initialProver = await sedaPythAdapter.getProver();

      const SedaPythAdapterV2 =
        await ethers.getContractFactory("SedaPythAdapter");
      const upgradedContract = await upgrades.upgradeProxy(
        sedaPythAdapter,
        SedaPythAdapterV2,
      );

      expect(await upgradedContract.getProver()).to.equal(initialProver);
    });

    it("Should revert when trying to reinitialize", async () => {
      const { sedaPythAdapter, owner } = await loadFixture(
        deploySedaPythAdapterFixture,
      );

      await expect(
        sedaPythAdapter.initialize(
          await sedaPythAdapter.getProver(),
          await owner.getAddress(),
        ),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidInitialization");
    });
  });

  describe("Edge Cases & Utilities", () => {
    it("Should return empty feed IDs initially", async () => {
      const { sedaPythAdapter } = await loadFixture(
        deploySedaPythAdapterFixture,
      );
      const feedIds = await sedaPythAdapter.getFeedIds();
      expect(feedIds.length).to.equal(0);
    });
  });
});
