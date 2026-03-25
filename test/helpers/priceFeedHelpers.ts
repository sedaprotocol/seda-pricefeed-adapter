import type { ContractTransactionResponse, Wallet } from "ethers";
import { ethers } from "hardhat";

// ABI type for SedaDataTypes.Result
const RESULT_ABI_TYPE =
  "tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload)";

const SIGNED_PAYLOAD_ABI_TYPE = "tuple(bytes data, bytes signature)";

// SEDA protocol version (must match SedaDataTypes.VERSION)
const SEDA_VERSION = "0.0.1";

/**
 * Computes deriveResultId matching SedaDataTypes.deriveResultId in Solidity.
 */
export function deriveResultId(result: {
  drId: string;
  gasUsed: bigint | number;
  blockHeight: bigint | number;
  blockTimestamp: bigint | number;
  consensus: boolean;
  exitCode: number;
  version: string;
  result: string;
  paybackAddress: string;
  sedaPayload: string;
}): string {
  const versionHash = ethers.keccak256(ethers.toUtf8Bytes(result.version));
  const drIdBytes = ethers.getBytes(result.drId);
  const consensusByte = result.consensus ? "0x01" : "0x00";
  const exitCodeByte = ethers.zeroPadValue(
    ethers.toBeHex(result.exitCode),
    1,
  );
  const resultHash = ethers.keccak256(result.result);
  const blockHeightBytes = ethers.zeroPadValue(
    ethers.toBeHex(BigInt(result.blockHeight)),
    8,
  );
  const blockTimestampBytes = ethers.zeroPadValue(
    ethers.toBeHex(BigInt(result.blockTimestamp)),
    8,
  );
  const gasUsedBytes = ethers.zeroPadValue(
    ethers.toBeHex(BigInt(result.gasUsed)),
    16,
  );
  const paybackHash = ethers.keccak256(result.paybackAddress);
  const sedaPayloadHash = ethers.keccak256(result.sedaPayload);

  return ethers.keccak256(
    ethers.concat([
      versionHash,
      drIdBytes,
      consensusByte,
      exitCodeByte,
      resultHash,
      blockHeightBytes,
      blockTimestampBytes,
      gasUsedBytes,
      paybackHash,
      sedaPayloadHash,
    ]),
  );
}

/**
 * Encodes a price + timestamp into the raw 64-byte oracle output format:
 * [16 zero bytes][16-byte u128 price BE][24 zero bytes][8-byte u64 timestamp BE]
 */
export function encodeRawOracleOutput(
  price: bigint,
  timestamp: number,
): string {
  const pricePadded = ethers.zeroPadValue(ethers.toBeHex(price), 32);
  const timestampPadded = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
  return ethers.concat([pricePadded, timestampPadded]);
}

/**
 * Computes the drId for a given set of request parameters.
 * This must match what SEDA FAST uses (SedaDataTypes.deriveRequestId).
 */
export function computeDrId(params: {
  execProgramId: string;
  tallyProgramId: string;
  execInputs: string;
  tallyInputs: string;
  execGasLimit: bigint;
  tallyGasLimit: bigint;
  replicationFactor: number;
  consensusFilter: string;
  gasPrice: bigint;
  memo: string;
}): string {
  return ethers.keccak256(
    ethers.concat([
      ethers.keccak256(ethers.toUtf8Bytes(SEDA_VERSION)),
      params.execProgramId,
      ethers.keccak256(params.execInputs),
      ethers.zeroPadValue(ethers.toBeHex(params.execGasLimit), 8),
      params.tallyProgramId,
      ethers.keccak256(params.tallyInputs),
      ethers.zeroPadValue(ethers.toBeHex(params.tallyGasLimit), 8),
      ethers.zeroPadValue(ethers.toBeHex(params.replicationFactor), 2),
      ethers.keccak256(params.consensusFilter),
      ethers.zeroPadValue(ethers.toBeHex(params.gasPrice), 16),
      ethers.keccak256(ethers.toUtf8Bytes(params.memo)),
    ]),
  );
}

// Helper function to submit a price update
export async function submitPriceUpdate(
  adapter: {
    updatePriceFeeds: (data: string[]) => Promise<ContractTransactionResponse>;
  },
  trustedKey: Wallet,
  drId: string,
  price: bigint,
  conf: bigint,
  publishTime: number = Math.floor(Date.now() / 1000),
) {
  const updateData = await createValidUpdateData(
    trustedKey,
    drId,
    price,
    conf,
    publishTime,
  );
  await adapter.updatePriceFeeds([updateData]);
}

// Helper function to create valid update data
export async function createValidUpdateData(
  trustedKey: Wallet,
  drId: string,
  price: bigint,
  conf: bigint,
  publishTime: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  // Encode price + timestamp into raw 64-byte oracle output
  const rawResult = encodeRawOracleOutput(price, publishTime);

  const result = {
    drId,
    gasUsed: 100000,
    blockHeight: 12345,
    blockTimestamp: publishTime,
    consensus: true,
    exitCode: 0,
    version: SEDA_VERSION,
    result: rawResult,
    paybackAddress: "0x",
    sedaPayload: "0x",
  };

  // ABI-encode just the Result (no more PriceUpdateBatch wrapper)
  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    [RESULT_ABI_TYPE],
    [result],
  );

  // Sign with deriveResultId (matches what SEDA FAST signs)
  const resultIdHash = deriveResultId(result);
  const signature = trustedKey.signingKey.sign(resultIdHash);
  const serializedSignature = ethers.Signature.from(signature).serialized;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_PAYLOAD_ABI_TYPE],
    [{ data, signature: serializedSignature }],
  );
}

// Helper function to create invalid exit code payload
export async function createInvalidExitCodePayload(
  trustedKey: Wallet,
  drId: string,
): Promise<string> {
  const rawResult = encodeRawOracleOutput(
    50000n,
    Math.floor(Date.now() / 1000),
  );

  const result = {
    drId,
    gasUsed: 100000,
    blockHeight: 12345,
    blockTimestamp: Math.floor(Date.now() / 1000),
    consensus: true,
    exitCode: 1, // Invalid exit code
    version: SEDA_VERSION,
    result: rawResult,
    paybackAddress: "0x",
    sedaPayload: "0x",
  };

  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    [RESULT_ABI_TYPE],
    [result],
  );

  const resultIdHash = deriveResultId(result);
  const signature = trustedKey.signingKey.sign(resultIdHash);
  const serializedSignature = ethers.Signature.from(signature).serialized;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_PAYLOAD_ABI_TYPE],
    [{ data, signature: serializedSignature }],
  );
}

// Helper function to create empty batch payload (0 feeds, 0-length result)
export async function createEmptyBatchPayload(
  trustedKey: Wallet,
  drId: string,
): Promise<string> {
  const result = {
    drId,
    gasUsed: 100000,
    blockHeight: 12345,
    blockTimestamp: Math.floor(Date.now() / 1000),
    consensus: true,
    exitCode: 0,
    version: SEDA_VERSION,
    result: "0x",
    paybackAddress: "0x",
    sedaPayload: "0x",
  };

  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    [RESULT_ABI_TYPE],
    [result],
  );

  const resultIdHash = deriveResultId(result);
  const signature = trustedKey.signingKey.sign(resultIdHash);
  const serializedSignature = ethers.Signature.from(signature).serialized;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SIGNED_PAYLOAD_ABI_TYPE],
    [{ data, signature: serializedSignature }],
  );
}

// Helper function to compute asset ID (GLOBAL price ID)
export function computeAssetId(
  execProgramId: string,
  tallyProgramId: string,
  rawId: string,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32"],
      [execProgramId, tallyProgramId, rawId],
    ),
  );
}

// Helper function to create a past timestamp
export function createPastTimestamp(secondsAgo: number = 10): number {
  return Math.floor(Date.now() / 1000) - secondsAgo;
}
