import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { parse } from "valibot";
import {
  type AddressesFile,
  AddressesFileSchema,
  type NetworkDeployment,
  NetworkDeploymentSchema,
} from "../common/schemas";

export function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

export async function loadAddresses(): Promise<AddressesFile> {
  const addressesPath =
    process.env.ADDRESSES_PATH || "deployments/addresses.json";

  if (!existsSync(addressesPath)) return {};

  try {
    const fileContent = readFileSync(addressesPath, "utf8");
    const addresses = parse(AddressesFileSchema, JSON.parse(fileContent));
    console.log("✓ Loaded and validated existing addresses.json");
    return addresses;
  } catch (error) {
    console.error("❌ Failed to parse existing addresses.json:", error);
    process.exit(1);
  }
}

export async function saveAddresses(
  addressesPath: string,
  deploymentKey: string,
  deploymentData: NetworkDeployment,
) {
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

  // Validate and add new deployment
  try {
    parse(NetworkDeploymentSchema, deploymentData);
    addresses[deploymentKey] = deploymentData;
    parse(AddressesFileSchema, addresses);
  } catch (error) {
    console.error("❌ Invalid deployment data:", error);
    process.exit(1);
  }

  try {
    writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    console.log(`\n✓ Addresses saved to: ${addressesPath}`);
  } catch (error) {
    console.error("❌ Failed to write addresses to file:", error);
  }
}

export async function saveArtifacts(
  deploymentDir: string,
  contracts: Array<{ name: string; address: string }>,
  networkName: string,
  chainId: number,
  deployer: string,
  gitInfo: { commit: string; branch: string },
  hre: HardhatRuntimeEnvironment,
) {
  const artifactsDir = `${deploymentDir}/artifacts`;
  mkdirSync(artifactsDir, { recursive: true });

  for (const contract of contracts) {
    const artifactPath = join(artifactsDir, `${contract.name}.json`);
    const artifact = {
      name: contract.name,
      address: contract.address,
      network: networkName,
      chainId,
      deployer,
      timestamp: new Date().toISOString(),
      git: gitInfo,
      ...(await hre.artifacts.readArtifact(contract.name)),
    };

    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  }

  console.log(`\n✓ Contract artifacts saved to: ${artifactsDir}`);
}

export async function saveBuildInfo(
  deploymentDir: string,
  hre: HardhatRuntimeEnvironment,
) {
  try {
    const buildInfoPaths = await hre.artifacts.getBuildInfoPaths();

    if (buildInfoPaths.length === 1) {
      const buildInfoPath = buildInfoPaths[0];
      const buildInfoContent = readFileSync(buildInfoPath, "utf8");
      const buildInfo = JSON.parse(buildInfoContent);

      const fileName = buildInfoPath.split("/").pop() || buildInfoPath;
      const buildInfoFilePath = join(deploymentDir, fileName);
      writeFileSync(buildInfoFilePath, JSON.stringify(buildInfo, null, 2));
      console.log(`✓ Build info saved to: ${buildInfoFilePath}`);
    } else if (buildInfoPaths.length > 1) {
      const buildInfoDir = `${deploymentDir}/build-info`;
      mkdirSync(buildInfoDir, { recursive: true });

      for (const buildInfoPath of buildInfoPaths) {
        const buildInfoContent = readFileSync(buildInfoPath, "utf8");
        const buildInfo = JSON.parse(buildInfoContent);

        const fileName = buildInfoPath.split("/").pop() || buildInfoPath;
        const buildInfoFilePath = join(buildInfoDir, fileName);
        writeFileSync(buildInfoFilePath, JSON.stringify(buildInfo, null, 2));
      }
      console.log(`✓ Build info saved to: ${buildInfoDir}`);
    }
  } catch (error) {
    console.warn("⚠️  Could not save build info files:", error);
  }
}
