import { type InferInput, number, object, record, string } from "valibot";

export const SedaConfigSchema = object({
  execProgramId: string(),
  tallyProgramId: string(),
  replicationFactor: number(),
  tallyInputs: string(),
  consensusFilter: string(),
});

export const GitInfoSchema = object({
  commit: string(),
  branch: string(),
});

export const ContractAddressesSchema = object({
  prover: string(),
  priceFeedImplementation: string(),
  priceFeedAdapterProxy: string(),
  priceFeedAdapterImplementation: string(),
});

export const NetworkDeploymentSchema = object({
  chainId: number(),
  deployer: string(),
  timestamp: string(),
  git: GitInfoSchema,
  contracts: ContractAddressesSchema,
  config: SedaConfigSchema,
});

export const AddressesFileSchema = record(string(), NetworkDeploymentSchema);

export type SedaConfig = InferInput<typeof SedaConfigSchema>;
export type NetworkDeployment = InferInput<typeof NetworkDeploymentSchema>;
export type AddressesFile = InferInput<typeof AddressesFileSchema>;
