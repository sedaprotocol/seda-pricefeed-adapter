import { ethers } from "hardhat";

async function main() {
  console.log("🔄 SEDA PriceFeedAdapter Interaction Demo");
  console.log("========================================");

  // Get contract address from command line or use a default for testing
  const adapterAddress = process.argv[2] || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  
  console.log(`📍 Adapter Address: ${adapterAddress}`);

  try {
    // Connect to the contract
    const priceFeedAdapter = await ethers.getContractAt("PriceFeedAdapter", adapterAddress);
    const [signer] = await ethers.getSigners();
    
    console.log(`👤 Using account: ${signer.address}`);
    console.log(`💰 Account balance: ${ethers.formatEther(await signer.provider.getBalance(signer.address))} ETH`);

    // Display contract info
    console.log("\n📊 Adapter Information:");
    console.log("----------------------");
    console.log(`Owner: ${await priceFeedAdapter.owner()}`);
    console.log(`SEDA Prover: ${await priceFeedAdapter.getProver()}`);
    
    try {
      const lastBatchHeight = await priceFeedAdapter.getLastBatchHeight();
      console.log(`Last Batch Height: ${lastBatchHeight}`);
    } catch (error: any) {
      console.log(`Last Batch Height: Unable to fetch (${error.message})`);
    }

    // Mock result for demonstration
    console.log("\n🧪 Mock Result Verification Demo:");
    console.log("----------------------------------");
    
    // Create a mock result for testing
    const mockPrice = ethers.parseUnits("50000", 8); // $50,000 with 8 decimals
    const mockTimestamp = Math.floor(Date.now() / 1000);
    
    const mockResult = {
      drId: "0x1234567890123456789012345678901234567890123456789012345678901234",
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

    const mockBatchHeight = 100;
    const mockMerkleProof = [
      "0x1234567890123456789012345678901234567890123456789012345678901234",
      "0x5678901234567890123456789012345678901234567890123456789012345678"
    ];

    console.log("\n🔍 Testing result verification (view function):");
    try {
      const [isValid, batchSender] = await priceFeedAdapter.verifyResult(
        mockResult,
        mockBatchHeight,
        mockMerkleProof
      );
      console.log(`   Verification result: ${isValid ? "✅ Valid" : "❌ Invalid"}`);
      console.log(`   Batch sender: ${batchSender}`);
    } catch (error: any) {
      console.log(`   ❌ Verification failed: ${error.message}`);
    }

    console.log("\n💱 Testing price decoding:");
    try {
      const price = await priceFeedAdapter.decodePriceResult(mockResult.result);
      console.log(`   Decoded price: $${ethers.formatUnits(price, 8)}`);
      console.log(`   Raw price value: ${price.toString()}`);
    } catch (error: any) {
      console.log(`   ❌ Price decoding failed: ${error.message}`);
    }

    console.log("\n📡 Testing result submission (with events):");
    try {
      // Set up event listeners
      console.log("   Setting up event listeners...");
      
             const resultVerifiedPromise = new Promise((resolve, reject) => {
         const timeout = setTimeout(() => reject(new Error("Event timeout")), 5000);
         
         // Set up event listeners using getEvent
         const resultVerifiedFilter = priceFeedAdapter.getEvent("ResultVerified");
         const verificationFailedFilter = priceFeedAdapter.getEvent("VerificationFailed");
         
         priceFeedAdapter.once(resultVerifiedFilter, (requestId, symbol, price, batchHeight, batchSender) => {
           clearTimeout(timeout);
           resolve({ requestId, symbol, price, batchHeight, batchSender });
         });
         
         priceFeedAdapter.once(verificationFailedFilter, (requestId, reason) => {
           clearTimeout(timeout);
           reject(new Error(`Verification failed: ${reason}`));
         });
       });

      // Submit the result
      console.log("   Submitting result...");
      const tx = await priceFeedAdapter.submitResult(mockResult, mockBatchHeight, mockMerkleProof);
      console.log(`   📤 Transaction sent: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Transaction confirmed in block ${receipt?.blockNumber}`);

      // Wait for events
      try {
        const eventData = await resultVerifiedPromise as any;
        console.log("   🎉 ResultVerified event received:");
        console.log(`     Request ID: ${eventData.requestId}`);
        console.log(`     Symbol: ${eventData.symbol}`);
        console.log(`     Price: $${ethers.formatUnits(eventData.price, 8)}`);
        console.log(`     Batch Height: ${eventData.batchHeight}`);
        console.log(`     Batch Sender: ${eventData.batchSender}`);
      } catch (eventError: any) {
        console.log(`   ⚠️  Event handling: ${eventError.message}`);
      }

    } catch (error: any) {
      console.log(`   ❌ Submission failed: ${error.message}`);
    }

    console.log("\n🔧 Testing owner functions:");
    try {
      const currentProver = await priceFeedAdapter.getProver();
      console.log(`   Current prover: ${currentProver}`);
      
      // Only test if we're the owner
      const owner = await priceFeedAdapter.owner();
      if (signer.address.toLowerCase() === owner.toLowerCase()) {
        console.log("   ✅ You are the owner - owner functions available");
      } else {
        console.log("   ℹ️  You are not the owner - owner functions restricted");
      }
    } catch (error: any) {
      console.log(`   ❌ Owner function test failed: ${error.message}`);
    }

    console.log("\n✅ Demo completed successfully!");
    console.log("\n💡 Key Features Demonstrated:");
    console.log("   1. 🔍 Result verification using SEDA prover");
    console.log("   2. 📡 Event emission for verification results");
    console.log("   3. 💱 Price data decoding from oracle results");
    console.log("   4. ⚙️  Prover management and configuration");
    console.log("   5. 📊 Batch height monitoring");
    
    console.log("\n🚀 Next Steps:");
    console.log("   1. In production, use real SEDA prover addresses");
    console.log("   2. Submit actual oracle results with valid Merkle proofs");
    console.log("   3. Set up event listeners for verification monitoring");
    console.log("   4. Integrate with external systems via verification events");

    console.log("\n🏗️ Architecture Notes:");
    console.log("   • This is a STATELESS verification contract");
    console.log("   • No data storage - only event emission");
    console.log("   • Perfect for event-driven architectures");
    console.log("   • Minimal gas costs for verification");

  } catch (error: any) {
    console.error("❌ Error during interaction:");
    console.error(error.message);
    if (error.code === "CALL_EXCEPTION") {
      console.error("💡 Make sure the contract is deployed at the specified address");
    }
  }
}

// Execute the script
main()
  .then(() => {
    console.log("\n🏁 Script execution completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  }); 