import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { loadAddresses } from "./io";
import type { AddressesFile } from "./schemas";

// Helper function to get adapter contract
export async function getAdapterContract(hre: HardhatRuntimeEnvironment) {
  const networkName = hre.network.name;
  const chainId = hre.network.config.chainId ?? 0;
  const deploymentKey = `${networkName}-${chainId}`;

  let addresses: AddressesFile;
  try {
    addresses = await loadAddresses();
  } catch (_error) {
    throw new Error(
      "No addresses.json file found. Please deploy the contract first with: npx hardhat seda:deploy",
    );
  }

  const deployment = addresses[deploymentKey];
  if (!deployment) {
    const availableDeployments = Object.keys(addresses).join(", ");
    throw new Error(
      `No deployment found for ${deploymentKey}. Available deployments: ${availableDeployments}`,
    );
  }

  const adapterAddress = deployment.contracts.priceFeedAdapterProxy;
  const adapter = await hre.ethers.getContractAt("CoreAdapter", adapterAddress);

  return { adapter, addresses, deployment };
}
