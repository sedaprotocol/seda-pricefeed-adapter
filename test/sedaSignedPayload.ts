import { ethers } from "ethers";

/** ABI encoding for `SedaDataTypes.Result` (matches Solidity). */
export const RESULT_ABI_TYPE =
  "tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload)";

/** ABI encoding for `BaseSedaAdapter.SignedPayload`. */
export const SIGNED_PAYLOAD_ABI_TYPE = "tuple(bytes data, bytes signature)";

/**
 * Shape of `data.dataResult` from the SEDA FAST HTTP API (and captured fixtures).
 * Numeric fields may appear as decimal strings from JSON.
 */
export interface SedaFastDataResult {
  drId: string;
  gasUsed: string | bigint;
  blockHeight: string | bigint;
  blockTimestamp: string | bigint;
  consensus: boolean;
  exitCode: number;
  version: string;
  /** ABI-encoded tally bytes (`SedaPriceUpdate[]` for this adapter), hex with or without `0x`. */
  result: string;
  paybackAddress?: string;
  sedaPayload?: string;
}

function ensure0xHex(hex: string): string {
  const s = hex.trim();
  if (s === "") return "0x";
  return s.startsWith("0x") ? s : `0x${s}`;
}

/**
 * ABI-encodes `SignedPayload` for `IPyth.updatePriceFeeds` / `SedaPythAdapter.updatePriceFeeds`
 * from a SEDA FAST `dataResult` and the paired ECDSA signature.
 *
 * Passes the signature through unchanged; `FastProver` normalizes raw secp256k1 `v ∈ {0,1}` on-chain.
 */
export function encodeSignedPayloadFromFastDataResult(
  dataResult: SedaFastDataResult,
  signatureHex: string,
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const tuple = {
    drId: ensure0xHex(dataResult.drId),
    gasUsed: BigInt(dataResult.gasUsed),
    blockHeight: BigInt(dataResult.blockHeight),
    blockTimestamp: BigInt(dataResult.blockTimestamp),
    consensus: dataResult.consensus,
    exitCode: dataResult.exitCode,
    version: dataResult.version,
    result: ensure0xHex(dataResult.result),
    paybackAddress: ensure0xHex(dataResult.paybackAddress ?? ""),
    sedaPayload: ensure0xHex(dataResult.sedaPayload ?? ""),
  };

  const data = abiCoder.encode([RESULT_ABI_TYPE], [tuple]);
  const signature = ensure0xHex(signatureHex);
  const sigLen = ethers.getBytes(signature).length;
  if (sigLen !== 65) {
    throw new Error(`expected 65-byte ECDSA signature, got ${sigLen} bytes`);
  }

  return abiCoder.encode([SIGNED_PAYLOAD_ABI_TYPE], [{ data, signature }]);
}
