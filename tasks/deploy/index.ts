import {
  loadAddresses,
  saveAddresses,
  saveArtifacts,
  saveBuildInfo,
} from "../common/io";
import type { NetworkDeployment, SedaConfig } from "../common/schemas";
import { sedaScope } from "../scope";
import {
  checkExistingDeployment,
  confirmAction,
  getGitInfo,
  parseConfig,
  printDeploymentSummary,
  printNextSteps,
  sleep,
} from "./helpers";

const SLEEP_TIME_MILLIS = 5_000; // 5 seconds

export const defaultConfig: SedaConfig = {
  execProgramId:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  tallyProgramId:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  replicationFactor: 1,
  tallyInputs: "0x",
  consensusFilter: "0x",
};

sedaScope
  .task("deploy", "Deploy CoreAdapter with proxy")
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
    const networkName = hre.network.name;
    const chainId = hre.network.config.chainId ?? 0;
    const isLocalNetwork = networkName === "hardhat" && chainId === 31337;

    if (isLocalNetwork) {
      console.log(
        "\n🔧 Local development detected - skipping address tracking",
      );
    } else {
      const deploymentKey = `${networkName}-${chainId}`;
      const addresses = await loadAddresses();
      await checkExistingDeployment(addresses, deploymentKey);
    }

    const config = parseConfig(taskArgs, defaultConfig);

    console.log("\n🚀 Starting deployment...");
    console.log("\n⚙️  SEDA Configuration:");
    console.log(`   Exec Program ID: ${config.execProgramId}`);
    console.log(`   Tally Program ID: ${config.tallyProgramId}`);
    console.log(`   Replication Factor: ${config.replicationFactor}`);
    console.log(`   Tally Inputs: ${config.tallyInputs}`);
    console.log(`   Consensus Filter: ${config.consensusFilter}`);

    // Deploy contracts (inlined as you suggested)
    const [deployer] = await hre.ethers.getSigners();

    // Deploy or use existing prover
    let proverAddress: string;
    if (taskArgs.prover) {
      proverAddress = taskArgs.prover;
      console.log(`\n✓ Using existing Prover: ${proverAddress}`);
    } else {
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

    // Deploy or use existing PriceFeed implementation
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

    // Deploy CoreAdapter proxy
    const adapter = await hre.upgrades.deployProxy(
      await hre.ethers.getContractFactory("CoreAdapter"),
      [proverAddress, implAddress, deployer.address, config],
      { initializer: "initialize" },
    );

    const adapterAddress = await adapter.getAddress();
    console.log(`✓ CoreAdapter Proxy deployed: ${adapterAddress}`);

    // Wait some time to ensure the proxy is deployed
    await sleep(SLEEP_TIME_MILLIS);

    const adapterImplAddress =
      await hre.upgrades.erc1967.getImplementationAddress(adapterAddress);
    console.log(`✓ CoreAdapter Implementation deployed: ${adapterImplAddress}`);

    const gitInfo = getGitInfo();

    printDeploymentSummary(
      proverAddress,
      implAddress,
      adapterAddress,
      adapterImplAddress,
      networkName,
      chainId,
      deployer.address,
    );

    if (!isLocalNetwork) {
      const deploymentKey = `${networkName}-${chainId}`;
      const deploymentDir = `deployments/${deploymentKey}`;

      const contracts = [
        { name: "PriceFeed", address: implAddress },
        { name: "CoreAdapter", address: adapterAddress },
      ];

      if (!taskArgs.prover) {
        contracts.unshift({ name: "MockSedaProver", address: proverAddress });
      }

      await saveArtifacts(
        deploymentDir,
        contracts,
        networkName,
        chainId,
        deployer.address,
        gitInfo,
        hre,
      );
      await saveBuildInfo(deploymentDir, hre);

      const deploymentData: NetworkDeployment = {
        chainId,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        git: gitInfo,
        contracts: {
          prover: proverAddress,
          priceFeedImplementation: implAddress,
          priceFeedAdapterProxy: adapterAddress,
          priceFeedAdapterImplementation: adapterImplAddress,
        },
        config,
      };

      await saveAddresses(
        "deployments/addresses.json",
        deploymentKey,
        deploymentData,
      );
      printNextSteps();
    } else {
      console.log("\n Local deployment - addresses not tracked");
    }
  });
