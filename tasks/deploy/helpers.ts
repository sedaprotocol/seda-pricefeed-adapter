import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { parse } from "valibot";
import { readFile } from "../common/io";
import {
  type AddressesFile,
  type SedaConfig,
  SedaConfigSchema,
} from "../common/schemas";

// Define the task arguments interface
interface TaskArgs {
  drconfig?: string;
  [key: string]: unknown;
}

export async function confirmAction(
  message: string,
  defaultNo: boolean = true,
): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultText = defaultNo ? "y/N" : "Y/n";
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} (${defaultText}): `, resolve);
  });
  rl.close();

  const normalizedAnswer = answer.toLowerCase().trim();
  if (defaultNo) {
    return normalizedAnswer === "y" || normalizedAnswer === "yes";
  } else {
    return normalizedAnswer !== "n" && normalizedAnswer !== "no";
  }
}

export function getGitInfo() {
  try {
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    return { commit, branch };
  } catch (_error) {
    console.warn("⚠️  Could not get git information");
    return { commit: "unknown", branch: "unknown" };
  }
}

export function parseConfig(
  taskArgs: TaskArgs,
  defaultConfig: SedaConfig,
): SedaConfig {
  try {
    if (taskArgs.drconfig && typeof taskArgs.drconfig === "string") {
      const configData = taskArgs.drconfig.endsWith(".json")
        ? readFile(taskArgs.drconfig)
        : taskArgs.drconfig;
      return parse(SedaConfigSchema, JSON.parse(configData));
    }
    return defaultConfig;
  } catch (error) {
    console.error("❌ Invalid config:", error);
    process.exit(1);
  }
}

export async function checkExistingDeployment(
  addresses: AddressesFile,
  deploymentKey: string,
): Promise<boolean> {
  if (!addresses[deploymentKey]) return true;

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
  return true;
}

export function printDeploymentSummary(
  proverAddress: string,
  implAddress: string,
  adapterAddress: string,
  adapterImplAddress: string,
  networkName: string,
  chainId: number,
  deployer: string,
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ DEPLOYMENT SUCCESSFUL");
  console.log("=".repeat(60));

  console.log("\n Contract Addresses:");
  console.log(`   Prover:                    ${proverAddress}`);
  console.log(`   PriceFeed Implementation:  ${implAddress}`);
  console.log(`   CoreAdapter Proxy:    ${adapterAddress}`);
  console.log(`   CoreAdapter Impl:     ${adapterImplAddress}`);

  console.log("\n Deployment Details:");
  console.log(
    `   Network:                   ${networkName} (Chain ID: ${chainId})`,
  );
  console.log(`   Deployer:                  ${deployer}`);
  console.log(`   Timestamp:                 ${new Date().toISOString()}`);
}

export function printNextSteps() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(" Next Steps:");
  console.log("   1. Verify contracts on block explorer");
  console.log("   2. Test price feed submissions");
  console.log("   3. Monitor oracle results");
  console.log(`${"=".repeat(60)}\n`);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
