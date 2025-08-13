import { getAdapterContract } from "./common/contract";
import { sedaScope } from "./index";

sedaScope
  .task("adapter:status", "Get PriceFeedAdapter status and configuration")
  .setAction(async (_taskArgs, hre) => {
    console.log(
      `\n🔍 Checking PriceFeedAdapter status on ${hre.network.name} (Chain ID: ${hre.network.config.chainId})`,
    );

    try {
      const { adapter, deployment } = await getAdapterContract(hre);

      // Get all the data in parallel
      const [prover, implementation, owner, config, tickers, isPaused] =
        await Promise.all([
          adapter.getProver(),
          adapter.getImplementation(),
          adapter.owner(),
          adapter.priceFeedConfig(),
          adapter.getAllTickers(),
          adapter.paused(),
        ]);

      console.log("\n🔍 PriceFeedAdapter Status:");
      console.log("  - SEDA Prover:", prover);
      console.log("  - Implementation:", implementation);
      console.log("  - Owner:", owner);
      console.log("  - Paused:", isPaused ? "Yes" : "No");
      console.log("  - Active tickers:", tickers.length);

      if (tickers.length > 0) {
        console.log("  Registered tickers:");
        tickers.forEach((ticker: string, index: number) => {
          console.log(`    ${index + 1}. ${ticker}`);
        });
      }

      console.log("\n⚙️  SEDA Configuration:");
      console.log("  - Exec Program ID:", config.execProgramId);
      console.log("  - Tally Program ID:", config.tallyProgramId);
      console.log(
        "  - Replication Factor:",
        config.replicationFactor.toString(),
      );
      console.log("  - Tally Inputs:", config.tallyInputs);
      console.log("  - Consensus Filter:", config.consensusFilter);

      console.log("\n📅 Deployment Info:");
      console.log("  - Deployer:", deployment.deployer);
      console.log("  - Timestamp:", deployment.timestamp);
      console.log("  - Git Commit:", deployment.git.commit);
      console.log("  - Git Branch:", deployment.git.branch);
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
