import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { MockSedaProver } from "../typechain-types/contracts/mocks/MockSedaProver";
import { getAdapterContract } from "./common/contract";
import type { SedaConfig } from "./common/schemas";
import { sedaScope } from "./index";

sedaScope
  .task(
    "adapter:mock-submit",
    "Submit mock prices to the adapter (for testing with mock prover)",
  )
  .setAction(async (_taskArgs, hre) => {
    console.log(`Submitting mock prices on ${hre.network.name}...`);

    try {
      const { adapter } = await getAdapterContract(hre);

      // Get the signer
      const [signer] = await hre.ethers.getSigners();

      // Check if we're using a mock prover
      const proverAddress = await adapter.getProver();
      const MockSedaProverFactory =
        await hre.ethers.getContractFactory("MockSedaProver");

      let mockProver: MockSedaProver;
      try {
        mockProver = MockSedaProverFactory.attach(
          proverAddress,
        ) as MockSedaProver;
        await mockProver.setBatchValid(1, true);
        console.log("✓ Mock prover detected");
      } catch (_error) {
        console.log(
          "Error: This task only works with MockSedaProver. Please deploy with mock prover first.",
        );
        process.exit(1);
      }

      const configOutput = await adapter.priceFeedConfig();
      const config: SedaConfig = {
        execProgramId: configOutput.execProgramId,
        tallyProgramId: configOutput.tallyProgramId,
        replicationFactor: Number(configOutput.replicationFactor),
        tallyInputs: configOutput.tallyInputs,
        consensusFilter: configOutput.consensusFilter,
      };

      const data = createMockData(config, hre);

      // Decode prices and symbols
      const prices = hre.ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256[]"],
        data.sedaResult.result,
      )[0];

      const symbols = hre.ethers.AbiCoder.defaultAbiCoder().decode(
        ["string[]"],
        data.updateParams.execInputs,
      )[0];

      console.log("\n📊 Using mock data:");
      console.log(`   - Tickers: ${symbols.join(", ")}`);
      console.log(
        `   - Prices: ${prices.map((p: bigint) => p.toString()).join(", ")} wei`,
      );

      // Configure and submit
      console.log("\n🔧 Setting-up mock prover...");
      await mockProver.setBatchValid(data.batchNumber, true);
      await mockProver.setDefaultBatchSender(signer.address);

      const tx = await adapter.submit(
        data.updateParams,
        data.sedaResult,
        data.batchNumber,
        data.merkleProof,
      );

      await tx.wait();

      console.log(`\n✅ Mock SEDA data submitted successfully!`);
      console.log(`   - Transaction: ${tx.hash}`);

      // Verify prices
      console.log("\n🔍 Verifying submitted prices:");
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const expectedPrice = prices[i];

        const feedAddress = await adapter.getPriceFeedAddress(symbol);
        if (feedAddress === hre.ethers.ZeroAddress) {
          console.log(`   - ${symbol}: No price feed created`);
        } else {
          const feed = await hre.ethers.getContractAt("PriceFeed", feedAddress);
          const actualPrice = await feed.latestAnswer();
          const timestamp = await feed.latestTimestamp();

          if (actualPrice === expectedPrice) {
            console.log(
              `   - ${symbol}: ${actualPrice.toString()} wei (${new Date(Number(timestamp) * 1000).toISOString()})`,
            );
          } else {
            console.log(
              `   - ${symbol}: Expected ${expectedPrice.toString()}, got ${actualPrice.toString()}`,
            );
          }
        }
      }
    } catch (error) {
      console.log(
        "Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

// Create mock data directly as an object
const createMockData = (config: SedaConfig, hre: HardhatRuntimeEnvironment) => {
  // Define the symbols and prices we want to test with
  const symbols = ["BTC-USDT", "ETH-USDT"];
  const prices = [120243590000n, 4278190000n]; // Prices in wei

  // Encode the data using ABI encoder
  const encodedPrices = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[]"],
    [prices],
  );

  const encodedSymbols = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["string[]"],
    [symbols],
  );

  // Create expected prices object
  const expectedPrices: Record<string, bigint> = {};
  for (let i = 0; i < symbols.length; i++) {
    expectedPrices[symbols[i]] = prices[i];
  }

  // Create request inputs matching the contract's expected structure
  const requestInputs = {
    execProgramId: config.execProgramId,
    tallyProgramId: config.tallyProgramId,
    gasPrice: 2000n,
    execGasLimit: 300000000000000n,
    tallyGasLimit: 50000000000000n,
    replicationFactor: config.replicationFactor,
    execInputs: encodedSymbols,
    tallyInputs: config.tallyInputs,
    consensusFilter: config.consensusFilter,
    memo: "0x",
  };

  // Derive DR ID using the same logic as SedaDataTypes.deriveRequestId
  const drId = hre.ethers.keccak256(
    hre.ethers.concat([
      hre.ethers.keccak256(hre.ethers.toUtf8Bytes("0.0.1")), // VERSION
      requestInputs.execProgramId,
      hre.ethers.keccak256(requestInputs.execInputs),
      hre.ethers.zeroPadValue(
        hre.ethers.toBeHex(requestInputs.execGasLimit),
        8,
      ),
      requestInputs.tallyProgramId,
      hre.ethers.keccak256(requestInputs.tallyInputs),
      hre.ethers.zeroPadValue(
        hre.ethers.toBeHex(requestInputs.tallyGasLimit),
        8,
      ),
      hre.ethers.zeroPadValue(
        hre.ethers.toBeHex(requestInputs.replicationFactor),
        2,
      ),
      hre.ethers.keccak256(requestInputs.consensusFilter),
      hre.ethers.zeroPadValue(hre.ethers.toBeHex(requestInputs.gasPrice), 16),
      hre.ethers.keccak256(requestInputs.memo),
    ]),
  );

  return {
    sedaResult: {
      drId,
      gasUsed: 32946462221875n,
      blockHeight: 5646814,
      blockTimestamp: Math.floor(Date.now() / 1000),
      consensus: true,
      exitCode: 0,
      version: "0.0.1",
      result: encodedPrices,
      paybackAddress: "0x",
      sedaPayload: "0x",
    },
    updateParams: {
      gasPrice: requestInputs.gasPrice,
      execGasLimit: requestInputs.execGasLimit,
      tallyGasLimit: requestInputs.tallyGasLimit,
      execInputs: requestInputs.execInputs,
      memo: requestInputs.memo,
    },
    batchNumber: 264689,
    merkleProof: [
      "0x1234567890123456789012345678901234567890123456789012345678901234",
      "0x5678901234567890123456789012345678901234567890123456789012345678",
    ],
    expectedPrices,
    symbols,
  };
};
