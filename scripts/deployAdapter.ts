import { ethers } from "hardhat";

async function main() {
  console.log("Deploying PriceFeedAdapter contract...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    (await deployer.provider.getBalance(deployer.address)).toString(),
  );

  // Configure deployment parameters based on network
  const network = await ethers.provider.getNetwork();
  console.log(
    "Deploying to network:",
    network.name,
    "Chain ID:",
    network.chainId,
  );

  let sedaProverAddress: string;

  // Network-specific configurations
  switch (network.chainId) {
    case 31337n: {
      // Hardhat local network
      console.log("Deploying to local hardhat network...");
      console.log("Deploying mock SEDA prover first...");

      // Deploy mock prover for testing
      const MockSedaProver = await ethers.getContractFactory("MockSedaProver");
      const mockProver = await MockSedaProver.deploy();
      await mockProver.waitForDeployment();
      sedaProverAddress = await mockProver.getAddress();

      console.log("✅ Mock SEDA Prover deployed to:", sedaProverAddress);
      break;
    }

    case 11155111n: // Sepolia testnet
      console.log("Deploying to Sepolia testnet...");
      sedaProverAddress =
        process.env.SEPOLIA_SEDA_PROVER ||
        "0x0000000000000000000000000000000000000000";
      break;

    case 137n: // Polygon mainnet
      console.log("Deploying to Polygon mainnet...");
      sedaProverAddress =
        process.env.POLYGON_SEDA_PROVER ||
        "0x0000000000000000000000000000000000000000";
      break;

    default:
      console.warn(
        "Unknown network, using environment variable or deploying mock",
      );

      if (process.env.SEDA_PROVER_ADDRESS) {
        sedaProverAddress = process.env.SEDA_PROVER_ADDRESS;
      } else {
        // Deploy mock prover as fallback
        const MockSedaProver =
          await ethers.getContractFactory("MockSedaProver");
        const mockProver = await MockSedaProver.deploy();
        await mockProver.waitForDeployment();
        sedaProverAddress = await mockProver.getAddress();
        console.log("✅ Mock SEDA Prover deployed to:", sedaProverAddress);
      }
  }

  // Validate addresses
  if (sedaProverAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      "❌ SEDA Prover address not configured. Please set environment variables or deploy to local network.",
    );
  }

  console.log("Using SEDA Prover at:", sedaProverAddress);

  // Deploy the PriceFeedAdapter contract
  const PriceFeedAdapter = await ethers.getContractFactory("PriceFeedAdapter");
  const priceFeedAdapter = await PriceFeedAdapter.deploy(
    sedaProverAddress,
    deployer.address, // Owner is the deployer
  );

  await priceFeedAdapter.waitForDeployment();
  const contractAddress = await priceFeedAdapter.getAddress();

  console.log("✅ PriceFeedAdapter deployed to:", contractAddress);
  console.log("📊 Deployment details:");
  console.log("  - SEDA Prover:", sedaProverAddress);
  console.log("  - Owner:", deployer.address);

  // Verify deployment
  console.log("\n🔍 Verifying deployment...");
  const deployedProver = await priceFeedAdapter.getProver();
  const owner = await priceFeedAdapter.owner();

  console.log("✅ Verification complete:");
  console.log("  - Prover address:", deployedProver);
  console.log("  - Owner:", owner);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contractAddress,
    sedaProverAddress,
    owner: deployer.address,
    deploymentTime: new Date().toISOString(),
    deployer: deployer.address,
    contractType: "PriceFeedAdapter",
  };

  console.log("\n📄 Deployment info (save this for reference):");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  if (network.chainId !== 31337n) {
    console.log("\n🔗 Next steps:");
    console.log("1. Verify the contract on the block explorer");
    console.log("2. Register data requests using registerDataRequest()");
    console.log(
      "3. Submit results using submitResult() with proper Merkle proofs",
    );
    console.log("4. Query verified prices using getLatestPrice()");

    console.log("\n💡 Usage examples:");
    console.log("// Register a request");
    console.log(`await adapter.registerDataRequest(requestId, "BTC/USD");`);
    console.log("");
    console.log("// Submit a verified result");
    console.log(
      `await adapter.submitResult(result, batchHeight, merkleProof);`,
    );
    console.log("");
    console.log("// Get latest price");
    console.log(
      `const [price, timestamp, batchHeight, isValid] = await adapter.getLatestPrice("BTC/USD");`,
    );
  } else {
    console.log("\n🧪 Local testing environment ready!");
    console.log("You can now test the PriceFeedAdapter with the mock prover.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
