import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
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

    // Deploy the PriceFeedAdapter contract using proxy pattern
    const PriceFeedAdapter =
      await ethers.getContractFactory("PriceFeedAdapter");
    const priceFeedAdapter = await upgrades.deployProxy(
      PriceFeedAdapter,
      [
        await mockProver.getAddress(),
        await sedaPriceFeed.getAddress(),
        owner.address,
        data.contractConfig,
      ],
      {
        initializer: "initialize",
      },
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
        upgrades.deployProxy(
          PriceFeedAdapter,
          [
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
          ],
          {
            initializer: "initialize",
          },
        ),
      )
        .to.be.revertedWithCustomError(
          PriceFeedAdapter,
          "ZeroAddressNotAllowed",
        )
        .withArgs("SEDA prover");
    });

    it("Should revert with zero implementation address", async () => {
      const [owner] = await ethers.getSigners();
      const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
      const mockProver = await MockSedaProver.deploy();
      const PriceFeedAdapter =
        await ethers.getContractFactory("PriceFeedAdapter");

      await expect(
        upgrades.deployProxy(
          PriceFeedAdapter,
          [
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
          ],
          {
            initializer: "initialize",
          },
        ),
      )
        .to.be.revertedWithCustomError(
          PriceFeedAdapter,
          "ZeroAddressNotAllowed",
        )
        .withArgs("implementation");
    });
  });

  describe("Submit", () => {
    it("Should process real results with valid data", async () => {
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
          data.symbols[0],
          data.expectedPrices[data.symbols[0]],
          owner.address,
          data.sedaResult.blockHeight,
          data.sedaResult.blockTimestamp,
        );

      // Verify that price feeds were created for all symbols
      for (const symbol of data.symbols) {
        const feedAddr = await priceFeedAdapter.getPriceFeedAddress(symbol);
        expect(feedAddr).to.not.equal(ethers.ZeroAddress);

        // Verify the price feed was updated with expected price
        const feed = await ethers.getContractAt("PriceFeed", feedAddr);
        const price = await feed.latestAnswer();
        expect(price).to.equal(data.expectedPrices[symbol]);
      }

      // Verify the tickers were registered
      const tickers = await priceFeedAdapter.getAllTickers();
      for (const symbol of data.symbols) {
        expect(tickers).to.include(symbol);
      }
    });

    it("Should create price feeds on first submission and reuse on second submission", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      // Get two different data sets
      const data0 = valid(0);
      const data1 = valid(1);

      // Set up mock prover to accept both results
      await mockProver.setBatchValid(data0.batchNumber, true);
      await mockProver.setBatchValid(data1.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // First submission - should create price feeds
      const tx1 = await priceFeedAdapter.submit(
        data0.updateParams,
        data0.sedaResult,
        data0.batchNumber,
        data0.merkleProof,
      );

      // Expect PriceFeedCreated events for the first submission
      await expect(tx1).to.emit(priceFeedAdapter, "PriceFeedCreated");

      // Store the addresses of created feeds
      const addresses: Record<string, string> = {};
      for (const symbol of data0.symbols) {
        addresses[symbol] = await priceFeedAdapter.getPriceFeedAddress(symbol);
        expect(addresses[symbol]).to.not.equal(ethers.ZeroAddress);
      }

      // Second submission - should NOT create new price feeds, just update existing ones
      const tx2 = await priceFeedAdapter.submit(
        data1.updateParams,
        data1.sedaResult,
        data1.batchNumber,
        data1.merkleProof,
      );

      // Should NOT emit PriceFeedCreated events for the second submission
      await expect(tx2).to.not.emit(priceFeedAdapter, "PriceFeedCreated");

      // Verify the same addresses are used (no new contracts created)
      for (const symbol of data1.symbols) {
        const currentAddress =
          await priceFeedAdapter.getPriceFeedAddress(symbol);
        expect(currentAddress).to.equal(addresses[symbol]);
      }

      // Verify both submissions updated the price feeds with their respective prices
      for (const symbol of data1.symbols) {
        const feed = await ethers.getContractAt("PriceFeed", addresses[symbol]);
        const price = await feed.latestAnswer();
        expect(price).to.equal(data1.expectedPrices[symbol]);
      }

      // Verify all tickers from both submissions are registered
      const tickers = await priceFeedAdapter.getAllTickers();
      for (const symbol of [...data0.symbols, ...data1.symbols]) {
        expect(tickers).to.include(symbol);
      }
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

    it("Should revert with empty tickers", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Modify the execInputs to be empty (no tickers)
      const modifiedUpdateParams = {
        ...data.updateParams,
        execInputs: ethers.AbiCoder.defaultAbiCoder().encode(
          ["string[]"],
          [[]],
        ), // Empty array of strings
      };

      // Derive the new DR ID using the same logic as the contract
      const requestInputs = {
        execProgramId: data.contractConfig.execProgramId,
        tallyProgramId: data.contractConfig.tallyProgramId,
        gasPrice: modifiedUpdateParams.gasPrice,
        execGasLimit: modifiedUpdateParams.execGasLimit,
        tallyGasLimit: modifiedUpdateParams.tallyGasLimit,
        replicationFactor: data.contractConfig.replicationFactor,
        execInputs: modifiedUpdateParams.execInputs, // Empty
        tallyInputs: data.contractConfig.tallyInputs,
        consensusFilter: data.contractConfig.consensusFilter,
        memo: modifiedUpdateParams.memo,
      };

      // Derive DR ID using the same logic as SedaDataTypes.deriveRequestId
      const drId = ethers.keccak256(
        ethers.concat([
          ethers.keccak256(ethers.toUtf8Bytes("0.0.1")), // VERSION
          requestInputs.execProgramId,
          ethers.keccak256(requestInputs.execInputs), // Empty inputs
          ethers.zeroPadValue(ethers.toBeHex(requestInputs.execGasLimit), 8),
          requestInputs.tallyProgramId,
          ethers.keccak256(requestInputs.tallyInputs),
          ethers.zeroPadValue(ethers.toBeHex(requestInputs.tallyGasLimit), 8),
          ethers.zeroPadValue(
            ethers.toBeHex(requestInputs.replicationFactor),
            2,
          ),
          ethers.keccak256(requestInputs.consensusFilter),
          ethers.zeroPadValue(ethers.toBeHex(requestInputs.gasPrice), 16),
          ethers.keccak256(requestInputs.memo),
        ]),
      );

      const modifiedSedaResult = {
        ...data.sedaResult,
        drId: drId,
      };

      await expect(
        priceFeedAdapter.submit(
          modifiedUpdateParams,
          modifiedSedaResult,
          data.batchNumber,
          data.merkleProof,
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Empty tickers");
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

    it("Should revert when updating prover to zero address", async () => {
      const { priceFeedAdapter } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      await expect(priceFeedAdapter.updateProver(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(priceFeedAdapter, "InvalidParameter")
        .withArgs("Invalid SEDA prover address");
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
      const priceFeedAdapter = await upgrades.deployProxy(
        PriceFeedAdapter,
        [
          await mockProver.getAddress(),
          await sedaPriceFeed.getAddress(),
          owner.address,
          testData.contractConfig,
        ],
        {
          initializer: "initialize",
        },
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

  describe("SubmitForIndices", () => {
    it("Should process only specified indices with submitForIndices", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Submit only the first ticker (index 0)
      const tx = await priceFeedAdapter.submitForIndices(
        data.updateParams,
        data.sedaResult,
        data.batchNumber,
        data.merkleProof,
        [0], // Only process first ticker
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(
          data.sedaResult.drId,
          data.symbols[0],
          data.expectedPrices[data.symbols[0]],
          owner.address,
          data.sedaResult.blockHeight,
          data.sedaResult.blockTimestamp,
        );

      // Verify only the first ticker was processed
      const feedAddr = await priceFeedAdapter.getPriceFeedAddress(
        data.symbols[0],
      );
      expect(feedAddr).to.not.equal(ethers.ZeroAddress);

      // Verify other tickers were not processed
      for (let i = 1; i < data.symbols.length; i++) {
        const feedAddr = await priceFeedAdapter.getPriceFeedAddress(
          data.symbols[i],
        );
        expect(feedAddr).to.equal(ethers.ZeroAddress);
      }

      // Verify only the first ticker was registered
      const tickers = await priceFeedAdapter.getAllTickers();
      expect(tickers).to.include(data.symbols[0]);
      for (let i = 1; i < data.symbols.length; i++) {
        expect(tickers).to.not.include(data.symbols[i]);
      }

      // Verify only the first ticker price was updated
      const firstFeed = await ethers.getContractAt("PriceFeed", feedAddr);
      expect(await firstFeed.latestAnswer()).to.equal(
        data.expectedPrices[data.symbols[0]],
      );
    });

    it("Should process multiple specific indices", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Submit both tickers but in reverse order
      const tx = await priceFeedAdapter.submitForIndices(
        data.updateParams,
        data.sedaResult,
        data.batchNumber,
        data.merkleProof,
        [1, 0], // Process second ticker first, then first ticker
      );

      await expect(tx)
        .to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(
          data.sedaResult.drId,
          data.symbols[1],
          data.expectedPrices[data.symbols[1]],
          owner.address,
          data.sedaResult.blockHeight,
          data.sedaResult.blockTimestamp,
        )
        .and.to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(
          data.sedaResult.drId,
          data.symbols[0],
          data.expectedPrices[data.symbols[0]],
          owner.address,
          data.sedaResult.blockHeight,
          data.sedaResult.blockTimestamp,
        );

      // Verify both were processed
      for (const symbol of data.symbols) {
        const feedAddr = await priceFeedAdapter.getPriceFeedAddress(symbol);
        expect(feedAddr).to.not.equal(ethers.ZeroAddress);
      }

      // Verify both tickers were registered
      const tickers = await priceFeedAdapter.getAllTickers();
      for (const symbol of data.symbols) {
        expect(tickers).to.include(symbol);
      }
    });

    it("Should revert with index out of bounds", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Try to access index 2 when only 2 tickers exist (indices 0 and 1)
      await expect(
        priceFeedAdapter.submitForIndices(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
          [0, 2], // Index 2 is out of bounds
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Index out of bounds");
    });

    it("Should use same verification logic as submit", async () => {
      const { priceFeedAdapter, mockProver } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const data = valid();
      // Don't set the batch as valid - should fail verification
      await mockProver.setBatchValid(data.batchNumber, false);

      await expect(
        priceFeedAdapter.submitForIndices(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
          [0],
        ),
      )
        .to.be.revertedWithCustomError(priceFeedAdapter, "ValidationFailed")
        .withArgs("Invalid Merkle proof");
    });

    it("Should handle empty indices array", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployPriceFeedAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Submit with empty indices array
      const tx = await priceFeedAdapter.submitForIndices(
        data.updateParams,
        data.sedaResult,
        data.batchNumber,
        data.merkleProof,
        [], // Empty array
      );

      // Should succeed but not create any price feeds
      await expect(tx).to.not.emit(priceFeedAdapter, "ResultVerified");
      await expect(tx).to.not.emit(priceFeedAdapter, "PriceFeedCreated");

      // Verify no price feeds were created
      const btcFeedAddr =
        await priceFeedAdapter.getPriceFeedAddress("BTC-USDT");
      const ethFeedAddr =
        await priceFeedAdapter.getPriceFeedAddress("ETH-USDT");

      expect(btcFeedAddr).to.equal(ethers.ZeroAddress);
      expect(ethFeedAddr).to.equal(ethers.ZeroAddress);

      // Verify no tickers were registered
      const tickers = await priceFeedAdapter.getAllTickers();
      expect(tickers).to.deep.equal([]);
    });
  });
});
