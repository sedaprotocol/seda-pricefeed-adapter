import { ethers } from "hardhat";

async function main() {
  console.log("🔄 SEDA Price Feed Consumer Interaction Demo");
  console.log("==========================================");

  // Get contract address from command line or use a default for testing
  const contractAddress = process.argv[2] || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  
  console.log(`📍 Contract Address: ${contractAddress}`);

  try {
    // Connect to the contract
    const priceFeedConsumer = await ethers.getContractAt("PriceFeedConsumer", contractAddress);
    const [signer] = await ethers.getSigners();
    
    console.log(`👤 Using account: ${signer.address}`);
    console.log(`💰 Account balance: ${ethers.formatEther(await signer.provider.getBalance(signer.address))} ETH`);

    // Display contract info
    console.log("\n📊 Contract Information:");
    console.log("------------------------");
    console.log(`Owner: ${await priceFeedConsumer.owner()}`);
    console.log(`SEDA Prover: ${await priceFeedConsumer.getSedaProver()}`);
    console.log(`Default Exec Program ID: ${await priceFeedConsumer.defaultExecProgramId()}`);
    console.log(`Default Tally Program ID: ${await priceFeedConsumer.defaultTallyProgramId()}`);
    console.log(`Default Gas Price: ${await priceFeedConsumer.defaultGasPrice()}`);
    console.log(`Default Replication Factor: ${await priceFeedConsumer.defaultReplicationFactor()}`);

    // Test symbols to request prices for
    const symbols = ["BTC/USD", "ETH/USD", "MATIC/USD"];

    console.log("\n🔄 Requesting Price Data:");
    console.log("-------------------------");

    for (const symbol of symbols) {
      try {
        console.log(`\n📈 Requesting price for ${symbol}...`);
        
        // Check if we already have data for this symbol
        const [existingPrice, timestamp, isValid] = await priceFeedConsumer.getLatestPrice(symbol);
        if (isValid) {
          console.log(`   ✅ Already have data: $${ethers.formatUnits(existingPrice, 8)} (${new Date(Number(timestamp) * 1000)})`);
          continue;
        }

        // Request price data
        const tx = await priceFeedConsumer.requestPrice(symbol);
        console.log(`   📤 Transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`   ✅ Transaction confirmed in block ${receipt?.blockNumber}`);

        // Extract request ID from events
        let requestId = "";
        for (const log of receipt?.logs || []) {
          try {
            const parsed = priceFeedConsumer.interface.parseLog(log);
            if (parsed?.name === "PriceRequested") {
              requestId = parsed.args[0];
              console.log(`   🆔 Request ID: ${requestId}`);
              break;
            }
          } catch {
            continue;
          }
        }

        // Check request status
        if (requestId) {
          const isRequestFulfilled = await priceFeedConsumer.isRequestFulfilled(requestId);
          const requestSymbol = await priceFeedConsumer.getRequestSymbol(requestId);
          console.log(`   📋 Request Status: ${isRequestFulfilled ? "Fulfilled" : "Pending"}`);
          console.log(`   🏷️  Request Symbol: ${requestSymbol}`);
        }

      } catch (error: any) {
        console.log(`   ❌ Error requesting ${symbol}: ${error.message}`);
      }
    }

    // Display current price data
    console.log("\n📊 Current Price Data:");
    console.log("----------------------");
    const pricesData = await priceFeedConsumer.getMultipleLatestPrices(symbols);
    
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const data = pricesData[i];
      
      if (data.isValid) {
        const priceFormatted = ethers.formatUnits(data.price, 8);
        const timestampFormatted = new Date(Number(data.timestamp) * 1000).toLocaleString();
        console.log(`   ${symbol}: $${priceFormatted} (${timestampFormatted})`);
      } else {
        console.log(`   ${symbol}: No data available`);
      }
    }

    // Example of listening to events (for demonstration)
    console.log("\n👂 Setting up event listeners...");
    console.log("(This would normally run continuously in a real application)");

    // Set up event listeners (in a real app, these would run continuously)
    // For demonstration purposes, we'll just show how to set them up
    console.log("   Event listeners for PriceRequested and PriceReceived can be set up");
    console.log("   to monitor oracle activity in real-time.");

    console.log("\n✅ Demo completed successfully!");
    console.log("\n💡 Next Steps:");
    console.log("   1. In a real environment, oracle results would be posted by SEDA network");
    console.log("   2. You can call postResult() to simulate oracle responses");
    console.log("   3. Monitor events to track price updates in real-time");
    console.log("   4. Use getLatestPrice() to retrieve current price data");

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