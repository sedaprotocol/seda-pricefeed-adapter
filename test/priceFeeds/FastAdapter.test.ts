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

    it("Should not initialize with zero owner address", async () => {
      const [owner, _user] = await ethers.getSigners();

      // Deploy FastProver contract
      const FastProver = await ethers.getContractFactory("FastProver");

      const fastProver = (await upgrades.deployProxy(
        FastProver,
        [owner.address],
        {
          initializer: "initialize",
        },
      )) as unknown as FastProver;

      // Deploy FastAdapter with zero owner address
      const FastAdapter = await ethers.getContractFactory("FastAdapter");
      await expect(
        upgrades.deployProxy(
          FastAdapter,
          [await fastProver.getAddress(), ethers.ZeroAddress],
          {
            initializer: "initialize",
          },
        ),
      )
        .to.be.revertedWithCustomError(FastAdapter, "ZeroAddressNotAllowed")
        .withArgs("owner");
    });

    it("Should not initialize with zero prover address", async () => {
      const [owner, _user] = await ethers.getSigners();

      // Deploy FastAdapter with zero owner address
      const FastAdapter = await ethers.getContractFactory("FastAdapter");
      await expect(
        upgrades.deployProxy(
          FastAdapter,
          [await ethers.ZeroAddress, owner.address],
          {
            initializer: "initialize",
          },
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

  describe("Core Price Feed Operations", () => {
    let fastAdapter: FastAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let assetId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFastAdapterFixture);
      fastAdapter = fixture.fastAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);
      assetId = computeAssetId("BTC/USD");
    });

    describe("updatePriceFeeds", () => {
      it("Should update price feeds with valid data", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        await expect(fastAdapter.updatePriceFeeds([updateData])).to.emit(
          fastAdapter,
          "PriceFeedUpdate",
        );

        const price = await fastAdapter.getPriceUnsafe(assetId);
        expect(price.price).to.equal(50000n);
        expect(price.conf).to.equal(100n);
      });

      it("Should handle multiple updates in batch", async () => {
        const btcData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );
        const ethData = await createValidUpdateData(
          trustedKey,
          "ETH/USD",
          3000n,
          50n,
        );

        await fastAdapter.updatePriceFeeds([btcData, ethData]);

        const btcPrice = await fastAdapter.getPriceUnsafe(
          computeAssetId("BTC/USD"),
        );
        const ethPrice = await fastAdapter.getPriceUnsafe(
          computeAssetId("ETH/USD"),
        );

        expect(btcPrice.price).to.equal(50000n);
        expect(ethPrice.price).to.equal(3000n);
      });

      it("Should update existing price with newer timestamp", async () => {
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

      it("Should revert when paused", async () => {
        await fastAdapter.pause();
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        await expect(
          fastAdapter.updatePriceFeeds([updateData]),
        ).to.be.revertedWithCustomError(fastAdapter, "EnforcedPause");
      });

      it("Should revert with invalid signature", async () => {
        const invalidPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes data, bytes signature)"],
          [{ data: ethers.toUtf8Bytes("invalid"), signature: "0x1234" }],
        );

        await expect(fastAdapter.updatePriceFeeds([invalidPayload]))
          .to.be.revertedWithCustomError(
            fastProver,
            "ECDSAInvalidSignatureLength",
          )
          .withArgs(2);
      });

      it("Should revert with invalid exit code", async () => {
        const invalidPayload = await createInvalidExitCodePayload(trustedKey);

        await expect(
          fastAdapter.updatePriceFeeds([invalidPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });

      it("Should revert with empty batch", async () => {
        const emptyPayload = await createEmptyBatchPayload(trustedKey);

        await expect(
          fastAdapter.updatePriceFeeds([emptyPayload]),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidResult");
      });
    });

    describe("updatePriceFeedsIfNecessary", () => {
      it("Should update when publish time is newer", async () => {
        const oldTime = createPastTimestamp(3600); // 1 hour ago
        const newTime = Math.floor(Date.now() / 1000);

        // Submit old price first
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          40000n,
          100n,
          oldTime,
        );

        // Update with newer time
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          newTime,
        );

        await fastAdapter.updatePriceFeedsIfNecessary(
          [updateData],
          [assetId],
          [newTime],
        );

        const price = await fastAdapter.getPriceUnsafe(assetId);
        expect(price.price).to.equal(50000n);
      });

      it("Should not update when publish time is older", async () => {
        const oldTime = createPastTimestamp(3600);
        const newerTime = Math.floor(Date.now() / 1000);

        // Submit newer price first
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          newerTime,
        );

        // Try to update with older time
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          40000n,
          100n,
          oldTime,
        );

        await expect(
          fastAdapter.updatePriceFeedsIfNecessary(
            [updateData],
            [assetId],
            [oldTime],
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "NoFreshUpdate");
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

      it("Should revert when paused", async () => {
        const { fastAdapter, fastProver } = await loadFixture(
          deployFastAdapterFixture,
        );

        // Set up trusted key and asset
        const trustedKey = createTrustedKey();
        await fastProver.addTrustedKey(trustedKey.address);
        const assetId = computeAssetId("BTC/USD");

        // First, update with some initial data to establish a baseline
        const initialUpdateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );
        await fastAdapter.updatePriceFeeds([initialUpdateData]);

        // Pause the contract
        await fastAdapter.pause();

        // Create newer update data
        const newerUpdateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          51000n,
          100n,
        );

        // Try to call updatePriceFeedsIfNecessary when paused - should revert
        await expect(
          fastAdapter.updatePriceFeedsIfNecessary(
            [newerUpdateData],
            [assetId],
            [Math.floor(Date.now() / 1000) + 1], // Future timestamp to ensure update is needed
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "EnforcedPause");
      });
    });

    describe("parsePriceFeedUpdates*", () => {
      it("Should parse price feed updates", async () => {
        const pastTime = createPastTimestamp(1800); // 30 minutes ago
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        const priceFeeds = await fastAdapter.parsePriceFeedUpdates.staticCall(
          [updateData],
          [assetId],
          0,
          Math.floor(Date.now() / 1000) + 3600,
        );

        expect(priceFeeds.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(assetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
      });

      it("Should parse with configuration and store updates", async () => {
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        const [priceFeeds, slots] =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [assetId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            true, // storeUpdatesIfFresh
          );

        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].id).to.equal(assetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
        expect(slots).to.have.length(1);
        expect(slots[0]).to.equal(0); // SEDA doesn't use slots
      });

      it("Should revert when paused and trying to store", async () => {
        await fastAdapter.pause();
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );

        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig(
            [updateData],
            [assetId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            true, // Try to store when paused
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "EnforcedPause");
      });

      it("Should enforce strict minimality check", async () => {
        // Create updates for both BTC and ETH
        const btcUpdateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );
        const ethUpdateData = await createValidUpdateData(
          trustedKey,
          "ETH/USD",
          3000n,
          50n,
        );

        const ethAssetId = computeAssetId("ETH/USD");

        // Request 2 price IDs and provide 2 updates, but with extra data (should fail minimality check)
        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig(
            [btcUpdateData, ethUpdateData, btcUpdateData], // 3 updates for 2 requested IDs
            [assetId, ethAssetId], // Request 2 IDs
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            true, // checkUpdateDataIsMinimal = true
            false,
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");
      });

      it("Should handle uniqueness mode with different scenarios", async () => {
        const currentTime = Math.floor(Date.now() / 1000);
        const earlierTime = currentTime - 1800; // 30 minutes ago
        const laterTime = currentTime - 900; // 15 minutes ago
        const sameTime = currentTime - 1800; // Same timestamp for both updates

        // Create updates with different timestamps for the same asset
        const earlierData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          40000n,
          100n,
          earlierTime,
        );
        const laterData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          laterTime,
        );
        const sameTimeData1 = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          40000n,
          100n,
          sameTime,
        );
        const sameTimeData2 = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          sameTime,
        );

        // Test 1: Uniqueness mode with storage updates - should prefer earlier timestamp
        const [priceFeeds1] =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [laterData, earlierData], // Later first, then earlier
            [assetId],
            0,
            currentTime + 3600,
            true, // checkUniqueness = true
            false,
            true, // updateStorage = true
          );

        expect(priceFeeds1).to.have.length(1);
        expect(priceFeeds1[0].id).to.equal(assetId);
        expect(priceFeeds1[0].price.price).to.equal(40000n); // Earlier timestamp wins

        // Test 2: Uniqueness mode when shouldReplace is false - first update should be kept
        const [priceFeeds2] =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [sameTimeData1, sameTimeData2], // First update should win
            [assetId],
            0,
            currentTime + 3600,
            true, // checkUniqueness = true
            false,
            false,
          );

        expect(priceFeeds2).to.have.length(1);
        expect(priceFeeds2[0].id).to.equal(assetId);
        expect(priceFeeds2[0].price.price).to.equal(40000n); // First update wins
      });

      it("Should parse price feed updates with uniqueness check", async () => {
        const pastTime = createPastTimestamp(1800);
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        const priceFeeds =
          await fastAdapter.parsePriceFeedUpdatesUnique.staticCall(
            [updateData],
            [assetId],
            0,
            Math.floor(Date.now() / 1000) + 3600,
          );

        expect(priceFeeds.length).to.equal(1);
        expect(priceFeeds[0].id).to.equal(assetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
      });

      it("Should handle price feed not found scenarios", async () => {
        const btcUpdateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );
        const ethAssetId = computeAssetId("ETH/USD");

        // Test 1: Request ETH but provide BTC update
        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [btcUpdateData],
            [ethAssetId], // Only request ETH, but update contains BTC
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            false,
          ),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "PriceFeedNotFoundWithinRange",
        );

        // Test 2: Request 3 IDs but only provide 2 updates
        const ethUpdateData = await createValidUpdateData(
          trustedKey,
          "ETH/USD",
          3000n,
          50n,
        );
        const solAssetId = computeAssetId("SOL/USD");

        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [btcUpdateData, ethUpdateData],
            [assetId, ethAssetId, solAssetId], // Request 3 IDs, but only 2 updates
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            false,
          ),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "PriceFeedNotFoundWithinRange",
        );
      });

      it("Should skip updates for non-requested price IDs", async () => {
        // Create a batch update that contains BTC, ETH, and SOL
        const btcUpdateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
        );
        const ethUpdateData = await createValidUpdateData(
          trustedKey,
          "ETH/USD",
          3000n,
          50n,
        );
        const solUpdateData = await createValidUpdateData(
          trustedKey,
          "SOL/USD",
          100n,
          10n,
        );

        const ethAssetId = computeAssetId("ETH/USD");

        // Only request BTC and ETH, but provide BTC, ETH, and SOL updates
        // This tests the _findPriceIdIndex return path for SOL
        const [priceFeeds] =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [btcUpdateData, ethUpdateData, solUpdateData], // 3 updates
            [assetId, ethAssetId], // Only request 2 IDs
            0,
            Math.floor(Date.now() / 1000) + 3600,
            false,
            false,
            false,
          );

        // Should return 2 price feeds (BTC and ETH), SOL should be skipped
        expect(priceFeeds).to.have.length(2);
        expect(priceFeeds[0].id).to.equal(assetId);
        expect(priceFeeds[1].id).to.equal(ethAssetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
        expect(priceFeeds[1].price.price).to.equal(3000n);
      });

      it("Should skip updates outside time window", async () => {
        const currentTime = Math.floor(Date.now() / 1000);
        const testTime = currentTime - 1800; // 30 minutes ago

        // Create a single update with fixed timestamp
        const updateData = await createValidUpdateData(
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          testTime,
        );

        // Test 1: priceInfo.publishTime < minPublishTime
        // Set minTime to be after our testTime
        const minTimeTooHigh = testTime + 100;
        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [assetId],
            minTimeTooHigh, // minTime > testTime
            currentTime + 3600,
            false,
            false,
            false,
          ),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "PriceFeedNotFoundWithinRange",
        );

        // Test 2: riceInfo.publishTime > maxPublishTime
        // Set maxTime to be before our testTime
        const maxTimeTooLow = testTime - 100;
        await expect(
          fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [assetId],
            0,
            maxTimeTooLow, // maxTime < testTime
            false,
            false,
            false,
          ),
        ).to.be.revertedWithCustomError(
          fastAdapter,
          "PriceFeedNotFoundWithinRange",
        );

        // Test 3: Valid time window - should work
        const [priceFeeds] =
          await fastAdapter.parsePriceFeedUpdatesWithConfig.staticCall(
            [updateData],
            [assetId],
            testTime - 100, // minTime < testTime
            testTime + 100, // maxTime > testTime
            false,
            false,
            false,
          );

        expect(priceFeeds).to.have.length(1);
        expect(priceFeeds[0].id).to.equal(assetId);
        expect(priceFeeds[0].price.price).to.equal(50000n);
      });
    });
  });

  describe("IPyth Interface Compliance", () => {
    let fastAdapter: FastAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let assetId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFastAdapterFixture);
      fastAdapter = fixture.fastAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);
      assetId = computeAssetId("BTC/USD");
    });

    describe("Price Retrieval Functions", () => {
      it("Should return prices for existing assets and revert for non-existent ones", async () => {
        // Test existing asset
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

        const emaPrice = await fastAdapter.getEmaPriceUnsafe(assetId);
        expect(emaPrice.price).to.equal(50000n);
        expect(emaPrice.conf).to.equal(100n);
        expect(emaPrice.expo).to.equal(-8);
        expect(emaPrice.publishTime).to.be.greaterThan(0);

        // Test non-existent asset
        const nonExistentId = ethers.id("non_existent");

        await expect(
          fastAdapter.getPriceUnsafe(nonExistentId),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");

        await expect(
          fastAdapter.getEmaPriceUnsafe(nonExistentId),
        ).to.be.revertedWithCustomError(fastAdapter, "PriceFeedNotFound");
      });
    });

    describe("Age-Limited Price Functions", () => {
      it("Should return prices within age limits", async () => {
        const pastTime = createPastTimestamp(10);
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          pastTime,
        );

        const price = await fastAdapter.getPriceNoOlderThan(assetId, 86400);
        expect(price.price).to.equal(50000n);

        const emaPrice = await fastAdapter.getEmaPriceNoOlderThan(
          assetId,
          86400 * 365,
        );
        expect(emaPrice.price).to.equal(50000n);
      });

      it("Should revert for stale prices", async () => {
        const oldTime = createPastTimestamp(3700); // More than 1 hour ago
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          oldTime,
        );

        await expect(fastAdapter.getPriceNoOlderThan(assetId, 3600)) // 1 hour max age
          .to.be.revertedWithCustomError(fastAdapter, "StalePrice");

        await expect(fastAdapter.getEmaPriceNoOlderThan(assetId, 3600)) // 1 hour max age
          .to.be.revertedWithCustomError(fastAdapter, "StalePrice");
      });

      it("Should revert for future timestamps", async () => {
        const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour in the future
        await submitPriceUpdate(
          fastAdapter,
          trustedKey,
          "BTC/USD",
          50000n,
          100n,
          futureTime,
        );

        // Should revert because block.timestamp < info.publishTime
        await expect(
          fastAdapter.getPriceNoOlderThan(assetId, 86400),
        ).to.be.revertedWithCustomError(fastAdapter, "StalePrice");

        await expect(
          fastAdapter.getEmaPriceNoOlderThan(assetId, 86400 * 365),
        ).to.be.revertedWithCustomError(fastAdapter, "StalePrice");
      });
    });

    describe("Fee and TWAP Functions", () => {
      it("Should return zero fee", async () => {
        const fee = await fastAdapter.getUpdateFee([
          ethers.toUtf8Bytes("test"),
        ]);
        expect(fee).to.equal(0);
      });

      it("Should revert TWAP functions with NotImplemented", async () => {
        await expect(
          fastAdapter.getTwapUpdateFee([ethers.toUtf8Bytes("test")]),
        ).to.be.revertedWithCustomError(fastAdapter, "TwapNotImplemented");

        await expect(
          fastAdapter.parseTwapPriceFeedUpdates(
            [ethers.toUtf8Bytes("test")],
            [assetId],
          ),
        ).to.be.revertedWithCustomError(fastAdapter, "TwapNotImplemented");
      });
    });
  });

  describe("Security", () => {
    let fastAdapter: FastAdapter;
    let fastProver: FastProver;
    let trustedKey: Wallet;
    let assetId: string;

    beforeEach(async () => {
      const fixture = await loadFixture(deployFastAdapterFixture);
      fastAdapter = fixture.fastAdapter;
      fastProver = fixture.fastProver;

      trustedKey = createTrustedKey();
      await fastProver.addTrustedKey(trustedKey.address);
      assetId = computeAssetId("BTC/USD");
    });

    it("Should reject ETH sent to all update functions", async () => {
      const updateData = await createValidUpdateData(
        trustedKey,
        "BTC/USD",
        50000n,
        100n,
      );

      // Test updatePriceFeeds
      await expect(
        fastAdapter.updatePriceFeeds([updateData], {
          value: ethers.parseEther("1"),
        }),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");

      // Test updatePriceFeedsIfNecessary
      await expect(
        fastAdapter.updatePriceFeedsIfNecessary(
          [updateData],
          [assetId],
          [Math.floor(Date.now() / 1000)],
          { value: ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");
    });

    it("Should reject ETH sent to all parse functions", async () => {
      const updateData = await createValidUpdateData(
        trustedKey,
        "BTC/USD",
        50000n,
        100n,
      );

      // Test parsePriceFeedUpdates
      await expect(
        fastAdapter.parsePriceFeedUpdates(
          [updateData],
          [assetId],
          0,
          Math.floor(Date.now() / 1000) + 3600,
          { value: ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");

      // Test parsePriceFeedUpdatesWithConfig
      await expect(
        fastAdapter.parsePriceFeedUpdatesWithConfig(
          [updateData],
          [assetId],
          0,
          Math.floor(Date.now() / 1000) + 3600,
          false,
          false,
          false,
          { value: ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");

      // Test parsePriceFeedUpdatesUnique
      await expect(
        fastAdapter.parsePriceFeedUpdatesUnique(
          [updateData],
          [assetId],
          0,
          Math.floor(Date.now() / 1000) + 3600,
          { value: ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");

      // Test parseTwapPriceFeedUpdates
      await expect(
        fastAdapter.parseTwapPriceFeedUpdates(
          [ethers.toUtf8Bytes("test")],
          [assetId],
          { value: ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidArgument");
    });

    it("Should upgrade and preserve state", async () => {
      const { fastAdapter } = await loadFixture(deployFastAdapterFixture);

      const initialProver = await fastAdapter.getProver();

      const FastAdapterV2 = await ethers.getContractFactory("FastAdapter");
      const upgradedContract = await upgrades.upgradeProxy(
        fastAdapter,
        FastAdapterV2,
      );

      expect(await upgradedContract.getProver()).to.equal(initialProver);
    });

    it("Should revert when trying to reinitialize", async () => {
      const { fastAdapter, owner } = await loadFixture(
        deployFastAdapterFixture,
      );

      // Try to call initialize again on an already initialized contract
      await expect(
        fastAdapter.initialize(
          await fastAdapter.getProver(),
          await owner.getAddress(),
        ),
      ).to.be.revertedWithCustomError(fastAdapter, "InvalidInitialization");
    });

    it("Should revert when updateProver is called directly on implementation", async () => {
      const { owner } = await loadFixture(deployFastAdapterFixture);

      // Deploy implementation directly (not through proxy)
      const FastAdapterImplementation =
        await ethers.getContractFactory("FastAdapter");
      const implementation = await FastAdapterImplementation.deploy();

      // Try to call updateProver directly on implementation
      // This should hit the onlyProxy modifier's else branch (since we changed the order to onlyProxy onlyOwner)
      await expect(
        implementation.updateProver(owner.address),
      ).to.be.revertedWithCustomError(
        implementation,
        "UUPSUnauthorizedCallContext",
      );
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
