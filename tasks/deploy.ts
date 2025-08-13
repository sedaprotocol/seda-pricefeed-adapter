import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type InferInput,
  number,
  object,
  parse,
  record,
  string,
} from "valibot";
import { sedaScope } from ".";
import { confirmAction } from "./utils/prompts";

const SedaConfigSchema = object({
  execProgramId: string(),
  tallyProgramId: string(),
  replicationFactor: number(),
  tallyInputs: string(),
  consensusFilter: string(),
});

// Schema for git information
const GitInfoSchema = object({
  commit: string(),
  branch: string(),
});

// Schema for contract addresses
const ContractAddressesSchema = object({
  prover: string(),
  priceFeedImplementation: string(),
  priceFeedAdapterProxy: string(),
  priceFeedAdapterImplementation: string(),
});

// Schema for a single network deployment
const NetworkDeploymentSchema = object({
  chainId: number(),
  deployer: string(),
  timestamp: string(),
  git: GitInfoSchema,
  contracts: ContractAddressesSchema,
  config: SedaConfigSchema,
});

// Schema for the entire addresses.json file
const AddressesFileSchema = record(string(), NetworkDeploymentSchema);

type SedaConfig = InferInput<typeof SedaConfigSchema>;
type NetworkDeployment = InferInput<typeof NetworkDeploymentSchema>;
type AddressesFile = InferInput<typeof AddressesFileSchema>;

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

    const networkName = hre.network.name;
    const chainId = hre.network.config.chainId ?? 0;
    const isLocalNetwork = networkName === "hardha" && chainId === 31337;

    // Skip address tracking for local development
    if (isLocalNetwork) {
      console.log(
        "\n🔧 Local development detected - skipping address tracking",
      );
    } else {
      // Check for existing deployment before starting
      const addressesPath = "deployments/addresses.json";
      const deploymentKey = `${networkName}-${chainId}`;

      // Read existing addresses to check for duplicates
      let addresses: AddressesFile = {};
      if (existsSync(addressesPath)) {
        try {
          const fileContent = readFileSync(addressesPath, "utf8");
          addresses = parse(AddressesFileSchema, JSON.parse(fileContent));
          console.log("✓ Loaded and validated existing addresses.json");
        } catch (error) {
          console.error("❌ Failed to parse existing addresses.json:", error);
          process.exit(1);
        }
      }

      // Check if deployment already exists
      if (addresses[deploymentKey]) {
        const existingDeployment = addresses[deploymentKey];
        const message = `\n⚠️  Deployment already exists for ${deploymentKey}
   Previous deployment: ${existingDeployment.timestamp}
   Deployer: ${existingDeployment.deployer}
   Git Commit: ${existingDeployment.git.commit}
   
   Do you want to overwrite this deployment?`;

        const confirmed = await confirmAction(message, false);
        if (!confirmed) {
          console.log("\n❌ Deployment cancelled.");
          process.exit(0);
        }
        console.log("\n✓ Proceeding with deployment to overwrite existing...");
      }
    }

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
      // Check if we're on a non-local network and no prover provided
      if (hre.network.name !== "hardhat" && !taskArgs.prover) {
        const message = `\n⚠️  You're deploying to ${hre.network.name} (Chain ID: ${hre.network.config.chainId})
   No prover address provided. This will deploy a Mock Prover.
   Mock provers are intended solely for testing and should never be used in production environments.
   Do you want to continue?`;

        const confirmed = await confirmAction(message, true);
        if (!confirmed) {
          console.log(
            "\n❌ Deployment cancelled. Please provide a valid prover address with --prover",
          );
          process.exit(0);
        }
      }

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

    // Get git commit information
    let gitCommit = "unknown";
    let gitBranch = "unknown";
    try {
      gitCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
      }).trim();
    } catch (_error) {
      console.warn("⚠️  Could not get git information");
    }

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

    // Write addresses to addresses.json file (skip for local)
    if (!isLocalNetwork) {
      const addressesPath = "deployments/addresses.json";
      const deploymentKey = `${networkName}-${chainId}`;

      // Create deployment directory structure
      const deploymentDir = `deployments/${deploymentKey}`;
      const artifactsDir = `${deploymentDir}/artifacts`;

      mkdirSync(artifactsDir, { recursive: true });

      // Save contract artifacts
      const contracts = [
        { name: "PriceFeed", address: implAddress },
        { name: "PriceFeedAdapter", address: adapterAddress },
      ];

      // Only add MockSedaProver if it was deployed (not provided as parameter)
      if (!taskArgs.prover) {
        contracts.unshift({ name: "MockSedaProver", address: proverAddress });
      }

      for (const contract of contracts) {
        const artifactPath = join(artifactsDir, `${contract.name}.json`);
        const artifact = {
          name: contract.name,
          address: contract.address,
          network: networkName,
          chainId,
          deployer: deployer.address,
          timestamp: new Date().toISOString(),
          git: {
            commit: gitCommit,
            branch: gitBranch,
          },
          // Include the actual contract artifact from hardhat
          ...(await hre.artifacts.readArtifact(contract.name)),
        };

        writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      }

      // Save build info files
      try {
        const buildInfoPaths = await hre.artifacts.getBuildInfoPaths();

        if (buildInfoPaths.length === 1) {
          // Single build info file - save directly in deployment dir
          const buildInfoPath = buildInfoPaths[0];
          const buildInfoContent = readFileSync(buildInfoPath, "utf8");
          const buildInfo = JSON.parse(buildInfoContent);

          const fileName = buildInfoPath.split("/").pop() || buildInfoPath;
          const buildInfoFilePath = join(deploymentDir, fileName);
          writeFileSync(buildInfoFilePath, JSON.stringify(buildInfo, null, 2));
          console.log(`✓ Build info saved to: ${buildInfoFilePath}`);
        } else if (buildInfoPaths.length > 1) {
          // Multiple build info files - save in build-info subdirectory
          const buildInfoDir = `${deploymentDir}/build-info`;
          mkdirSync(buildInfoDir, { recursive: true });

          for (const buildInfoPath of buildInfoPaths) {
            const buildInfoContent = readFileSync(buildInfoPath, "utf8");
            const buildInfo = JSON.parse(buildInfoContent);

            const fileName = buildInfoPath.split("/").pop() || buildInfoPath;
            const buildInfoFilePath = join(buildInfoDir, fileName);
            writeFileSync(
              buildInfoFilePath,
              JSON.stringify(buildInfo, null, 2),
            );
          }
          console.log(`✓ Build info saved to: ${buildInfoDir}`);
        }
      } catch (error) {
        console.warn("⚠️  Could not save build info files:", error);
      }

      console.log(`\n✓ Contract artifacts saved to: ${artifactsDir}`);
      console.log(`\n${"=".repeat(60)}`);
      console.log(" Next Steps:");
      console.log("   1. Verify contracts on block explorer");
      console.log("   2. Test price feed submissions");
      console.log("   3. Monitor oracle results");
      console.log(`${"=".repeat(60)}\n`);

      // Read existing addresses or create new structure
      let addresses: AddressesFile = {};
      if (existsSync(addressesPath)) {
        try {
          const fileContent = readFileSync(addressesPath, "utf8");
          addresses = parse(AddressesFileSchema, JSON.parse(fileContent));
        } catch (error) {
          console.error("❌ Failed to parse existing addresses.json:", error);
          process.exit(1);
        }
      }

      // Create new deployment data with validation
      const newDeployment: NetworkDeployment = {
        chainId,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        git: {
          commit: gitCommit,
          branch: gitBranch,
        },
        contracts: {
          prover: proverAddress,
          priceFeedImplementation: implAddress,
          priceFeedAdapterProxy: adapterAddress,
          priceFeedAdapterImplementation: adapterImplAddress,
        },
        config: config,
      };

      // Validate the new deployment data before adding
      try {
        parse(NetworkDeploymentSchema, newDeployment);
      } catch (error) {
        console.error("❌ Invalid deployment data:", error);
        process.exit(1);
      }

      // Add new network deployment
      addresses[deploymentKey] = newDeployment;

      // Validate the entire addresses file before writing
      try {
        parse(AddressesFileSchema, addresses);
      } catch (error) {
        console.error("❌ Invalid addresses file structure:", error);
        process.exit(1);
      }

      // Write back to file
      try {
        writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
        console.log(`\n✓ Addresses saved to: ${addressesPath}`);
      } catch (error) {
        console.error("❌ Failed to write addresses to file:", error);
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log(" Next Steps:");
      console.log("   1. Verify contracts on block explorer");
      console.log("   2. Test price feed submissions");
      console.log("   3. Monitor oracle results");
      console.log(`${"=".repeat(60)}\n`);
    } else {
      console.log("\n Local deployment - addresses not tracked");
    }
  });
