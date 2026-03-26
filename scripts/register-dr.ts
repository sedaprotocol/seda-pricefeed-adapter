import "dotenv/config";
import { ethers } from "hardhat";

// Oracle program config (pyth-hermes-fast deployed to SEDA testnet)
const EXEC_PROGRAM_ID = "0xfbec1463d982f85bfe1f316015e401b943f8ca6ec9c644944104d15e32c1fba7";
const TALLY_PROGRAM_ID = EXEC_PROGRAM_ID;

// Deployed contract addresses on Base Sepolia
const FAST_ADAPTER_ADDRESS = "0xDc2c35fE5c350c4F8633002EA77e1eD97409d049";

// USDC/USD Pyth feed ID (no 0x prefix for the API call)
const USDC_PYTH_ID = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

async function main() {
  const apiKey = process.env.SEDA_FAST_API_KEY;
  if (!apiKey) {
    throw new Error("SEDA_FAST_API_KEY not set in .env");
  }

  // 1. Call SEDA FAST testnet API to execute the oracle program
  const execInputs = JSON.stringify({
    ids: [USDC_PYTH_ID],
    network: "testnet",
  });

  console.log("Calling SEDA FAST API...");
  console.log(`  execProgramId: ${EXEC_PROGRAM_ID.slice(2)}`);
  console.log(`  execInputs: ${execInputs}`);

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SEDA FAST API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as any;
  console.log("\nSEDA FAST response:");
  console.log(JSON.stringify(data, null, 2));

  const drId = "0x" + data.data.dataResult.drId;
  console.log(`\ndrId: ${drId}`);

  // 2. Register the drId on the FastAdapter
  const FastAdapter = await ethers.getContractFactory("FastAdapter");
  const adapter = FastAdapter.attach(FAST_ADAPTER_ADDRESS);

  const isRegistered = await adapter.isDataRequestRegistered(drId);
  if (isRegistered) {
    console.log("drId already registered, skipping.");
  } else {
    console.log("Registering data request...");
    const tx = await adapter.registerDataRequest(drId, {
      execProgramId: EXEC_PROGRAM_ID,
      tallyProgramId: TALLY_PROGRAM_ID,
    });
    await tx.wait();
    console.log(`Registered! tx: ${tx.hash}`);
  }

  // 3. Verify
  const config = await adapter.getDataRequestProgramConfig(drId);
  console.log("\nRegistered config:");
  console.log(`  execProgramId:  ${config.execProgramId}`);
  console.log(`  tallyProgramId: ${config.tallyProgramId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
