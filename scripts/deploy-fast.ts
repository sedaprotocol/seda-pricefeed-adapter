import { ethers, upgrades, network } from "hardhat";

// USDC/USD feed config
const EXEC_PROGRAM_ID = "0xb5ace2e5ad3bd8014b15310cb6f6d969c4af25aa527d8051209f139b191121de";
const TALLY_PROGRAM_ID = EXEC_PROGRAM_ID;
const USDC_RAW_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const USDC_EXPO = -8;

// SEDA FAST testnet signer
const SEDA_FAST_ADDRESS = "0x593CEBb17C116D48d69b108711f2D8C419ed8758";

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
  console.log(`\nRegistering SEDA FAST key: ${SEDA_FAST_ADDRESS}`);
  const tx1 = await fastProver.addTrustedKey(SEDA_FAST_ADDRESS);
  await tx1.wait();
  console.log("  Trusted key added.");

  // 4. Fetch the drId from SEDA FAST API by executing the oracle program
  console.log("\nFetching drId from SEDA FAST API...");
  const apiKey = process.env.SEDA_FAST_API_KEY;
  if (!apiKey) {
    console.log("  SEDA_FAST_API_KEY not set, skipping drId registration.");
    console.log("  You'll need to register the drId manually via registerDataRequest().");
  } else {
    const execInputs = JSON.stringify({
      pyth_id: USDC_RAW_ID,
      exponent: 8,
    });
    const res = await fetch("https://fast-api.testnet.seda.xyz/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        execProgramId: EXEC_PROGRAM_ID.slice(2),
        execInputs,
      }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      const drId = "0x" + data.data.dataResult.drId;
      console.log(`  drId: ${drId}`);

      // 5. Register the data request with feed config
      console.log("  Registering data request...");
      const tx2 = await fastAdapter.registerDataRequest(
        drId,
        { execProgramId: EXEC_PROGRAM_ID, tallyProgramId: TALLY_PROGRAM_ID },
        [{ rawId: USDC_RAW_ID, expo: USDC_EXPO }],
      );
      await tx2.wait();
      console.log("  Data request registered!");
    } else {
      const text = await res.text();
      console.log(`  API error ${res.status}: ${text.slice(0, 200)}`);
      console.log("  You'll need to register the drId manually.");
    }
  }

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
