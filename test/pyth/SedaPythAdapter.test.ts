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
  createNonConsensusPayload,
  createPastTimestamp,
  createTrustedKey,
  createValidUpdateData,
  createValidUpdateDataMulti,
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

      it("Should revert when calling updateProver directly on the implementation", async () => {
        const { sedaPythAdapter } = await loadFixture(
          deploySedaPythAdapterFixture,
        );
        const implAddress = await upgrades.erc1967.getImplementationAddress(
          await sedaPythAdapter.getAddress(),
        );
        const impl = await ethers.getContractAt("SedaPythAdapter", implAddress);
        await expect(
          impl.updateProver(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(impl, "UUPSUnauthorizedCallContext");
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

      it("Should revert when pausing an already paused contract", async () => {
        const { sedaPythAdapter } = await loadFixture(
          deploySedaPythAdapterFixture,
        );
        await sedaPythAdapter.pause();
        await expect(sedaPythAdapter.pause()).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "EnforcedPause",
        );
      });

      it("Should revert when unpausing while not paused", async () => {
        const { sedaPythAdapter } = await loadFixture(
          deploySedaPythAdapterFixture,
        );
        await expect(sedaPythAdapter.unpause()).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "ExpectedPause",
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
        const olderTime = createPastTimestamp(100);
        const newerTime = createPastTimestamp(10);

        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          olderTime,
        );
        const initialPriceInfo = await sedaPythAdapter.getPriceInfo(btcFeedId);

        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          51000n,
          120n,
          newerTime,
        );

        const updatedPriceInfo = await sedaPythAdapter.getPriceInfo(btcFeedId);
        expect(updatedPriceInfo.price).to.equal(51000n);
        expect(updatedPriceInfo.publishTime).to.be.greaterThan(
          initialPriceInfo.publishTime,
        );
      });

      it("Should silently ignore stale price in updatePriceFeeds", async () => {
        const initialTime = createPastTimestamp(10);
        const oldTime = createPastTimestamp(3600);

        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          initialTime,
        );

        const staleData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          40000n,
          100n,
          oldTime,
        );

        // updatePriceFeeds silently ignores stale updates without reverting
        await sedaPythAdapter.updatePriceFeeds([staleData]);

        const price = await sedaPythAdapter.getPriceUnsafe(btcFeedId);
        expect(price.price).to.equal(50000n);
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

        await expect(sedaPythAdapter.updatePriceFeeds([invalidPayload]))
          .to.be.revertedWithCustomError(sedaPythAdapter, "InvalidResult")
          .withArgs("Oracle execution failed");
      });

      it("Should revert when oracle result is not in consensus", async () => {
        const payload = await createNonConsensusPayload(
          trustedKey,
          btcDrId,
          btcSymbolId,
        );

        await expect(sedaPythAdapter.updatePriceFeeds([payload]))
          .to.be.revertedWithCustomError(sedaPythAdapter, "InvalidResult")
          .withArgs("Oracle result not in consensus");
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

      it("Should revert when priceIds and publishTimes lengths mismatch", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );
        await expect(
          sedaPythAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [btcFeedId],
            [],
          ),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");
      });

      it("Should run when a later feed needs refresh even if an earlier one does not", async () => {
        const ethDrId = ethers.id("eth_dr_branch");
        const ethSymbolId = ethers.id("ETH/USD");
        const ethFeedId = computeFeedId(ethDrId, ethSymbolId);

        const tBtcStored = 1_700_000_000;
        const tEthStored = 1_700_000_050;
        const tEthNew = 1_700_000_200;

        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          tBtcStored,
        );
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          ethDrId,
          ethSymbolId,
          3000n,
          50n,
          tEthStored,
        );

        const ethUpdate = await createValidUpdateData(
          trustedKey,
          ethDrId,
          ethSymbolId,
          3100n,
          50n,
          tEthNew,
        );

        await sedaPythAdapter.updatePriceFeedsIfNecessary(
          [ethUpdate],
          [btcFeedId, ethFeedId],
          [tBtcStored - 10_000, tEthNew],
        );

        const ethPrice = await sedaPythAdapter.getPriceUnsafe(ethFeedId);
        expect(ethPrice.price).to.equal(3100n);
      });

      it("Should revert when paused", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );
        await sedaPythAdapter.pause();
        await expect(
          sedaPythAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [btcFeedId],
            [Math.floor(Date.now() / 1000) + 60],
          ),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "EnforcedPause");
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

      it("Should ignore extra symbols in blob when parsing a subset of feeds", async () => {
        const ethSymbolId = ethers.id("ETH/USD");
        const ethFeedId = computeFeedId(btcDrId, ethSymbolId);
        const tBtc = createPastTimestamp(200);
        const tEth = createPastTimestamp(150);
        const maxT = Math.floor(Date.now() / 1000) + 3600;

        const updateData = await createValidUpdateDataMulti(
          trustedKey,
          btcDrId,
          [
            {
              symbolId: btcSymbolId,
              price: 50000n,
              conf: 100n,
              publishTime: tBtc,
            },
            {
              symbolId: ethSymbolId,
              price: 3000n,
              conf: 50n,
              publishTime: tEth,
            },
          ],
        );

        const priceFeeds =
          await sedaPythAdapter.parsePriceFeedUpdates.staticCall(
            [updateData],
            [btcFeedId],
            0,
            maxT,
          );

        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].id).to.equal(btcFeedId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
        await expect(
          sedaPythAdapter.getPriceUnsafe(ethFeedId),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "PriceFeedNotFound");
      });

      it("Should revert on strict minimality when blob decodes more updates than requested ids", async () => {
        const ethSymbolId = ethers.id("ETH/USD");
        const tBtc = createPastTimestamp(200);
        const tEth = createPastTimestamp(150);
        const maxT = Math.floor(Date.now() / 1000) + 3600;

        const updateData = await createValidUpdateDataMulti(
          trustedKey,
          btcDrId,
          [
            {
              symbolId: btcSymbolId,
              price: 50000n,
              conf: 100n,
              publishTime: tBtc,
            },
            {
              symbolId: ethSymbolId,
              price: 3000n,
              conf: 50n,
              publishTime: tEth,
            },
          ],
        );

        await expect(
          sedaPythAdapter.parsePriceFeedUpdatesWithConfig(
            [updateData],
            [btcFeedId],
            0,
            maxT,
            false,
            true,
            false,
          ),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");
      });

      it("Should parsePriceFeedUpdatesUnique and keep earliest publish time in window", async () => {
        const tEarly = createPastTimestamp(400);
        const tLate = createPastTimestamp(100);
        const maxT = Math.floor(Date.now() / 1000) + 3600;

        const updateData = await createValidUpdateDataMulti(
          trustedKey,
          btcDrId,
          [
            {
              symbolId: btcSymbolId,
              price: 99999n,
              conf: 1n,
              publishTime: tLate,
            },
            {
              symbolId: btcSymbolId,
              price: 50000n,
              conf: 100n,
              publishTime: tEarly,
            },
          ],
        );

        const priceFeeds =
          await sedaPythAdapter.parsePriceFeedUpdatesUnique.staticCall(
            [updateData],
            [btcFeedId],
            0,
            maxT,
          );

        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].price.price).to.equal(50000n);
        expect(priceFeeds[0].price.publishTime).to.equal(BigInt(tEarly));
      });

      it("Should keep first row when two updates share the same publish time", async () => {
        const t = createPastTimestamp(120);
        const maxT = Math.floor(Date.now() / 1000) + 3600;
        const updateData = await createValidUpdateDataMulti(
          trustedKey,
          btcDrId,
          [
            {
              symbolId: btcSymbolId,
              price: 11111n,
              conf: 1n,
              publishTime: t,
            },
            {
              symbolId: btcSymbolId,
              price: 22222n,
              conf: 2n,
              publishTime: t,
            },
          ],
        );

        const unique =
          await sedaPythAdapter.parsePriceFeedUpdatesUnique.staticCall(
            [updateData],
            [btcFeedId],
            0,
            maxT,
          );
        expect(unique[0].price.price).to.equal(11111n);

        const plain = await sedaPythAdapter.parsePriceFeedUpdates.staticCall(
          [updateData],
          [btcFeedId],
          0,
          maxT,
        );
        expect(plain[0].price.price).to.equal(11111n);
      });

      it("Should revert parse when publish time is outside min/max window", async () => {
        const pub = createPastTimestamp(800);
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          pub,
        );
        const now = Math.floor(Date.now() / 1000);

        await expect(
          sedaPythAdapter.parsePriceFeedUpdates.staticCall(
            [updateData],
            [btcFeedId],
            pub + 60,
            now + 3600,
          ),
        ).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "PriceFeedNotFoundWithinRange",
        );

        await expect(
          sedaPythAdapter.parsePriceFeedUpdates.staticCall(
            [updateData],
            [btcFeedId],
            0,
            pub - 60,
          ),
        ).to.be.revertedWithCustomError(
          sedaPythAdapter,
          "PriceFeedNotFoundWithinRange",
        );
      });

      it("Should succeed with strict minimality when decoded count matches requested ids", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
        );
        const maxT = Math.floor(Date.now() / 1000) + 3600;

        const [priceFeeds] =
          await sedaPythAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [btcFeedId],
            0,
            maxT,
            false,
            true,
            false,
          );
        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].id).to.equal(btcFeedId);
      });

      it("Should not downgrade storage when a second row in the same blob is older", async () => {
        const tHi = createPastTimestamp(50);
        const tLo = createPastTimestamp(200);
        const maxT = Math.floor(Date.now() / 1000) + 3600;

        const updateData = await createValidUpdateDataMulti(
          trustedKey,
          btcDrId,
          [
            {
              symbolId: btcSymbolId,
              price: 51000n,
              conf: 100n,
              publishTime: tHi,
            },
            {
              symbolId: btcSymbolId,
              price: 40000n,
              conf: 100n,
              publishTime: tLo,
            },
          ],
        );

        await sedaPythAdapter.parsePriceFeedUpdatesWithConfig(
          [updateData],
          [btcFeedId],
          0,
          maxT,
          false,
          false,
          true,
        );

        const info = await sedaPythAdapter.getPriceInfo(btcFeedId);
        expect(info.publishTime).to.equal(BigInt(tHi));
        expect(info.price).to.equal(51000n);
      });

      it("Should keep later price when uniqueness is off and rows are chronological", async () => {
        const tFirst = createPastTimestamp(300);
        const tSecond = createPastTimestamp(100);
        const maxT = Math.floor(Date.now() / 1000) + 3600;

        const updateData = await createValidUpdateDataMulti(
          trustedKey,
          btcDrId,
          [
            {
              symbolId: btcSymbolId,
              price: 40000n,
              conf: 10n,
              publishTime: tFirst,
            },
            {
              symbolId: btcSymbolId,
              price: 50000n,
              conf: 100n,
              publishTime: tSecond,
            },
          ],
        );

        const priceFeeds =
          await sedaPythAdapter.parsePriceFeedUpdates.staticCall(
            [updateData],
            [btcFeedId],
            0,
            maxT,
          );

        expect(priceFeeds[0].price.price).to.equal(50000n);
        expect(priceFeeds[0].price.publishTime).to.equal(BigInt(tSecond));
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

      it("Should return EMA prices within age limits", async () => {
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

        const ema = await sedaPythAdapter.getEmaPriceNoOlderThan(
          btcFeedId,
          86400,
        );
        expect(ema.price).to.equal(50000n);
        expect(ema.conf).to.equal(100n);
      });

      it("Should revert age-limited getters when publish time is ahead of chain time", async () => {
        const futureTs = Math.floor(Date.now() / 1000) + 500_000;
        await submitPriceUpdate(
          sedaPythAdapter,
          trustedKey,
          btcDrId,
          btcSymbolId,
          50000n,
          100n,
          futureTs,
        );

        await expect(
          sedaPythAdapter.getPriceNoOlderThan(btcFeedId, 86400),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "StalePrice");

        await expect(
          sedaPythAdapter.getEmaPriceNoOlderThan(btcFeedId, 86400),
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

        await expect(
          sedaPythAdapter.parseTwapPriceFeedUpdates(
            [ethers.toUtf8Bytes("a")],
            [btcFeedId],
          ),
        ).to.be.revertedWithCustomError(sedaPythAdapter, "TwapNotImplemented");
      });
    });
  });

  describe("Security", () => {
    it("Should reject ETH on payable IPyth and update entrypoints", async () => {
      const { sedaPythAdapter, fastProver } = await loadFixture(
        deploySedaPythAdapterFixture,
      );
      const trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);

      const drId = ethers.id("btc_dr_id");
      const symbolId = ethers.id("BTC/USD");
      const feedId = computeFeedId(drId, symbolId);
      const updateData = await createValidUpdateData(
        trustedKey,
        drId,
        symbolId,
        50000n,
        100n,
      );
      const maxT = Math.floor(Date.now() / 1000) + 3600;
      const pay = { value: 1n };

      await expect(
        sedaPythAdapter.updatePriceFeeds([updateData], pay),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");

      await expect(
        sedaPythAdapter.parsePriceFeedUpdates(
          [updateData],
          [feedId],
          0,
          maxT,
          pay,
        ),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");

      await expect(
        sedaPythAdapter.parsePriceFeedUpdatesUnique(
          [updateData],
          [feedId],
          0,
          maxT,
          pay,
        ),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");

      await expect(
        sedaPythAdapter.parsePriceFeedUpdatesWithConfig(
          [updateData],
          [feedId],
          0,
          maxT,
          false,
          false,
          false,
          pay,
        ),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");

      const claimT = Math.floor(Date.now() / 1000) + 120;
      await expect(
        sedaPythAdapter.updatePriceFeedsIfNecessary(
          [updateData],
          [feedId],
          [claimT],
          pay,
        ),
      ).to.be.revertedWithCustomError(sedaPythAdapter, "InvalidArgument");

      await expect(
        sedaPythAdapter.parseTwapPriceFeedUpdates(
          [ethers.toUtf8Bytes("a")],
          [feedId],
          pay,
        ),
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

    it("Should revert UUPS upgrade to zero implementation", async () => {
      const { sedaPythAdapter, owner } = await loadFixture(
        deploySedaPythAdapterFixture,
      );

      await expect(
        sedaPythAdapter
          .connect(owner)
          .upgradeToAndCall(ethers.ZeroAddress, "0x"),
      )
        .to.be.revertedWithCustomError(sedaPythAdapter, "ZeroAddressNotAllowed")
        .withArgs("implementation");
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
