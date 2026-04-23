import * as fs from "node:fs";
import * as path from "node:path";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { FastProver } from "../../typechain-types/contracts/prover/FastProver";
import type { SedaPythAdapter } from "../../typechain-types/contracts/SedaPythAdapter";
import { computeFeedId, deriveResultId } from "../helpers";

// Real production vector captured from the SEDA FAST service.
// See ./fast-execution.json — { request, response } captured from the live service.
const FAST_VECTOR = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fast-service-execution.json"), "utf8"),
);
const FAST_EXEC = FAST_VECTOR.request;
const FAST_RESPONSE = FAST_VECTOR.response;

// Public key of the SEDA FAST signer (compressed secp256k1).
const FAST_SIGNER_PUBKEY =
  "0x021eacf821d4d21ad61515fc1212ca75739730bf0abcf4925045e3ebde0f93a7e8";

// ABI types (duplicated locally to keep this test self-contained).
const RESULT_ABI_TYPE =
  "tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload)";
const SIGNED_PAYLOAD_ABI_TYPE = "tuple(bytes data, bytes signature)";

// SEDA FAST emits signatures with v ∈ {0, 1} (raw secp256k1 recovery id).
// The contract's FastProver normalizes to Ethereum's v ∈ {27, 28} internally,
// so we only need this helper for offline signer recovery (ethers.recoverAddress
// requires canonical v). On-chain submission uses the raw signature as-is.
function normalizeFastSignature(hexSig: string): string {
  const clean = hexSig.startsWith("0x") ? hexSig.slice(2) : hexSig;
  const buf = Buffer.from(clean, "hex");
  if (buf.length !== 65) {
    throw new Error(`expected 65-byte signature, got ${buf.length}`);
  }
  if (buf[64] < 27) buf[64] += 27;
  return `0x${buf.toString("hex")}`;
}

function buildSedaResult() {
  const dr = FAST_RESPONSE.data.dataResult;
  return {
    drId: `0x${dr.drId}`,
    gasUsed: BigInt(dr.gasUsed),
    blockHeight: BigInt(dr.blockHeight),
    blockTimestamp: BigInt(dr.blockTimestamp),
    consensus: dr.consensus,
    exitCode: dr.exitCode,
    version: dr.version,
    result: `0x${dr.result}`,
    paybackAddress: dr.paybackAddress === "" ? "0x" : `0x${dr.paybackAddress}`,
    sedaPayload: dr.sedaPayload === "" ? "0x" : `0x${dr.sedaPayload}`,
  };
}

describe("SedaPythAdapter — real SEDA FAST production vector", () => {
  // Ethereum address derived from the SEDA FAST signer's compressed pubkey.
  const trustedSigner = ethers.computeAddress(FAST_SIGNER_PUBKEY);

  async function deployWithTrustedKey() {
    const [owner] = await ethers.getSigners();

    const FastProverFactory = await ethers.getContractFactory("FastProver");
    const fastProver = (await upgrades.deployProxy(
      FastProverFactory,
      [owner.address],
      { initializer: "initialize" },
    )) as unknown as FastProver;
    await fastProver.addTrustedKey(trustedSigner);

    const SedaPythAdapterFactory =
      await ethers.getContractFactory("SedaPythAdapter");
    const sedaPythAdapter = (await upgrades.deployProxy(
      SedaPythAdapterFactory,
      [await fastProver.getAddress(), owner.address],
      { initializer: "initialize" },
    )) as unknown as SedaPythAdapter;

    return { sedaPythAdapter, fastProver, owner };
  }

  it("recovers the SEDA FAST signer from the normalized signature", () => {
    const result = buildSedaResult();
    const resultId = deriveResultId(result);
    const sig = normalizeFastSignature(FAST_RESPONSE.data.signature);

    const recovered = ethers.recoverAddress(resultId, sig);
    expect(recovered).to.equal(trustedSigner);
  });

  it("accepts a real signed result end-to-end and updates the price feed", async () => {
    const { sedaPythAdapter } = await loadFixture(deployWithTrustedKey);

    const drId = `0x${FAST_RESPONSE.data.dataResult.drId}`;

    // Build the signed payload using the raw signature (v ∈ {0, 1}) exactly
    // as emitted by the SEDA FAST service. FastProver normalizes v on-chain.
    const result = buildSedaResult();
    const signature = `0x${FAST_RESPONSE.data.signature}`;

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      [RESULT_ABI_TYPE],
      [result],
    );
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      [SIGNED_PAYLOAD_ABI_TYPE],
      [{ data, signature }],
    );

    await sedaPythAdapter.updatePriceFeeds([payload]);

    // Verify the stored feed matches the values reported by the oracle.
    // See fast-response.data.execute.result for the human-readable feed JSON.
    const symbolId =
      "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e";
    const feedId = computeFeedId(drId, symbolId);

    const info = await sedaPythAdapter.getPriceInfo(feedId);
    expect(info.price).to.equal(7597665123165n);
    expect(info.conf).to.equal(1797622665n);
    expect(info.expo).to.equal(-8);
    expect(info.publishTime).to.equal(1776787268n);
    expect(info.emaPrice).to.equal(7597665123165n);
    expect(info.emaConf).to.equal(1797622665n);
  });

  it("sanity-checks that the vector's request matches the execProgramId in the response", () => {
    expect(FAST_EXEC.execProgramId).to.equal(
      FAST_RESPONSE.data.dataRequest.execProgramId,
    );
  });
});
