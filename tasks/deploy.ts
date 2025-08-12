import { readFileSync } from "node:fs";
import { type InferInput, number, object, parse, string } from "valibot";
import { sedaScope } from ".";

const SedaConfigSchema = object({
  execProgramId: string(),
  tallyProgramId: string(),
  replicationFactor: number(),
  tallyInputs: string(),
  consensusFilter: string(),
});

type SedaConfig = InferInput<typeof SedaConfigSchema>;

const defaultConfig: SedaConfig = {
  execProgramId:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  tallyProgramId:
    "0x0000000000000000000000000000000000000000000000000000000000000002",
  replicationFactor: 1,
  tallyInputs: "0x",
  consensusFilter: "0x",
};

sedaScope
  .task("deploy", "Deploy PriceFeedAdapter with proxy")
  .addOptionalParam(
    "prover",
    "Existing prover address (deploys mock if not provided)",
  )
  .addOptionalParam(
    "pricefeed",
    "Existing PriceFeed implementation address (deploys new if not provided)",
  )
  .addOptionalParam(
    "drconfig",
    "JSON DR config file path or inline JSON (mock config if not provided)",
  )
  .setAction(async (taskArgs, hre) => {
    const [deployer] = await hre.ethers.getSigners();

    // Parse and validate config if provided, otherwise use default
    let config: SedaConfig;
    try {
      if (taskArgs.drconfig) {
        const configData = taskArgs.drconfig.endsWith(".json")
          ? readFileSync(taskArgs.drconfig, "utf8")
          : taskArgs.drconfig;
        config = parse(SedaConfigSchema, JSON.parse(configData));
      } else {
        config = defaultConfig;
      }
    } catch (error) {
      console.error("❌ Invalid config:", error);
      process.exit(1);
    }

    console.log("\n🚀 Starting deployment...");
    console.log("\n⚙️  SEDA Configuration:");
    console.log(`   Exec Program ID: ${config.execProgramId}`);
    console.log(`   Tally Program ID: ${config.tallyProgramId}`);
    console.log(`   Replication Factor: ${config.replicationFactor}`);
    console.log(`   Tally Inputs: ${config.tallyInputs}`);
    console.log(`   Consensus Filter: ${config.consensusFilter}`);

    // Get or deploy prover
    let proverAddress: string;
    if (taskArgs.prover) {
      proverAddress = taskArgs.prover;
      console.log(`\n✓ Using existing Prover: ${proverAddress}`);
    } else {
      const mockProver = await hre.ethers
        .getContractFactory("MockSedaProver")
        .then((f) => f.deploy());
      proverAddress = await mockProver.getAddress();
      console.log(`\n✓ Mock Prover deployed: ${proverAddress}`);
    }

    // Get or deploy PriceFeed implementation
    let implAddress: string;
    if (taskArgs.pricefeed) {
      implAddress = taskArgs.pricefeed;
      console.log(`✓ Using existing PriceFeed Implementation: ${implAddress}`);
    } else {
      const priceFeedImpl = await hre.ethers
        .getContractFactory("PriceFeed")
        .then((f) => f.deploy());
      implAddress = await priceFeedImpl.getAddress();
      console.log(`✓ PriceFeed Implementation deployed: ${implAddress}`);
    }

    // Deploy PriceFeedAdapter proxy (implementation is deployed and used internally)
    const adapter = await hre.upgrades.deployProxy(
      await hre.ethers.getContractFactory("PriceFeedAdapter"),
      [proverAddress, implAddress, deployer.address, config],
      { initializer: "initialize" },
    );

    const adapterAddress = await adapter.getAddress();
    console.log(`✓ PriceFeedAdapter Proxy deployed: ${adapterAddress}`);

    // Get the implementation address from the proxy
    const adapterImplAddress =
      await hre.upgrades.erc1967.getImplementationAddress(adapterAddress);
    console.log(
      `✓ PriceFeedAdapter Implementation deployed: ${adapterImplAddress}`,
    );

    // Final summary
    console.log(`\n${"=".repeat(60)}`);
    console.log("✅ DEPLOYMENT SUCCESSFUL");
    console.log("=".repeat(60));

    console.log("\n📋 Contract Addresses:");
    console.log(`   Prover:                    ${proverAddress}`);
    console.log(`   PriceFeed Implementation:  ${implAddress}`);
    console.log(`   PriceFeedAdapter Proxy:    ${adapterAddress}`);
    console.log(`   PriceFeedAdapter Impl:     ${adapterImplAddress}`);

    console.log("\n📄 Deployment Details:");
    console.log(
      `   Network:                   ${hre.network.name} (Chain ID: ${hre.network.config.chainId})`,
    );
    console.log(`   Deployer:                  ${deployer.address}`);
    console.log(`   Timestamp:                 ${new Date().toISOString()}`);

    console.log(`\n${"=".repeat(60)}`);
    console.log(" Next Steps:");
    console.log("   1. Verify contracts on block explorer");
    console.log("   2. Test price feed submissions");
    console.log("   3. Monitor oracle results");
    console.log(`${"=".repeat(60)}\n`);
  });
