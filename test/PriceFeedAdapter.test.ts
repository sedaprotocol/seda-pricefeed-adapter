import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Load the real SEDA data from JSON file
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "dr-valid.json"), "utf8")
);

describe("PriceFeedAdapter - Real SEDA Data Tests", () => {

  // Test fixtures for reusable setup with real SEDA data
  async function deployPriceFeedAdapterWithFixture() {
    const [owner, user1, user2, mockProverSigner, batchSender] =
      await ethers.getSigners();

    // Deploy the MockSedaProver contract
    const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
    const mockProver = await MockSedaProver.deploy();
    await mockProver.waitForDeployment();

    // Deploy the SedaPriceFeed contract
    const SedaPriceFeed = await ethers.getContractFactory("SedaPriceFeed");
    const sedaPriceFeed = await SedaPriceFeed.deploy();
    await sedaPriceFeed.waitForDeployment();

    // Deploy the PriceFeedAdapter contract with real program IDs from dr-valid.json
    const PriceFeedAdapter =
      await ethers.getContractFactory("PriceFeedAdapter");
    const priceFeedAdapter = await PriceFeedAdapter.deploy(
      await mockProver.getAddress(),
      await sedaPriceFeed.getAddress(),
      owner.address,
      {
        execProgramId: `0x${data.execProgramId}`,
        tallyProgramId: `0x${data.tallyProgramId}`,
        replicationFactor: data.replicationFactor,
        tallyInputs: data.tallyInputs ? data.tallyInputs : "0x",
        consensusFilter: data.consensusFilter ? Buffer.from(data.consensusFilter, 'base64') : "0x",
      },
    );

    return {
      priceFeedAdapter,
      mockProver,
      owner,
      user1,
      user2,
      mockProverSigner,
      batchSender,
      data,
    };
  }

  describe("Real SEDA Data Decoding", () => {
    it("Should decode real execInputs correctly", async () => {
      const { priceFeedAdapter, data } = await loadFixture(
        deployPriceFeedAdapterWithFixture,
      );

      // Convert base64 execInputs to bytes
      const execInputsBytes = Buffer.from(data.execInputs, 'base64');
      
      // Test the decodeExecInputs function
      const tickers = await priceFeedAdapter.decodeExecInputs(execInputsBytes);
      expect(tickers).to.deep.equal(["BTC-USDT", "ETH-USDT"]);
    });

    it("Should decode real price data correctly", async () => {
      const { priceFeedAdapter, data } = await loadFixture(
        deployPriceFeedAdapterWithFixture,
      );

      // Convert base64 result data to bytes
      const resultBytes = Buffer.from(data.result.result, 'base64');

      // Decode the price
      const prices = await priceFeedAdapter.decodePriceResult(resultBytes);
      expect(prices.length).to.equal(2);
      expect(prices).to.deep.equal([116556000000n, 3897930000n]);
    });

    it("Should process real SEDA result with submitResult", async () => {
      const {
        priceFeedAdapter,
        mockProver,
        data,
        owner,
      } = await loadFixture(deployPriceFeedAdapterWithFixture);

      // Set up mock prover to accept this result
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Create the SEDA result structure expected by the contract
      const sedaResult = {
        drId: `0x${data.drId}`,
        gasUsed: BigInt(data.result.gasUsed),
        blockHeight: data.result.blockHeight,
        blockTimestamp: Math.floor(new Date(data.result.timestamp).getTime() / 1000),
        consensus: data.result.consensus,
        exitCode: data.result.exitCode,
        version: data.result.version,
        result: Buffer.from(data.result.result, 'base64'),
        paybackAddress: data.paybackAddress || "0x",
        sedaPayload: data.payload || "0x",
      };

      // Convert base64 execInputs to bytes
      const execInputsBytes = Buffer.from(data.execInputs, 'base64');

      // Create merkle proof (mock data since we're using mock prover)
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678",
      ];

      // Submit the real result
      await expect(
        priceFeedAdapter.submit(
          {
            gasPrice: BigInt(data.gasPrice),
            execGasLimit: BigInt(data.execGasLimit),
            tallyGasLimit: BigInt(data.tallyGasLimit),
            execInputs: execInputsBytes,
            memo: Buffer.from(data.memo, 'base64'),
          },
          sedaResult,
          data.batchNumber,
          merkleProof,
        ),
      )
        .to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(
          `0x${data.drId}`,
          "BTC-USDT", // First ticker from the array
          116556000000n, // Price value
          data.result.blockHeight,
          owner.address,
        );

      // Verify that both price feeds were created
      const btcFeedAddr = await priceFeedAdapter.getPriceFeedAddress("BTC-USDT");
      const ethFeedAddr = await priceFeedAdapter.getPriceFeedAddress("ETH-USDT");
      expect(btcFeedAddr).to.not.equal(ethers.ZeroAddress);
      expect(ethFeedAddr).to.not.equal(ethers.ZeroAddress);

      // Verify the tickers were registered
      const tickers = await priceFeedAdapter.getAllTickers();
      expect(tickers).to.include("BTC-USDT");
      expect(tickers).to.include("ETH-USDT");

      // Verify the price feeds were updated
      const btcFeed = await ethers.getContractAt("SedaPriceFeed", btcFeedAddr);
      const ethFeed = await ethers.getContractAt("SedaPriceFeed", ethFeedAddr);
      const btcPrice = await btcFeed.latestAnswer();
      const ethPrice = await ethFeed.latestAnswer();
      expect(btcPrice).to.equal(116556000000n);
      expect(ethPrice).to.equal(3897930000n);
    });
  });
});
