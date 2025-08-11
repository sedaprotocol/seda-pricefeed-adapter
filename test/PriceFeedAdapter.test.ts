import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  invalidConsensus,
  invalidExitCode,
  invalidMerkleProof,
  valid,
} from "./fixtures";

describe("PriceFeedAdapter", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployPriceFeedAdapterFixture() {
    const [owner, user] = await ethers.getSigners();

    // Deploy the MockSedaProver contract
    const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
    const mockProver = await MockSedaProver.deploy();
    await mockProver.waitForDeployment();

    // Deploy the PriceFeed contract
    const PriceFeed = await ethers.getContractFactory("PriceFeed");
    const sedaPriceFeed = await PriceFeed.deploy();
    await sedaPriceFeed.waitForDeployment();

    // Get the valid data for contract deployment
    const data = valid();

    // Deploy the PriceFeedAdapter contract with real program IDs from dr-valid.json
    const PriceFeedAdapter =
      await ethers.getContractFactory("PriceFeedAdapter");
    const priceFeedAdapter = await PriceFeedAdapter.deploy(
      await mockProver.getAddress(),
      await sedaPriceFeed.getAddress(),
      owner.address,
      data.contractConfig,
    );

    return {
      priceFeedAdapter,
      mockProver,
      owner,
      user,
      sedaPriceFeed,
    };
  }

  describe("Constructor", () => {
    it("Should revert with zero prover address", async () => {
      const [owner] = await ethers.getSigners();
      const PriceFeed = await ethers.getContractFactory("PriceFeed");
      const sedaPriceFeed = await PriceFeed.deploy();
      const PriceFeedAdapter =
        await ethers.getContractFactory("PriceFeedAdapter");

      await expect(
        PriceFeedAdapter.deploy(
          ethers.ZeroAddress,
          await sedaPriceFeed.getAddress(),
          owner.address,
          {
            execProgramId:
              "0x1234567890123456789012345678901234567890123456789012345678901234",
            tallyProgramId:
              "0x5678901234567890123456789012345678901234567890123456789012345678",
            replicationFactor: 3,
            tallyInputs: "0x",
            consensusFilter: "0x",
          },
        ),
      ).to.be.revertedWithCustomError(PriceFeedAdapter, "InvalidProverAddress");
    });

    it("Should revert with zero implementation address", async () => {
      const [owner] = await ethers.getSigners();
      const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
      const mockProver = await MockSedaProver.deploy();
      const PriceFeedAdapter =
        await ethers.getContractFactory("PriceFeedAdapter");

      await expect(
        PriceFeedAdapter.deploy(
          await mockProver.getAddress(),
          ethers.ZeroAddress,
          owner.address,
          {
            execProgramId:
              "0x1234567890123456789012345678901234567890123456789012345678901234",
            tallyProgramId:
              "0x5678901234567890123456789012345678901234567890123456789012345678",
            replicationFactor: 3,
            tallyInputs: "0x",
            consensusFilter: "0x",
          },
        ),
      ).to.be.revertedWithCustomError(
        PriceFeedAdapter,
        "InvalidImplementationAddress",
      );
    });
  });

  describe("Submit Validation", () => {
    it("Should process real SEDA result with submitResult", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      // Get the valid data for contract deployment
      const data = valid();

      // Set up mock prover to accept this result
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Submit the real result using valid data
      const tx = await priceFeedAdapter.submit(
        data.updateParams,
        data.sedaResult,
        data.batchNumber,
        data.merkleProof,
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(
          data.sedaResult.drId,
          "BTC-USDT",
          data.expectedPrices["BTC-USDT"],
          data.sedaResult.blockHeight,
          owner.address,
        )
        .and.to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(
          data.sedaResult.drId,
          "ETH-USDT",
          data.expectedPrices["ETH-USDT"],
          data.sedaResult.blockHeight,
          owner.address,
        )
        .and.to.emit(priceFeedAdapter, "PriceFeedCreated")
        .withArgs(
          "BTC-USDT",
          await priceFeedAdapter.getPriceFeedAddress("BTC-USDT"),
          6,
        )
        .and.to.emit(priceFeedAdapter, "PriceFeedCreated")
        .withArgs(
          "ETH-USDT",
          await priceFeedAdapter.getPriceFeedAddress("ETH-USDT"),
          6,
        );

      // Verify that both price feeds were created
      const btcFeedAddr =
        await priceFeedAdapter.getPriceFeedAddress("BTC-USDT");
      const ethFeedAddr =
        await priceFeedAdapter.getPriceFeedAddress("ETH-USDT");
      expect(btcFeedAddr).to.not.equal(ethers.ZeroAddress);
      expect(ethFeedAddr).to.not.equal(ethers.ZeroAddress);

      // Verify the tickers were registered
      const tickers = await priceFeedAdapter.getAllTickers();
      expect(tickers).to.include("BTC-USDT");
      expect(tickers).to.include("ETH-USDT");

      // Verify the price feeds were updated with expected prices
      const btcFeed = await ethers.getContractAt("PriceFeed", btcFeedAddr);
      const ethFeed = await ethers.getContractAt("PriceFeed", ethFeedAddr);
      const btcPrice = await btcFeed.latestAnswer();
      const ethPrice = await ethFeed.latestAnswer();
      expect(btcPrice).to.equal(data.expectedPrices["BTC-USDT"]);
      expect(ethPrice).to.equal(data.expectedPrices["ETH-USDT"]);
    });

    it("Should revert with invalid merkle proof", async () => {
      const { priceFeedAdapter, mockProver } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      const testData = invalidMerkleProof();
      await mockProver.setBatchValid(testData.batchNumber, false);

      await expect(
        priceFeedAdapter.submit(
          testData.request,
          testData.sedaResult,
          testData.batchNumber,
          testData.merkleProof,
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Invalid Merkle proof");
    });

    it("Should revert with invalid consensus", async () => {
      const { priceFeedAdapter, mockProver } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      const testData = invalidConsensus();
      await mockProver.setBatchValid(testData.batchNumber, true);

      await expect(
        priceFeedAdapter.submit(
          testData.request,
          testData.sedaResult,
          testData.batchNumber,
          testData.merkleProof,
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Invalid consensus or exit code");
    });

    it("Should revert with invalid exit code", async () => {
      const { priceFeedAdapter, mockProver } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      const testData = invalidExitCode();
      await mockProver.setBatchValid(testData.batchNumber, true);

      await expect(
        priceFeedAdapter.submit(
          testData.request,
          testData.sedaResult,
          testData.batchNumber,
          testData.merkleProof,
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Invalid consensus or exit code");
    });

    it("Should revert with invalid DR ID", async () => {
      const { priceFeedAdapter, mockProver } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      const testData = valid();
      await mockProver.setBatchValid(testData.batchNumber, true);

      const modifiedUpdateParams = testData.updateParams;
      modifiedUpdateParams.memo = Buffer.from("0x01234", "hex");

      await expect(
        priceFeedAdapter.submit(
          modifiedUpdateParams,
          testData.sedaResult,
          testData.batchNumber,
          testData.merkleProof,
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Invalid DR ID");
    });

    it("Should revert if invariant of equal length of symbols and prices is violated", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      // Get the valid data for contract deployment
      const data = valid();

      // Set up mock prover to accept this result
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Modify the result to violate the invariant of equal length of symbols and prices
      data.sedaResult.result = Buffer.from(
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwX6+Wg",
        "base64",
      );

      // Submit the real result using valid data
      await expect(
        priceFeedAdapter.submit(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Mismatched tickers and prices");
    });
  });

  describe("Registry", () => {
    it("Should return zero address for non-existent ticker", async () => {
      const { priceFeedAdapter } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      expect(
        await priceFeedAdapter.getPriceFeedAddress("NONEXISTENT"),
      ).to.equal(ethers.ZeroAddress);
      expect(await priceFeedAdapter.hasPriceFeed("NONEXISTENT")).to.be.false;
    });

    it("Should return empty array when no tickers exist", async () => {
      const { priceFeedAdapter } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      expect(await priceFeedAdapter.getAllTickers()).to.deep.equal([]);
    });
  });

  describe("Owner Functions", () => {
    it("Should allow owner to update prover", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      const oldProver = await priceFeedAdapter.getProver();

      await expect(priceFeedAdapter.updateProver(user.address))
        .to.emit(priceFeedAdapter, "ProverUpdated")
        .withArgs(oldProver, user.address);
    });

    it("Should revert when non-owner tries to update prover", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );
      await expect(priceFeedAdapter.connect(user).updateProver(user.address))
        .to.be.revertedWithCustomError(
          priceFeedAdapter,
          "OwnableUnauthorizedAccount",
        )
        .withArgs(user.address);
    });
  });

  describe("Edge cases", () => {
    it("Should not create price feed if already deployed", async () => {
      const [owner, other] = await ethers.getSigners();
      const testData = valid();

      const PriceFeed = await ethers.getContractFactory("PriceFeed");

      // Deploy a Price Feed contract with the same ticker as the valid data
      const existingFeed = await PriceFeed.connect(owner).deploy();
      await existingFeed.waitForDeployment();
      await existingFeed.initialize(other.address, "BTC-USDT", 6);

      // Deploy the PriceFeed contract from the 'other' address
      const sedaPriceFeed = await PriceFeed.connect(owner).deploy();
      await sedaPriceFeed.waitForDeployment();

      const MockProver = await ethers.getContractFactory("MockSedaProver");
      const mockProver = await MockProver.deploy();
      await mockProver.waitForDeployment();

      const PriceFeedAdapter =
        await ethers.getContractFactory("PriceFeedAdapter");
      const priceFeedAdapter = await PriceFeedAdapter.deploy(
        await mockProver.getAddress(),
        await sedaPriceFeed.getAddress(),
        owner.address,
        testData.contractConfig,
      );

      await mockProver.setBatchValid(testData.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      await expect(
        priceFeedAdapter.submit(
          testData.updateParams,
          testData.sedaResult,
          testData.batchNumber,
          testData.merkleProof,
        ),
      )
        .to.emit(priceFeedAdapter, "ResultVerified")
        .and.to.emit(priceFeedAdapter, "PriceFeedCreated");

      const priceFeed = await priceFeedAdapter.getPriceFeedAddress("BTC-USDT");
      const priceFeedContract = await ethers.getContractAt(
        "PriceFeed",
        priceFeed,
      );
      console.log(await priceFeedContract.getAddress());
      const price = await priceFeedContract.latestAnswer();
      expect(price).to.equal(testData.expectedPrices["BTC-USDT"]);
    });
  });

  describe("Getters", () => {
    it("Should return correct prover address", async () => {
      const { priceFeedAdapter, mockProver } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const proverAddress = await priceFeedAdapter.getProver();
      expect(proverAddress).to.equal(await mockProver.getAddress());
    });

    it("Should return correct implementation address", async () => {
      const { priceFeedAdapter, sedaPriceFeed } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const implementationAddress = await priceFeedAdapter.getImplementation();
      expect(implementationAddress).to.equal(sedaPriceFeed);
    });
  });
});
