import { ethers, network, upgrades } from "hardhat";

// SEDA FAST testnet signer
const SEDA_FAST_ADDRESS = "0x593CEBb17C116D48d69b108711f2D8C419ed8758";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(
    `\nDeploying to ${network.name} (chain ${network.config.chainId})`,
  );
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

  // 2. Deploy SedaPythAdapter
  console.log("Deploying SedaPythAdapter...");
  const SedaPythAdapter = await ethers.getContractFactory("SedaPythAdapter");
  const sedaPythAdapter = await upgrades.deployProxy(
    SedaPythAdapter,
    [proverAddress, deployer.address],
    { initializer: "initialize" },
  );
  await sedaPythAdapter.waitForDeployment();
  const adapterAddress = await sedaPythAdapter.getAddress();
  console.log(`  SedaPythAdapter proxy: ${adapterAddress}`);

  // 3. Register SEDA FAST testnet public key as trusted signer
  console.log(`\nRegistering SEDA FAST key: ${SEDA_FAST_ADDRESS}`);
  const tx1 = await fastProver.addTrustedKey(SEDA_FAST_ADDRESS);
  await tx1.wait();
  console.log("  Trusted key added.");

  // Summary
  console.log("\n========== Deployment Complete ==========");
  console.log(`FastProver:      ${proverAddress}`);
  console.log(`SedaPythAdapter: ${adapterAddress}`);
  console.log(`Trusted key:     ${SEDA_FAST_ADDRESS}`);
  console.log("==========================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
