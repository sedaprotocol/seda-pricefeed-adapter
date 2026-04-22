import "dotenv/config";
import { ethers } from "hardhat";

const EXEC_PROGRAM_ID =
  "0xfbec1463d982f85bfe1f316015e401b943f8ca6ec9c644944104d15e32c1fba7";
const FAST_ADAPTER_ADDRESS = "0xDc2c35fE5c350c4F8633002EA77e1eD97409d049";
const USDC_PYTH_ID =
  "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

const RESULT_ABI_TYPE =
  "tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload)";
const SIGNED_PAYLOAD_ABI_TYPE = "tuple(bytes data, bytes signature)";

/** Normalize ECDSA v from 0/1 to 27/28 for OpenZeppelin ECDSA.recover */
function normalizeSignature(hexSig: string): string {
  const sigBytes = ethers.getBytes(hexSig);
  if (sigBytes[64] < 27) sigBytes[64] += 27;
  return ethers.hexlify(sigBytes);
}

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
  const rawSig = `0x${apiData.data.signature}`;

  console.log(`  drId: ${dr.drId}`);
  console.log(`  exitCode: ${dr.exitCode}`);

  // 2. Build signed payload
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const result = {
    drId: `0x${dr.drId}`,
    gasUsed: BigInt(dr.gasUsed),
    blockHeight: BigInt(dr.blockHeight),
    blockTimestamp: BigInt(dr.blockTimestamp),
    consensus: dr.consensus,
    exitCode: dr.exitCode,
    version: dr.version,
    result: `0x${dr.result}`,
    paybackAddress: dr.paybackAddress ? `0x${dr.paybackAddress}` : "0x",
    sedaPayload: dr.sedaPayload ? `0x${dr.sedaPayload}` : "0x",
  };

  const encodedResult = abiCoder.encode([RESULT_ABI_TYPE], [result]);
  const signature = normalizeSignature(rawSig);

  const signedPayload = abiCoder.encode(
    [SIGNED_PAYLOAD_ABI_TYPE],
    [{ data: encodedResult, signature }],
  );

  // 3. Submit to FastAdapter
  console.log("Submitting to FastAdapter...");
  const FastAdapter = await ethers.getContractFactory("FastAdapter");
  const adapter = FastAdapter.attach(FAST_ADAPTER_ADDRESS);

  const tx = await adapter.updatePriceFeeds([signedPayload]);
  const receipt = await tx.wait();
  console.log(`  tx: ${tx.hash}`);
  console.log(`  gas: ${receipt?.gasUsed.toString()}`);

  // 4. Read the price (feedId = keccak256(abi.encode(drId, symbolId)))
  const symbolId = `0x${USDC_PYTH_ID}`;
  const feedId = ethers.keccak256(
    abiCoder.encode(["bytes32", "bytes32"], [result.drId, symbolId]),
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
