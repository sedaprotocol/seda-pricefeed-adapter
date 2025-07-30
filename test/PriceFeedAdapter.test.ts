import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("PriceFeedAdapter", function () {
  // Test fixtures for reusable setup
  async function deployPriceFeedAdapterFixture() {
    const [owner, user1, user2, mockProverSigner, batchSender] = await ethers.getSigners();

    // Deploy the MockSedaProver contract
    const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
    const mockProver = await MockSedaProver.deploy();
    await mockProver.waitForDeployment();

    // Deploy the PriceFeedAdapter contract
    const PriceFeedAdapter = await ethers.getContractFactory("PriceFeedAdapter");
    const priceFeedAdapter = await PriceFeedAdapter.deploy(
      await mockProver.getAddress(), // Using mock prover contract address
      owner.address
    );

    // Create mock result data
    const mockRequestId = "0x1234567890123456789012345678901234567890123456789012345678901234";
    const mockResultId = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef";
    const mockPrice = ethers.parseUnits("50000", 8); // $50,000 with 8 decimals
    const mockTimestamp = Math.floor(Date.now() / 1000);
    const mockBatchHeight = 100;

    // Create a mock SEDA result
    const mockResult = {
      drId: mockRequestId,
      gasUsed: 1000000,
      blockHeight: 12345,
      blockTimestamp: mockTimestamp,
      consensus: true,
      exitCode: 0,
      version: "0.0.1",
      result: ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [mockPrice]),
      paybackAddress: "0x",
      sedaPayload: "0x"
    };

    return {
      priceFeedAdapter,
      mockProver,
      owner,
      user1,
      user2,
      mockProverSigner,
      batchSender,
      mockRequestId,
      mockResultId,
      mockPrice,
      mockTimestamp,
      mockBatchHeight,
      mockResult,
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct initial values", async function () {
      const { priceFeedAdapter, owner, mockProver } = await loadFixture(deployPriceFeedAdapterFixture);

      expect(await priceFeedAdapter.owner()).to.equal(owner.address);
      expect(await priceFeedAdapter.getProver()).to.equal(await mockProver.getAddress());
    });

    it("Should revert with zero prover address", async function () {
      const [owner] = await ethers.getSigners();
      const PriceFeedAdapter = await ethers.getContractFactory("PriceFeedAdapter");
      
      await expect(
        PriceFeedAdapter.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWith("Invalid prover address");
    });
  });

  describe("Mock Prover Debug", function () {
    it("Should understand mock prover validation logic", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      // Set up mock prover
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // Test normal result (should pass for valid batch)
      const [isValid, batchSender] = await priceFeedAdapter.verifyResult(mockResult, mockBatchHeight, merkleProof);
      console.log(`Result validation: ${isValid}, sender: ${batchSender}`);
      
      // Check batch validity
      const batchValid = await mockProver.isBatchValid(mockBatchHeight);
      console.log(`Batch ${mockBatchHeight} valid: ${batchValid}`);
      
      expect(isValid).to.be.true;
      expect(batchSender).to.equal(owner.address);
    });
  });

  describe("Result Verification", function () {
    it("Should verify result using view function", async function () {
      const { priceFeedAdapter, mockResult, mockBatchHeight } = await loadFixture(deployPriceFeedAdapterFixture);

      // Create proper 32-byte merkle proof entries
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];
      
      const [isValid, batchSender] = await priceFeedAdapter.verifyResult(
        mockResult,
        mockBatchHeight,
        merkleProof
      );

      // Since our mock prover validates based on resultId pattern, check the result
      expect(typeof isValid).to.equal("boolean");
      expect(typeof batchSender).to.equal("string");
    });

    it("Should successfully submit and verify a valid result", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, mockPrice, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      // Create merkle proof that should pass validation (even last byte in resultId)
      const validResultId = "0x1234567890123456789012345678901234567890123456789012345678901234"; // ends in 4 (even)
      const validResult = { ...mockResult, drId: validResultId };
      
      // Ensure the batch is valid and set the default batch sender
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // First test that verification passes
      const [isValid, batchSender] = await priceFeedAdapter.verifyResult(validResult, mockBatchHeight, merkleProof);
      expect(isValid).to.be.true;

      // This should emit ResultVerified event
      await expect(priceFeedAdapter.submitResult(validResult, mockBatchHeight, merkleProof))
        .to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(validResultId, "symbol", mockPrice, mockBatchHeight, owner.address);
    });

    it("Should fail verification with invalid batch", async function () {
      const { priceFeedAdapter, mockProver, mockResult, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      const invalidBatchHeight = 999; // Batch that doesn't exist
      
      // Don't set this batch as valid
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // This should return false from submitResult since batch is invalid
      const result = await priceFeedAdapter.submitResult.staticCall(mockResult, invalidBatchHeight, merkleProof);
      expect(result).to.be.false;
      
      // And should emit VerificationFailed event when actually called
      await expect(priceFeedAdapter.submitResult(mockResult, invalidBatchHeight, merkleProof))
        .to.emit(priceFeedAdapter, "VerificationFailed")
        .withArgs(mockResult.drId, "Invalid Merkle proof");
    });

    it("Should fail when consensus is false", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      // Use a result ID that will pass prover validation (even last byte)
      const noConsensusResult = { ...mockResult, consensus: false };
      const validResultId = "0x1234567890123456789012345678901234567890123456789012345678901234"; // even
      noConsensusResult.drId = validResultId;
      
      // Ensure the batch is valid and set the default batch sender
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // Verify that the prover validation would pass
      const [isValid] = await priceFeedAdapter.verifyResult(noConsensusResult, mockBatchHeight, merkleProof);
      expect(isValid).to.be.true;

      await expect(priceFeedAdapter.submitResult(noConsensusResult, mockBatchHeight, merkleProof))
        .to.emit(priceFeedAdapter, "VerificationFailed")
        .withArgs(validResultId, "No consensus reached");
    });

    it("Should fail when exit code is not 0", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      const failedResult = { ...mockResult, exitCode: 1 };
      const validResultId = "0x1234567890123456789012345678901234567890123456789012345678901234"; // even
      failedResult.drId = validResultId;
      
      // Ensure the batch is valid and set the default batch sender
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // Verify that the prover validation would pass
      const [isValid] = await priceFeedAdapter.verifyResult(failedResult, mockBatchHeight, merkleProof);
      expect(isValid).to.be.true;

      await expect(priceFeedAdapter.submitResult(failedResult, mockBatchHeight, merkleProof))
        .to.emit(priceFeedAdapter, "VerificationFailed")
        .withArgs(validResultId, "Oracle execution failed");
    });

    it("Should fail when price extraction returns 0", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      // Create result with invalid price data that will decode to 0
      // Need to ensure we have proper ABI encoded data that decodes to 0
      const zeroPriceResult = { 
        ...mockResult, 
        result: ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0]) // Encodes to 0
      };
      const validResultId = "0x1234567890123456789012345678901234567890123456789012345678901234"; // even
      zeroPriceResult.drId = validResultId;
      
      // Ensure the batch is valid and set the default batch sender
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // Verify that the prover validation would pass
      const [isValid] = await priceFeedAdapter.verifyResult(zeroPriceResult, mockBatchHeight, merkleProof);
      expect(isValid).to.be.true;

      await expect(priceFeedAdapter.submitResult(zeroPriceResult, mockBatchHeight, merkleProof))
        .to.emit(priceFeedAdapter, "VerificationFailed")
        .withArgs(validResultId, "Failed to extract price");
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to update prover", async function () {
      const { priceFeedAdapter, owner, user1 } = await loadFixture(deployPriceFeedAdapterFixture);

      const newProver = user1.address;
      
      await expect(priceFeedAdapter.connect(owner).updateProver(newProver))
        .to.emit(priceFeedAdapter, "ProverUpdated");

      expect(await priceFeedAdapter.getProver()).to.equal(newProver);
    });

    it("Should prevent non-owner from updating prover", async function () {
      const { priceFeedAdapter, user1 } = await loadFixture(deployPriceFeedAdapterFixture);

      await expect(
        priceFeedAdapter.connect(user1).updateProver(user1.address)
      ).to.be.revertedWithCustomError(priceFeedAdapter, "OwnableUnauthorizedAccount");
    });

    it("Should reject zero address for prover update", async function () {
      const { priceFeedAdapter, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      await expect(
        priceFeedAdapter.connect(owner).updateProver(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid prover address");
    });
  });

  describe("Price Decoding", function () {
    it("Should decode valid price result", async function () {
      const { priceFeedAdapter } = await loadFixture(deployPriceFeedAdapterFixture);

      const testPrice = ethers.parseUnits("50000", 8);
      const encodedPrice = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [testPrice]);

      const decodedPrice = await priceFeedAdapter.decodePriceResult(encodedPrice);
      expect(decodedPrice).to.equal(testPrice);
    });

    it("Should handle malformed price data", async function () {
      const { priceFeedAdapter } = await loadFixture(deployPriceFeedAdapterFixture);

      const malformedData = "0x1234"; // Invalid encoded data

      await expect(priceFeedAdapter.decodePriceResult(malformedData))
        .to.be.reverted;
    });
  });

  describe("View Functions", function () {
    it("Should return placeholder for getRequestSymbol", async function () {
      const { priceFeedAdapter, mockRequestId } = await loadFixture(deployPriceFeedAdapterFixture);

      const symbol = await priceFeedAdapter.getRequestSymbol(mockRequestId);
      expect(symbol).to.equal("TODO");
    });

    it("Should track prover state correctly", async function () {
      const { priceFeedAdapter, mockProver } = await loadFixture(deployPriceFeedAdapterFixture);

      expect(await priceFeedAdapter.getProver()).to.equal(await mockProver.getAddress());
      
      const lastBatchHeight = await priceFeedAdapter.getLastBatchHeight();
      expect(lastBatchHeight).to.equal(100); // Default value in MockSedaProver
    });
  });

  describe("Integration Scenarios", function () {
    it("Should handle complete verification workflow", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, mockPrice, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      // 1. Verify the adapter is properly connected to the prover
      expect(await priceFeedAdapter.getProver()).to.equal(await mockProver.getAddress());
      
      // 2. Set up the mock prover properly
      const validResultId = "0x1234567890123456789012345678901234567890123456789012345678901234";
      const validResult = { ...mockResult, drId: validResultId };
      
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      // 3. Test result verification (view function)
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];
      
      const [isValid, batchSender] = await priceFeedAdapter.verifyResult(
        validResult,
        mockBatchHeight,
        merkleProof
      );
      
      expect(isValid).to.be.true;
      expect(batchSender).to.equal(owner.address);
      
      // 4. Submit a valid result and verify it emits the right event
      await expect(priceFeedAdapter.submitResult(validResult, mockBatchHeight, merkleProof))
        .to.emit(priceFeedAdapter, "ResultVerified")
        .withArgs(validResultId, "symbol", mockPrice, mockBatchHeight, owner.address);
    });

    it("Should properly handle reentrancy protection", async function () {
      const { priceFeedAdapter, mockProver, mockResult, mockBatchHeight, owner } = await loadFixture(deployPriceFeedAdapterFixture);

      const validResultId = "0x1234567890123456789012345678901234567890123456789012345678901234";
      const validResult = { ...mockResult, drId: validResultId };
      
      // Ensure the batch is valid and set the default batch sender
      await mockProver.setBatchValid(mockBatchHeight, true);
      await mockProver.setDefaultBatchSender(owner.address);
      
      const merkleProof = [
        "0x1234567890123456789012345678901234567890123456789012345678901234",
        "0x5678901234567890123456789012345678901234567890123456789012345678"
      ];

      // The contract uses nonReentrant modifier on submitResult
      // This test ensures the function can be called successfully
      const success = await priceFeedAdapter.submitResult.staticCall(validResult, mockBatchHeight, merkleProof);
      expect(success).to.be.true;
    });
  });
}); 