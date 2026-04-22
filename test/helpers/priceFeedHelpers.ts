import type { ContractTransactionResponse, Wallet } from "ethers";
import { ethers } from "hardhat";

// ABI type for SedaDataTypes.Result
const RESULT_ABI_TYPE =
  "tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload)";

const SIGNED_PAYLOAD_ABI_TYPE = "tuple(bytes data, bytes signature)";

// ABI type for SedaPriceUpdate[] — matches the oracle program's tally output
const SEDA_PRICE_UPDATE_ARRAY_TYPE =
  "tuple(bytes32 symbolId,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]";

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
  const exitCodeByte = ethers.zeroPadValue(ethers.toBeHex(result.exitCode), 1);
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
 * ABI-encodes a SedaPriceUpdate[] — matching the oracle program's tally output.
 */
export function encodeSedaPriceUpdates(
  updates: Array<{
    symbolId: string;
    priceInfo: {
      publishTime: number;
      expo: number;
      price: bigint;
      conf: bigint;
      emaPrice: bigint;
      emaConf: bigint;
    };
  }>,
): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    [SEDA_PRICE_UPDATE_ARRAY_TYPE],
    [updates],
  );
}

// Helper function to submit a price update
export async function submitPriceUpdate(
  adapter: {
    updatePriceFeeds: (data: string[]) => Promise<ContractTransactionResponse>;
  },
  trustedKey: Wallet,
  drId: string,
  symbolId: string,
  price: bigint,
  conf: bigint,
  publishTime: number = Math.floor(Date.now() / 1000),
) {
  const updateData = await createValidUpdateData(
    trustedKey,
    drId,
    symbolId,
    price,
    conf,
    publishTime,
  );
  await adapter.updatePriceFeeds([updateData]);
}

// Helper function to create valid update data with ABI-encoded SedaPriceUpdate[]
export async function createValidUpdateData(
  trustedKey: Wallet,
  drId: string,
  symbolId: string,
  price: bigint,
  conf: bigint,
  publishTime: number = Math.floor(Date.now() / 1000),
  expo: number = -8,
): Promise<string> {
  const resultBytes = encodeSedaPriceUpdates([
    {
      symbolId,
      priceInfo: {
        publishTime,
        expo,
        price,
        conf,
        emaPrice: price,
        emaConf: conf,
      },
    },
  ]);

  const result = {
    drId,
    gasUsed: 100000,
    blockHeight: 0,
    blockTimestamp: publishTime,
    consensus: true,
    exitCode: 0,
    version: SEDA_VERSION,
    result: resultBytes,
    paybackAddress: "0x",
    sedaPayload: "0x",
  };

  return encodeAndSign(result, trustedKey);
}

// Helper function to create invalid exit code payload
export async function createInvalidExitCodePayload(
  trustedKey: Wallet,
  drId: string,
  symbolId: string,
): Promise<string> {
  const resultBytes = encodeSedaPriceUpdates([
    {
      symbolId,
      priceInfo: {
        publishTime: Math.floor(Date.now() / 1000),
        expo: -8,
        price: 50000n,
        conf: 100n,
        emaPrice: 50000n,
        emaConf: 100n,
      },
    },
  ]);

  const result = {
    drId,
    gasUsed: 100000,
    blockHeight: 0,
    blockTimestamp: Math.floor(Date.now() / 1000),
    consensus: true,
    exitCode: 1, // Invalid exit code
    version: SEDA_VERSION,
    result: resultBytes,
    paybackAddress: "0x",
    sedaPayload: "0x",
  };

  return encodeAndSign(result, trustedKey);
}

// Helper function to create empty batch payload (0 feeds)
export async function createEmptyBatchPayload(
  trustedKey: Wallet,
  drId: string,
): Promise<string> {
  const resultBytes = encodeSedaPriceUpdates([]); // Empty array

  const result = {
    drId,
    gasUsed: 100000,
    blockHeight: 0,
    blockTimestamp: Math.floor(Date.now() / 1000),
    consensus: true,
    exitCode: 0,
    version: SEDA_VERSION,
    result: resultBytes,
    paybackAddress: "0x",
    sedaPayload: "0x",
  };

  return encodeAndSign(result, trustedKey);
}

// Helper function to compute feedId (keyed by drId + symbolId)
export function computeFeedId(drId: string, symbolId: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [drId, symbolId],
    ),
  );
}

// Helper function to create a past timestamp
export function createPastTimestamp(secondsAgo: number = 10): number {
  return Math.floor(Date.now() / 1000) - secondsAgo;
}

// Internal: encode Result and sign with deriveResultId
function encodeAndSign(
  result: {
    drId: string;
    gasUsed: number | bigint;
    blockHeight: number | bigint;
    blockTimestamp: number | bigint;
    consensus: boolean;
    exitCode: number;
    version: string;
    result: string;
    paybackAddress: string;
    sedaPayload: string;
  },
  trustedKey: Wallet,
): string {
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
