import { ethers } from "hardhat";

async function main() {
  console.log("Deploying PriceFeedConsumer contract...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // Configure deployment parameters based on network
  const network = await ethers.provider.getNetwork();
  console.log("Deploying to network:", network.name, "Chain ID:", network.chainId);

  let sedaProverAddress: string;
  let execProgramId: string;
  let tallyProgramId: string;

  // Network-specific configurations
  switch (network.chainId) {
    case 31337n: // Hardhat local network
      console.log("Deploying to local hardhat network...");
      // For local testing, you might want to deploy a mock SEDA prover first
      sedaProverAddress = "0x0000000000000000000000000000000000000001"; // Placeholder
      execProgramId = "0x0000000000000000000000000000000000000000000000000000000000000001";
      tallyProgramId = "0x0000000000000000000000000000000000000000000000000000000000000002";
      break;
    
    case 11155111n: // Sepolia testnet
      console.log("Deploying to Sepolia testnet...");
      // Replace with actual SEDA prover addresses for Sepolia
      sedaProverAddress = process.env.SEPOLIA_SEDA_PROVER || "0x0000000000000000000000000000000000000000";
      execProgramId = process.env.SEPOLIA_EXEC_PROGRAM_ID || "0x0000000000000000000000000000000000000000000000000000000000000001";
      tallyProgramId = process.env.SEPOLIA_TALLY_PROGRAM_ID || "0x0000000000000000000000000000000000000000000000000000000000000002";
      break;
    
    case 137n: // Polygon mainnet
      console.log("Deploying to Polygon mainnet...");
      // Replace with actual SEDA prover addresses for Polygon
      sedaProverAddress = process.env.POLYGON_SEDA_PROVER || "0x0000000000000000000000000000000000000000";
      execProgramId = process.env.POLYGON_EXEC_PROGRAM_ID || "0x0000000000000000000000000000000000000000000000000000000000000001";
      tallyProgramId = process.env.POLYGON_TALLY_PROGRAM_ID || "0x0000000000000000000000000000000000000000000000000000000000000002";
      break;
    
    default:
      console.warn("Unknown network, using default configuration");
      sedaProverAddress = "0x0000000000000000000000000000000000000000";
      execProgramId = "0x0000000000000000000000000000000000000000000000000000000000000001";
      tallyProgramId = "0x0000000000000000000000000000000000000000000000000000000000000002";
  }

  // Validate addresses
  if (sedaProverAddress === "0x0000000000000000000000000000000000000000") {
    console.warn("⚠️  WARNING: Using zero address for SEDA prover. This is only suitable for testing!");
  }

  // Deploy the contract
  const PriceFeedConsumer = await ethers.getContractFactory("PriceFeedConsumer");
  const priceFeedConsumer = await PriceFeedConsumer.deploy(
    sedaProverAddress,
    deployer.address, // Owner is the deployer
    execProgramId,
    tallyProgramId
  );

  await priceFeedConsumer.waitForDeployment();
  const contractAddress = await priceFeedConsumer.getAddress();

  console.log("✅ PriceFeedConsumer deployed to:", contractAddress);
  console.log("📊 Deployment details:");
  console.log("  - SEDA Prover:", sedaProverAddress);
  console.log("  - Owner:", deployer.address);
  console.log("  - Exec Program ID:", execProgramId);
  console.log("  - Tally Program ID:", tallyProgramId);

  // Verify deployment
  console.log("\n🔍 Verifying deployment...");
  const deployedProver = await priceFeedConsumer.getSedaProver();
  const owner = await priceFeedConsumer.owner();
  const defaultExecId = await priceFeedConsumer.defaultExecProgramId();
  const defaultTallyId = await priceFeedConsumer.defaultTallyProgramId();

  console.log("✅ Verification complete:");
  console.log("  - Prover address:", deployedProver);
  console.log("  - Owner:", owner);
  console.log("  - Default exec program ID:", defaultExecId);
  console.log("  - Default tally program ID:", defaultTallyId);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contractAddress,
    sedaProverAddress,
    owner: deployer.address,
    execProgramId,
    tallyProgramId,
    deploymentTime: new Date().toISOString(),
    deployer: deployer.address
  };

  console.log("\n📄 Deployment info (save this for reference):");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  if (network.chainId !== 31337n) {
    console.log("\n🔗 Next steps:");
    console.log("1. Verify the contract on the block explorer");
    console.log("2. Update the SEDA prover address if needed using updateDefaultPrograms()");
    console.log("3. Fund the contract with ETH for gas fees if planning to make requests");
    console.log("4. Test with a small price request");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 