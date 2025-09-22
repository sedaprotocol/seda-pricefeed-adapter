import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("PriceFeed", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployPriceFeedFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, updater, user] = await ethers.getSigners();

    const PriceFeed = await ethers.getContractFactory("PriceFeed");
    const priceFeed = await PriceFeed.deploy();
    await priceFeed.waitForDeployment();

    return { priceFeed, owner, updater, user };
  }

  describe("Deployment", () => {
    it("Should deploy successfully", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);
      expect(priceFeed.target).to.be.properAddress;
    });

    it("Should not be initialized by default", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);
      expect(await priceFeed.initialized()).to.be.false;
    });

    it("Should have updater set to zero address by default", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);
      expect(await priceFeed.updater()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Initialization", () => {
    it("Should initialize successfully with valid parameters", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      const description = "ETH/USD";
      const decimals = 8;

      await expect(priceFeed.initialize(updater.address, description, decimals))
        .to.not.be.reverted;

      expect(await priceFeed.updater()).to.equal(updater.address);
      expect(await priceFeed.description()).to.equal(description);
      expect(await priceFeed.decimals()).to.equal(decimals);
      expect(await priceFeed.initialized()).to.be.true;
    });

    it("Should revert when trying to initialize with zero address updater", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);

      const description = "ETH/USD";
      const decimals = 8;

      await expect(
        priceFeed.initialize(ethers.ZeroAddress, description, decimals),
      ).to.be.revertedWithCustomError(priceFeed, "InvalidUpdaterAddress");
    });

    it("Should revert when trying to initialize twice", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      const description = "ETH/USD";
      const decimals = 8;

      await priceFeed.initialize(updater.address, description, decimals);

      await expect(
        priceFeed.initialize(updater.address, description, decimals),
      ).to.be.revertedWithCustomError(priceFeed, "AlreadyInitialized");
    });
  });

  describe("Update Result", () => {
    it("Should update result successfully with valid parameters", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value = ethers.parseUnits("2000", 8);
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(priceFeed.connect(updater).updateResult(value, timestamp))
        .to.emit(priceFeed, "AnswerUpdated")
        .withArgs(value, 1n, timestamp)
        .and.to.emit(priceFeed, "NewRound")
        .withArgs(1n, updater.address, timestamp);

      expect(await priceFeed.latestAnswer()).to.equal(value);
      expect(await priceFeed.latestTimestamp()).to.equal(timestamp);
      expect(await priceFeed.latestRoundId()).to.equal(1n);
    });

    it("Should increment round ID on each update", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value1 = ethers.parseUnits("2000", 8);
      const value2 = ethers.parseUnits("2100", 8);
      const timestamp1 = Math.floor(Date.now() / 1000);
      const timestamp2 = timestamp1 + 60;

      await priceFeed.connect(updater).updateResult(value1, timestamp1);
      expect(await priceFeed.latestRoundId()).to.equal(1n);

      await priceFeed.connect(updater).updateResult(value2, timestamp2);
      expect(await priceFeed.latestRoundId()).to.equal(2n);
    });

    it("Should revert when non-updater tries to update", async () => {
      const { priceFeed, updater, user } = await loadFixture(
        deployPriceFeedFixture,
      );

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value = ethers.parseUnits("2000", 8);
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(priceFeed.connect(user).updateResult(value, timestamp))
        .to.be.revertedWithCustomError(priceFeed, "Unauthorized")
        .withArgs(user.address, updater.address);
    });

    it("Should revert when updating with stale timestamp", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value1 = ethers.parseUnits("2000", 8);
      const value2 = ethers.parseUnits("2100", 8);
      const timestamp1 = Math.floor(Date.now() / 1000);
      const timestamp2 = timestamp1 - 60;

      await priceFeed.connect(updater).updateResult(value1, timestamp1);

      await expect(priceFeed.connect(updater).updateResult(value2, timestamp2))
        .to.be.revertedWithCustomError(priceFeed, "StaleResult")
        .withArgs(timestamp2, timestamp1);
    });

    it("Should revert when updating with same timestamp", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value1 = ethers.parseUnits("2000", 8);
      const value2 = ethers.parseUnits("2100", 8);
      const timestamp = Math.floor(Date.now() / 1000);

      await priceFeed.connect(updater).updateResult(value1, timestamp);

      await expect(priceFeed.connect(updater).updateResult(value2, timestamp))
        .to.be.revertedWithCustomError(priceFeed, "StaleResult")
        .withArgs(timestamp, timestamp);
    });

    it("Should handle negative values correctly", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value = -ethers.parseUnits("100", 8);
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(priceFeed.connect(updater).updateResult(value, timestamp)).to
        .not.be.reverted;

      expect(await priceFeed.latestAnswer()).to.equal(value);
    });
  });

  describe("Latest Round Data", () => {
    it("Should return correct latest round data after update", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value = ethers.parseUnits("2000", 8);
      const timestamp = Math.floor(Date.now() / 1000);

      await priceFeed.connect(updater).updateResult(value, timestamp);

      const roundData = await priceFeed.latestRoundData();

      expect(roundData.roundId).to.equal(1n);
      expect(roundData.answer).to.equal(value);
      expect(roundData.startedAt).to.equal(timestamp);
      expect(roundData.updatedAt).to.equal(timestamp);
      expect(roundData.answeredInRound).to.equal(1n);
    });

    it("Should revert when no data is available", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);

      await expect(priceFeed.latestRoundData()).to.be.revertedWithCustomError(
        priceFeed,
        "NoDataAvailable",
      );
    });
  });

  describe("Historical Data Functions", () => {
    it("Should revert getRoundData with HistoricalDataUnsupported", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);

      await expect(priceFeed.getRoundData(1)).to.be.revertedWithCustomError(
        priceFeed,
        "HistoricalDataUnsupported",
      );
    });

    it("Should revert getAnswer with HistoricalDataUnsupported", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);

      await expect(priceFeed.getAnswer(1)).to.be.revertedWithCustomError(
        priceFeed,
        "HistoricalDataUnsupported",
      );
    });

    it("Should revert getTimestamp with HistoricalDataUnsupported", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);

      await expect(priceFeed.getTimestamp(1)).to.be.revertedWithCustomError(
        priceFeed,
        "HistoricalDataUnsupported",
      );
    });
  });

  describe("Latest Round", () => {
    it("Should return 0 when no updates have been made", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);

      expect(await priceFeed.latestRound()).to.equal(0n);
    });

    it("Should return correct round ID after updates", async () => {
      const { priceFeed, updater } = await loadFixture(deployPriceFeedFixture);

      // Initialize the price feed
      await priceFeed.initialize(updater.address, "ETH/USD", 8);

      const value = ethers.parseUnits("2000", 8);
      const timestamp = Math.floor(Date.now() / 1000);

      await priceFeed.connect(updater).updateResult(value, timestamp);
      expect(await priceFeed.latestRound()).to.equal(1n);

      await priceFeed.connect(updater).updateResult(value, timestamp + 60);
      expect(await priceFeed.latestRound()).to.equal(2n);
    });
  });

  describe("Version", () => {
    it("Should return version 0", async () => {
      const { priceFeed } = await loadFixture(deployPriceFeedFixture);
      expect(await priceFeed.version()).to.equal(0n);
    });
  });
});
