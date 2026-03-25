import { ethers, upgrades, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\nDeploying to ${network.name} (chain ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    throw new Error("Deployer has no ETH. Fund the wallet first.");
  }

  // 1. Deploy FastProver
  console.log("Deploying FastProver...");
  const FastProver = await ethers.getContractFactory("FastProver");
  const fastProver = await upgrades.deployProxy(
    FastProver,
    [deployer.address],
    { initializer: "initialize" },
  );
  await fastProver.waitForDeployment();
  const proverAddress = await fastProver.getAddress();
  console.log(`  FastProver proxy: ${proverAddress}`);

  // 2. Deploy FastAdapter
  console.log("Deploying FastAdapter...");
  const FastAdapter = await ethers.getContractFactory("FastAdapter");
  const fastAdapter = await upgrades.deployProxy(
    FastAdapter,
    [proverAddress, deployer.address],
    { initializer: "initialize" },
  );
  await fastAdapter.waitForDeployment();
  const adapterAddress = await fastAdapter.getAddress();
  console.log(`  FastAdapter proxy: ${adapterAddress}`);

  // 3. Register SEDA FAST testnet public key as trusted signer
  const SEDA_FAST_ADDRESS = "0x593CEBb17C116D48d69b108711f2D8C419ed8758";
  console.log(`\nRegistering SEDA FAST key: ${SEDA_FAST_ADDRESS}`);
  const tx1 = await fastProver.addTrustedKey(SEDA_FAST_ADDRESS);
  await tx1.wait();
  console.log("  Trusted key added.");

  // 4. Allow the USDC/USD oracle program
  const EXEC_PROGRAM_ID = "0xb5ace2e5ad3bd8014b15310cb6f6d969c4af25aa527d8051209f139b191121de";
  const TALLY_PROGRAM_ID = EXEC_PROGRAM_ID; // same program for exec and tally
  console.log(`\nAllowing program config:`);
  console.log(`  exec:  ${EXEC_PROGRAM_ID}`);
  console.log(`  tally: ${TALLY_PROGRAM_ID}`);
  const tx2 = await fastAdapter.setProgramConfig(EXEC_PROGRAM_ID, TALLY_PROGRAM_ID, true);
  await tx2.wait();
  console.log("  Program config allowed.");

  // Summary
  console.log("\n========== Deployment Complete ==========");
  console.log(`FastProver:  ${proverAddress}`);
  console.log(`FastAdapter: ${adapterAddress}`);
  console.log(`Trusted key: ${SEDA_FAST_ADDRESS}`);
  console.log(`Program:     ${EXEC_PROGRAM_ID}`);
  console.log("==========================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
