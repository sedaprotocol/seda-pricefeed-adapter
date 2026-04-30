import "dotenv/config";
import { ethers } from "hardhat";
import { encodeSignedPayloadFromFastDataResult } from "../test/sedaSignedPayload";
import type { SedaPythAdapter } from "../typechain-types/contracts/SedaPythAdapter";

const EXEC_PROGRAM_ID =
  "0xfbec1463d982f85bfe1f316015e401b943f8ca6ec9c644944104d15e32c1fba7";
const SEDA_PYTH_ADAPTER_ADDRESS = "0xDc2c35fE5c350c4F8633002EA77e1eD97409d049";
const USDC_PYTH_ID =
  "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

async function main() {
  const apiKey = process.env.SEDA_FAST_API_KEY;
  if (!apiKey) throw new Error("SEDA_FAST_API_KEY not set");

  // 1. Execute via SEDA FAST
  console.log("Executing oracle program via SEDA FAST...");
  const res = await fetch("https://fast-api.testnet.seda.xyz/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      execProgramId: EXEC_PROGRAM_ID.slice(2),
      execInputs: JSON.stringify({ ids: [USDC_PYTH_ID], network: "testnet" }),
    }),
  });

  if (!res.ok)
    throw new Error(
      `API error ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );

  const apiData = await res.json();
  const dr = apiData.data.dataResult;

  console.log(`  drId: ${dr.drId}`);
  console.log(`  exitCode: ${dr.exitCode}`);

  // 2. Build signed payload (FastProver accepts raw FAST v byte; on-chain normalization)
  const signedPayload = encodeSignedPayloadFromFastDataResult(
    dr,
    apiData.data.signature,
  );

  // 3. Submit to SedaPythAdapter
  console.log("Submitting to SedaPythAdapter...");
  const SedaPythAdapter = await ethers.getContractFactory("SedaPythAdapter");
  const adapter = SedaPythAdapter.attach(
    SEDA_PYTH_ADAPTER_ADDRESS,
  ) as unknown as SedaPythAdapter;

  const tx = await adapter.updatePriceFeeds([signedPayload]);
  const receipt = await tx.wait();
  console.log(`  tx: ${tx.hash}`);
  console.log(`  gas: ${receipt?.gasUsed.toString()}`);

  // 4. Read the price (feedId = keccak256(abi.encode(drId, symbolId)))
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const symbolId = `0x${USDC_PYTH_ID}`;
  const drIdHex = dr.drId.startsWith("0x") ? dr.drId : `0x${dr.drId}`;
  const feedId = ethers.keccak256(
    abiCoder.encode(["bytes32", "bytes32"], [drIdHex, symbolId]),
  );

  const price = await adapter.getPriceUnsafe(feedId);
  console.log(`\nUSDC/USD Price Feed (feedId: ${feedId}):`);
  console.log(`  price:       ${price.price}`);
  console.log(`  conf:        ${price.conf}`);
  console.log(`  expo:        ${price.expo}`);
  console.log(
    `  publishTime: ${price.publishTime} (${new Date(Number(price.publishTime) * 1000).toISOString()})`,
  );

  const ema = await adapter.getEmaPriceUnsafe(feedId);
  console.log(`  emaPrice:    ${ema.price}`);
  console.log(`  emaConf:     ${ema.conf}`);

  console.log("\nE2E test passed!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
