import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  invalidConsensus,
  invalidExitCode,
  invalidMerkleProof,
  valid,
} from "../fixtures";

describe("CoreAdapter", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployCoreAdapterFixture() {
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

    // Deploy the CoreAdapter contract using proxy pattern
    const CoreAdapter = await ethers.getContractFactory("CoreAdapter");
    const priceFeedAdapter = await upgrades.deployProxy(
      CoreAdapter,
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
      const CoreAdapter = await ethers.getContractFactory("CoreAdapter");

      await expect(
        upgrades.deployProxy(
          CoreAdapter,
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
        .to.be.revertedWithCustomError(CoreAdapter, "ZeroAddressNotAllowed")
        .withArgs("SEDA prover");
    });

    it("Should revert with zero implementation address", async () => {
      const [owner] = await ethers.getSigners();
      const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
      const mockProver = await MockSedaProver.deploy();
      const CoreAdapter = await ethers.getContractFactory("CoreAdapter");

      await expect(
        upgrades.deployProxy(
          CoreAdapter,
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
        .to.be.revertedWithCustomError(CoreAdapter, "ZeroAddressNotAllowed")
        .withArgs("implementation");
    });

    it("Should revert when initializing with zero owner address", async () => {
      const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
      const mockProver = await MockSedaProver.deploy();
      const PriceFeed = await ethers.getContractFactory("PriceFeed");
      const sedaPriceFeed = await PriceFeed.deploy();
      const CoreAdapter = await ethers.getContractFactory("CoreAdapter");

      await expect(
        upgrades.deployProxy(
          CoreAdapter,
          [
            await mockProver.getAddress(),
            await sedaPriceFeed.getAddress(),
            ethers.ZeroAddress,
            valid().contractConfig,
          ],
          {
            initializer: "initialize",
          },
        ),
      )
        .to.be.revertedWithCustomError(CoreAdapter, "ZeroAddressNotAllowed")
        .withArgs("owner");
    });
  });

  describe("Submit", () => {
    it("Should process real results with valid data", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);
      expect(
        await priceFeedAdapter.getPriceFeedAddress("NONEXISTENT"),
      ).to.equal(ethers.ZeroAddress);
      expect(await priceFeedAdapter.hasPriceFeed("NONEXISTENT")).to.be.false;
    });

    it("Should return empty array when no tickers exist", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);
      expect(await priceFeedAdapter.getAllTickers()).to.deep.equal([]);
    });
  });

  describe("Owner Functions", () => {
    it("Should allow owner to update prover", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployCoreAdapterFixture,
      );
      const oldProver = await priceFeedAdapter.getProver();

      await expect(priceFeedAdapter.updateProver(user.address))
        .to.emit(priceFeedAdapter, "ProverUpdated")
        .withArgs(oldProver, user.address);
    });

    it("Should revert when non-owner tries to update prover", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployCoreAdapterFixture,
      );
      await expect(priceFeedAdapter.connect(user).updateProver(user.address))
        .to.be.revertedWithCustomError(
          priceFeedAdapter,
          "OwnableUnauthorizedAccount",
        )
        .withArgs(user.address);
    });

    it("Should revert when updating prover to zero address", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);

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

      const CoreAdapter = await ethers.getContractFactory("CoreAdapter");
      const priceFeedAdapter = await upgrades.deployProxy(
        CoreAdapter,
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
        deployCoreAdapterFixture,
      );

      const proverAddress = await priceFeedAdapter.getProver();
      expect(proverAddress).to.equal(await mockProver.getAddress());
    });

    it("Should return correct implementation address", async () => {
      const { priceFeedAdapter, sedaPriceFeed } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const implementationAddress = await priceFeedAdapter.getImplementation();
      expect(implementationAddress).to.equal(sedaPriceFeed);
    });
  });

  describe("SubmitForIndices", () => {
    it("Should process only specified indices with submitForIndices", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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
        deployCoreAdapterFixture,
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

  describe("Pause Functions", () => {
    it("Should allow owner to pause the contract", async () => {
      const { priceFeedAdapter, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      await expect(priceFeedAdapter.pause())
        .to.emit(priceFeedAdapter, "Paused")
        .withArgs(await owner.getAddress());
    });

    it("Should allow owner to unpause the contract", async () => {
      const { priceFeedAdapter, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // First pause
      await priceFeedAdapter.pause();

      // Then unpause
      await expect(priceFeedAdapter.unpause())
        .to.emit(priceFeedAdapter, "Unpaused")
        .withArgs(await owner.getAddress());
    });

    it("Should revert when non-owner tries to pause", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployCoreAdapterFixture,
      );

      await expect(priceFeedAdapter.connect(user).pause())
        .to.be.revertedWithCustomError(
          priceFeedAdapter,
          "OwnableUnauthorizedAccount",
        )
        .withArgs(user.address);
    });

    it("Should revert when non-owner tries to unpause", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // First pause as owner
      await priceFeedAdapter.pause();

      // Then try to unpause as non-owner
      await expect(priceFeedAdapter.connect(user).unpause())
        .to.be.revertedWithCustomError(
          priceFeedAdapter,
          "OwnableUnauthorizedAccount",
        )
        .withArgs(user.address);
    });

    it("Should revert submit when contract is paused", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Pause the contract
      await priceFeedAdapter.pause();

      // Try to submit while paused
      await expect(
        priceFeedAdapter.submit(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
        ),
      ).to.be.revertedWithCustomError(priceFeedAdapter, "EnforcedPause");
    });

    it("Should revert submitForIndices when contract is paused", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Pause the contract
      await priceFeedAdapter.pause();

      // Try to submitForIndices while paused
      await expect(
        priceFeedAdapter.submitForIndices(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
          [0],
        ),
      ).to.be.revertedWithCustomError(priceFeedAdapter, "EnforcedPause");
    });
  });

  describe("Storage Access Functions", () => {
    it("Should return correct storage values", async () => {
      const { priceFeedAdapter, mockProver, sedaPriceFeed } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();

      // Test public view functions that access storage
      expect(await priceFeedAdapter.sedaProver()).to.equal(
        await mockProver.getAddress(),
      );
      expect(await priceFeedAdapter.implementation()).to.equal(
        await sedaPriceFeed.getAddress(),
      );
      expect(await priceFeedAdapter.tickers()).to.deep.equal([]);

      const config = await priceFeedAdapter.priceFeedConfig();
      expect(config.execProgramId).to.equal(data.contractConfig.execProgramId);
      expect(config.tallyProgramId).to.equal(
        data.contractConfig.tallyProgramId,
      );
      expect(config.replicationFactor).to.equal(
        data.contractConfig.replicationFactor,
      );
      expect(config.tallyInputs).to.equal(data.contractConfig.tallyInputs);
      // Fix: Convert Buffer to hex string for comparison
      expect(config.consensusFilter).to.equal(
        ethers.hexlify(data.contractConfig.consensusFilter),
      );
    });
  });

  describe("getLatestRoundData", () => {
    it("Should return correct round data for existing ticker", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Submit data to create price feeds
      await priceFeedAdapter.submit(
        data.updateParams,
        data.sedaResult,
        data.batchNumber,
        data.merkleProof,
      );

      // Test getLatestRoundData for the first ticker
      const symbol = data.symbols[0];
      const roundData = await priceFeedAdapter.getLatestRoundData(symbol);

      // Verify the structure and data
      expect(roundData.answer).to.equal(data.expectedPrices[symbol]);
      expect(roundData.roundId).to.be.greaterThan(0);
      expect(roundData.answeredInRound).to.equal(roundData.roundId);
    });

    it("Should revert for non-existent ticker", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);

      await expect(priceFeedAdapter.getLatestRoundData("NONEXISTENT-TICKER"))
        .to.be.revertedWithCustomError(priceFeedAdapter, "InvalidParameter")
        .withArgs("Unknown ticker");
    });
  });

  describe("Proxy Upgrade", () => {
    it("Should upgrade the contract", async () => {
      const { priceFeedAdapter, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // Deploy a new implementation using the factory
      const CoreAdapterV2 = (
        await ethers.getContractFactory("CoreAdapter")
      ).connect(owner);

      // Upgrade the proxy using Hardhat upgrades
      const upgradedContract = await upgrades.upgradeProxy(
        priceFeedAdapter,
        CoreAdapterV2,
      );

      // Verify the upgrade was successful by checking if we can call functions
      expect(await upgradedContract.getProver()).to.equal(
        await priceFeedAdapter.getProver(),
      );
    });

    it("Should allow price feeds to be updated after proxy upgrade", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // Get initial data and create some price feeds
      const initialData = valid(0);
      await mockProver.setBatchValid(initialData.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Create initial price feeds
      await priceFeedAdapter.submit(
        initialData.updateParams,
        initialData.sedaResult,
        initialData.batchNumber,
        initialData.merkleProof,
      );

      // Store the addresses of created feeds
      const feedAddresses: Record<string, string> = {};
      for (const symbol of initialData.symbols) {
        feedAddresses[symbol] =
          await priceFeedAdapter.getPriceFeedAddress(symbol);
        expect(feedAddresses[symbol]).to.not.equal(ethers.ZeroAddress);
      }

      // Verify initial prices
      for (const symbol of initialData.symbols) {
        const feed = await ethers.getContractAt(
          "PriceFeed",
          feedAddresses[symbol],
        );
        const price = await feed.latestAnswer();
        expect(price).to.equal(initialData.expectedPrices[symbol]);
      }

      // Get the proxy's implementation address before upgrade
      const proxyImplementationBefore =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Upgrade the proxy
      const CoreAdapterV2 = (
        await ethers.getContractFactory("CoreAdapterV2")
      ).connect(owner);
      const upgradedContract = await upgrades.upgradeProxy(
        priceFeedAdapter,
        CoreAdapterV2,
      );

      // Verify that the proxy address stays the same
      expect(await upgradedContract.getAddress()).to.equal(
        await priceFeedAdapter.getAddress(),
      );

      // Verify that the proxy's implementation address has changed
      const proxyImplementationAfter =
        await upgrades.erc1967.getImplementationAddress(
          await upgradedContract.getAddress(),
        );
      expect(proxyImplementationAfter).to.not.equal(proxyImplementationBefore);

      // Verify upgrade was successful
      expect(await upgradedContract.version()).to.equal(2);
      expect(await upgradedContract.getProver()).to.equal(
        await priceFeedAdapter.getProver(),
      );

      // Get new data for updating the price feeds
      const updateData = valid(1);
      await mockProver.setBatchValid(updateData.batchNumber, true);

      // Update the price feeds using the upgraded contract
      const updateTx = await upgradedContract.submit(
        updateData.updateParams,
        updateData.sedaResult,
        updateData.batchNumber,
        updateData.merkleProof,
      );

      // Verify the update was successful
      await expect(updateTx)
        .to.emit(upgradedContract, "ResultVerified")
        .withArgs(
          updateData.sedaResult.drId,
          updateData.symbols[0],
          updateData.expectedPrices[updateData.symbols[0]],
          owner.address,
          updateData.sedaResult.blockHeight,
          updateData.sedaResult.blockTimestamp,
        );

      // Verify the same feed addresses are still used
      for (const symbol of updateData.symbols) {
        const currentAddress =
          await upgradedContract.getPriceFeedAddress(symbol);
        expect(currentAddress).to.equal(feedAddresses[symbol]);
      }

      // Verify the price feeds were updated with new prices
      for (const symbol of updateData.symbols) {
        const feed = await ethers.getContractAt(
          "PriceFeed",
          feedAddresses[symbol],
        );
        const updatedPrice = await feed.latestAnswer();
        expect(updatedPrice).to.equal(updateData.expectedPrices[symbol]);

        // Verify the price actually changed from the initial value
        expect(updatedPrice).to.not.equal(initialData.expectedPrices[symbol]);
      }

      // Verify all tickers are still registered
      const tickers = await upgradedContract.getAllTickers();
      for (const symbol of [...initialData.symbols, ...updateData.symbols]) {
        expect(tickers).to.include(symbol);
      }
    });

    it("Should revert when non-owner tries to upgrade", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // Deploy a new implementation using the factory with user account
      const CoreAdapterV2 = (
        await ethers.getContractFactory("CoreAdapter")
      ).connect(user);

      // Try to upgrade as non-owner using the user account
      await expect(upgrades.upgradeProxy(priceFeedAdapter, CoreAdapterV2))
        .to.be.revertedWithCustomError(
          priceFeedAdapter,
          "OwnableUnauthorizedAccount",
        )
        .withArgs(user.address);
    });

    it("Should revert when upgrading to zero address", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);

      // Try to upgrade to zero address directly
      await expect(priceFeedAdapter.upgradeToAndCall(ethers.ZeroAddress, "0x"))
        .to.be.revertedWithCustomError(priceFeedAdapter, "InvalidParameter")
        .withArgs("Invalid implementation address");
    });
    it("Should revert when trying to reinitialize", async () => {
      const { priceFeedAdapter, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // Try to call initialize again on an already initialized contract
      await expect(
        priceFeedAdapter.initialize(
          await priceFeedAdapter.getProver(),
          await priceFeedAdapter.getImplementation(),
          await owner.getAddress(),
          valid().contractConfig,
        ),
      ).to.be.revertedWithCustomError(
        priceFeedAdapter,
        "InvalidInitialization",
      );
    });
  });

  describe("onlyProxy Modifier", () => {
    it("Should revert when submit is called directly on implementation", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Get the implementation contract address
      const implementationAddress =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Get the implementation contract instance
      const implementation = await ethers.getContractAt(
        "CoreAdapter",
        implementationAddress,
      );

      // Try to call submit directly on implementation - should revert
      await expect(
        implementation.submit(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
        ),
      ).to.be.reverted;
    });

    it("Should revert when submitForIndices is called directly on implementation", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Get the implementation contract address
      const implementationAddress =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Get the implementation contract instance
      const implementation = await ethers.getContractAt(
        "CoreAdapter",
        implementationAddress,
      );

      // Try to call submitForIndices directly on implementation - should revert
      await expect(
        implementation.submitForIndices(
          data.updateParams,
          data.sedaResult,
          data.batchNumber,
          data.merkleProof,
          [0],
        ),
      ).to.be.reverted;
    });

    it("Should revert when updateProver is called directly on implementation", async () => {
      const { priceFeedAdapter, user } = await loadFixture(
        deployCoreAdapterFixture,
      );

      // Get the implementation contract address
      const implementationAddress =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Get the implementation contract instance
      const implementation = await ethers.getContractAt(
        "CoreAdapter",
        implementationAddress,
      );

      // Try to call updateProver directly on implementation - should revert
      await expect(implementation.updateProver(user.address)).to.be.reverted;
    });

    it("Should revert when pause is called directly on implementation", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);

      // Get the implementation contract address
      const implementationAddress =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Get the implementation contract instance
      const implementation = await ethers.getContractAt(
        "CoreAdapter",
        implementationAddress,
      );

      // Try to call pause directly on implementation - should revert
      await expect(implementation.pause()).to.be.reverted;
    });

    it("Should revert when unpause is called directly on implementation", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);

      // Get the implementation contract address
      const implementationAddress =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Get the implementation contract instance
      const implementation = await ethers.getContractAt(
        "CoreAdapter",
        implementationAddress,
      );

      // Try to call unpause directly on implementation - should revert
      await expect(implementation.unpause()).to.be.reverted;
    });

    it("Should allow view functions to be called directly on implementation", async () => {
      const { priceFeedAdapter } = await loadFixture(deployCoreAdapterFixture);

      // Get the implementation contract address
      const implementationAddress =
        await upgrades.erc1967.getImplementationAddress(
          await priceFeedAdapter.getAddress(),
        );

      // Get the implementation contract instance
      const implementation = await ethers.getContractAt(
        "CoreAdapter",
        implementationAddress,
      );

      // View functions should work directly on implementation (no onlyProxy modifier)
      // Note: These will return zero values because the implementation contract
      // doesn't have the proxy's storage, but they should not revert
      expect(await implementation.sedaProver()).to.equal(ethers.ZeroAddress);
      expect(await implementation.implementation()).to.equal(
        ethers.ZeroAddress,
      );
      expect(await implementation.getAllTickers()).to.deep.equal([]);
      expect(await implementation.hasPriceFeed("BTC-USDT")).to.be.false;
      expect(await implementation.getProver()).to.equal(ethers.ZeroAddress);
      expect(await implementation.getImplementation()).to.equal(
        ethers.ZeroAddress,
      );
    });

    it("Should work correctly when called through proxy", async () => {
      const { priceFeedAdapter, mockProver, owner } = await loadFixture(
        deployCoreAdapterFixture,
      );

      const data = valid();
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(owner.address);

      // Call through proxy - should work
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
    });
  });
});
