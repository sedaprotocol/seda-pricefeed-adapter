import type { Wallet } from "ethers";
import { ethers } from "hardhat";

// Helper function to create a trusted key
export function createTrustedKey(validatorId: string = "validator1"): Wallet {
  return new ethers.Wallet(ethers.id(validatorId).slice(2, 66));
}

// Helper function to create multiple trusted keys
export function createMultipleTrustedKeys(count: number = 2): Wallet[] {
  const keys = [];
  for (let i = 1; i <= count; i++) {
    keys.push(createTrustedKey(`validator${i}`));
  }
  return keys;
}

// Helper function to create an untrusted key
export function createUntrustedKey(): Wallet {
  return new ethers.Wallet(ethers.id("untrusted").slice(2, 66));
}
