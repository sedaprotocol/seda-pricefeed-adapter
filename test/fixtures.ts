import * as fs from "node:fs";
import * as path from "node:path";
import { ethers } from "hardhat";

// Load the real SEDA data from JSON file
const loadRealData = () => {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "dr-valid.json"), "utf8"),
  );
};

// Valid SEDA data processed for contract consumption
export const valid = () => {
  const data = loadRealData();

  return {
    sedaResult: {
      drId: `0x${data.drId}`,
      gasUsed: BigInt(data.result.gasUsed),
      blockHeight: data.result.blockHeight,
      blockTimestamp: Math.floor(
        new Date(data.result.timestamp).getTime() / 1000,
      ),
      consensus: data.result.consensus,
      exitCode: data.result.exitCode,
      version: data.result.version,
      result: Buffer.from(data.result.result, "base64"),
      paybackAddress: data.paybackAddress || "0x",
      sedaPayload: data.payload || "0x",
    },
    updateParams: {
      gasPrice: BigInt(data.gasPrice),
      execGasLimit: BigInt(data.execGasLimit),
      tallyGasLimit: BigInt(data.tallyGasLimit),
      execInputs: Buffer.from(data.execInputs, "base64"),
      memo: Buffer.from(data.memo, "base64"),
    },
    batchNumber: data.batchNumber,
    merkleProof: [
      "0x1234567890123456789012345678901234567890123456789012345678901234",
      "0x5678901234567890123456789012345678901234567890123456789012345678",
    ],
    expectedPrices: {
      "BTC-USDT": 116556000000n,
      "ETH-USDT": 3897930000n,
    },
    // Raw data for contract deployment
    contractConfig: {
      execProgramId: `0x${data.execProgramId}`,
      tallyProgramId: `0x${data.tallyProgramId}`,
      replicationFactor: data.replicationFactor,
      tallyInputs: data.tallyInputs ? data.tallyInputs : "0x",
      consensusFilter: data.consensusFilter
        ? Buffer.from(data.consensusFilter, "base64")
        : "0x",
    },
  };
};

// Mock data for invalid consensus tests
export const invalidConsensus = () => {
  return {
    sedaResult: {
      drId: "0x1234567890123456789012345678901234567890123456789012345678901234",
      gasUsed: 1000000n,
      blockHeight: 100,
      blockTimestamp: Math.floor(Date.now() / 1000),
      consensus: false, // Invalid consensus
      exitCode: 0,
      version: "1",
      result: ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256[]"],
        [[116556000000n]],
      ),
      paybackAddress: "0x",
      sedaPayload: "0x",
    },
    request: {
      gasPrice: 1000000n,
      execGasLimit: 1000000n,
      tallyGasLimit: 1000000n,
      execInputs: ethers.AbiCoder.defaultAbiCoder().encode(
        ["string[]"],
        [["BTC-USDT"]],
      ),
      memo: "0x",
    },
    batchNumber: 100,
    merkleProof: [
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    ],
  };
};

// Mock data for invalid exit code tests
export const invalidExitCode = () => {
  return {
    sedaResult: {
      drId: "0x1234567890123456789012345678901234567890123456789012345678901234",
      gasUsed: 1000000n,
      blockHeight: 100,
      blockTimestamp: Math.floor(Date.now() / 1000),
      consensus: true,
      exitCode: 1, // Invalid exit code
      version: "1",
      result: ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256[]"],
        [[116556000000n]],
      ),
      paybackAddress: "0x",
      sedaPayload: "0x",
    },
    request: {
      gasPrice: 1000000n,
      execGasLimit: 1000000n,
      tallyGasLimit: 1000000n,
      execInputs: ethers.AbiCoder.defaultAbiCoder().encode(
        ["string[]"],
        [["BTC-USDT"]],
      ),
      memo: "0x",
    },
    batchNumber: 101,
    merkleProof: [
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    ],
  };
};

// Mock data for invalid merkle proof tests
export const invalidMerkleProof = () => {
  return {
    sedaResult: {
      drId: "0x1234567890123456789012345678901234567890123456789012345678901234",
      gasUsed: 1000000n,
      blockHeight: 100,
      blockTimestamp: Math.floor(Date.now() / 1000),
      consensus: true,
      exitCode: 0,
      version: "1",
      result: ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256[]"],
        [[116556000000n]],
      ),
      paybackAddress: "0x",
      sedaPayload: "0x",
    },
    request: {
      gasPrice: 1000000n,
      execGasLimit: 1000000n,
      tallyGasLimit: 1000000n,
      execInputs: ethers.AbiCoder.defaultAbiCoder().encode(
        ["string[]"],
        [["BTC-USDT"]],
      ),
      memo: "0x",
    },
    batchNumber: 102,
    merkleProof: [
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    ],
  };
};
