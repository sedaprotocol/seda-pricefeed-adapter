import type { Wallet } from "ethers";
import { ethers } from "hardhat";
import type { FastPriceFeedAdapter } from "../typechain-types/contracts/FastPriceFeedAdapter";

// Helper function to submit a price update
export async function submitPriceUpdate(
  adapter: FastPriceFeedAdapter,
  trustedKey: Wallet,
  symbol: string,
  price: bigint,
  conf: bigint,
  publishTime: number = Math.floor(Date.now() / 1000),
) {
  const updateData = await createValidUpdateData(
    trustedKey,
    symbol,
    price,
    conf,
    publishTime,
  );
  await adapter.updatePriceFeeds([updateData]);
}

// Helper function to create valid update data
export async function createValidUpdateData(
  trustedKey: Wallet,
  symbol: string,
  price: bigint,
  conf: bigint,
  publishTime: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const execProgramId = ethers.id("exec_program");
  const tallyProgramId = ethers.id("tally_program");
  const rawId = ethers.id(symbol);

  const priceUpdate = {
    rawId,
    priceInfo: {
      publishTime: publishTime,
      expo: -8,
      price,
      conf,
      emaPrice: price,
      emaConf: conf,
    },
  };

  const result = {
    drId: ethers.id("dr_id"),
    gasUsed: 100000,
    blockHeight: 12345,
    blockTimestamp: publishTime,
    consensus: true,
    exitCode: 0,
    version: "0.0.1",
    result: ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(bytes32 rawId,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
      ],
      [[priceUpdate]],
    ),
    paybackAddress: "0x0000000000000000000000000000000000000000",
    sedaPayload: "0x",
  };

  const batch = {
    programConfig: {
      execProgramId,
      tallyProgramId,
    },
    result: result,
  };

  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
    ],
    [batch],
  );

  const dataHash = ethers.keccak256(data);
  const signature = await trustedKey.signingKey.sign(dataHash);
  const serializedSignature = ethers.Signature.from(signature).serialized;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes data, bytes signature)"],
    [{ data, signature: serializedSignature }],
  );
}

// Helper function to create invalid exit code payload
export async function createInvalidExitCodePayload(
  trustedKey: Wallet,
): Promise<string> {
  const execProgramId = ethers.id("exec_program");
  const tallyProgramId = ethers.id("tally_program");
  const rawId = ethers.id("BTC/USD");

  const priceUpdate = {
    rawId,
    priceInfo: {
      publishTime: Math.floor(Date.now() / 1000),
      expo: -8,
      price: 50000n,
      conf: 100n,
      emaPrice: 50000n,
      emaConf: 100n,
    },
  };

  const result = {
    drId: ethers.id("dr_id"),
    gasUsed: 100000,
    blockHeight: 12345,
    blockTimestamp: Math.floor(Date.now() / 1000),
    consensus: true,
    exitCode: 1, // Invalid exit code
    version: "0.0.1",
    result: ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(bytes32 rawId,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
      ],
      [[priceUpdate]],
    ),
    paybackAddress: "0x0000000000000000000000000000000000000000",
    sedaPayload: "0x",
  };

  const batch = {
    programConfig: {
      execProgramId,
      tallyProgramId,
    },
    result: result,
  };

  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
    ],
    [batch],
  );

  const dataHash = ethers.keccak256(data);
  const signature = await trustedKey.signingKey.sign(dataHash);
  const serializedSignature = ethers.Signature.from(signature).serialized;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes data, bytes signature)"],
    [{ data, signature: serializedSignature }],
  );
}

// Helper function to create empty batch payload
export async function createEmptyBatchPayload(
  trustedKey: Wallet,
): Promise<string> {
  const execProgramId = ethers.id("exec_program");
  const tallyProgramId = ethers.id("tally_program");

  const result = {
    drId: ethers.id("dr_id"),
    gasUsed: 100000,
    blockHeight: 12345,
    blockTimestamp: Math.floor(Date.now() / 1000),
    consensus: true,
    exitCode: 0,
    version: "0.0.1",
    result: ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(bytes32 rawId,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
      ],
      [[]], // Empty array
    ),
    paybackAddress: "0x0000000000000000000000000000000000000000",
    sedaPayload: "0x",
  };

  const batch = {
    programConfig: {
      execProgramId,
      tallyProgramId,
    },
    result: result,
  };

  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
    ],
    [batch],
  );

  const dataHash = ethers.keccak256(data);
  const signature = await trustedKey.signingKey.sign(dataHash);
  const serializedSignature = ethers.Signature.from(signature).serialized;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes data, bytes signature)"],
    [{ data, signature: serializedSignature }],
  );
}

// Helper function to create a trusted key
export function createTrustedKey(validatorId: string = "validator1"): Wallet {
  return new ethers.Wallet(ethers.id(validatorId).slice(2, 66));
}

// Helper function to compute asset ID
export function computeAssetId(symbol: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32"],
      [
        ethers.id("exec_program"),
        ethers.id("tally_program"),
        ethers.id(symbol),
      ],
    ),
  );
}

// Helper function to create a past timestamp
export function createPastTimestamp(secondsAgo: number = 10): number {
  return Math.floor(Date.now() / 1000) - secondsAgo;
}
