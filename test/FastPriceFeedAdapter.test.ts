import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("FastPriceFeedAdapter", () => {
  async function deployFastPriceFeedAdapterFixture() {
    const [owner, user] = await ethers.getSigners();

    // Deploy FastProver contract
    const FastProver = await ethers.getContractFactory("FastProver");
    const fastProver = await upgrades.deployProxy(FastProver, [owner.address], {
      initializer: "initialize",
    });

    // Deploy FastPriceFeedAdapter
    const FastPriceFeedAdapter = await ethers.getContractFactory(
      "FastPriceFeedAdapter",
    );
    const fastPriceFeedAdapter = await upgrades.deployProxy(
      FastPriceFeedAdapter,
      [await fastProver.getAddress(), owner.address],
      {
        initializer: "initialize",
      },
    );

    return {
      fastPriceFeedAdapter,
      fastProver,
      owner,
      user,
    };
  }

  describe("Initialization", () => {
    it("Should initialize with correct parameters", async () => {
      const { fastPriceFeedAdapter, fastProver, owner } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      expect(await fastPriceFeedAdapter.owner()).to.equal(owner.address);
      expect(await fastPriceFeedAdapter.getProver()).to.equal(
        await fastProver.getAddress(),
      );
    });
  });

  describe("Prover Management", () => {
    it("Should allow owner to update prover", async () => {
      const { fastPriceFeedAdapter, fastProver } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      const [newOwner] = await ethers.getSigners();
      const NewFastProver = await ethers.getContractFactory("FastProver");
      const newFastProver = await upgrades.deployProxy(
        NewFastProver,
        [newOwner.address],
        {
          initializer: "initialize",
        },
      );

      await expect(
        fastPriceFeedAdapter.updateProver(await newFastProver.getAddress()),
      )
        .to.emit(fastPriceFeedAdapter, "ProverUpdated")
        .withArgs(
          await fastProver.getAddress(),
          await newFastProver.getAddress(),
        );

      expect(await fastPriceFeedAdapter.getProver()).to.equal(
        await newFastProver.getAddress(),
      );
    });

    it("Should revert when non-owner tries to update prover", async () => {
      const { fastPriceFeedAdapter, user } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      await expect(
        fastPriceFeedAdapter.connect(user).updateProver(user.address),
      ).to.be.revertedWithCustomError(
        fastPriceFeedAdapter,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert when updating prover to zero address", async () => {
      const { fastPriceFeedAdapter } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      await expect(
        fastPriceFeedAdapter.updateProver(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(fastPriceFeedAdapter, "InvalidParameter");
    });
  });

  describe("Pausable Functions", () => {
    it("Should allow owner to pause/unpause", async () => {
      const { fastPriceFeedAdapter, owner } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      await expect(fastPriceFeedAdapter.pause())
        .to.emit(fastPriceFeedAdapter, "Paused")
        .withArgs(owner.address);

      await expect(fastPriceFeedAdapter.unpause())
        .to.emit(fastPriceFeedAdapter, "Unpaused")
        .withArgs(owner.address);
    });

    it("Should revert when non-owner tries to pause", async () => {
      const { fastPriceFeedAdapter, user } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      await expect(
        fastPriceFeedAdapter.connect(user).pause(),
      ).to.be.revertedWithCustomError(
        fastPriceFeedAdapter,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("Price Feed Updates", () => {
    // it("Should submit valid price update", async () => {
    //   const { fastPriceFeedAdapter, fastProver, owner } =
    //     await loadFixture(deployFastPriceFeedAdapterFixture);

    //   // Add a trusted key to the prover
    //   const trustedKey = new ethers.Wallet(ethers.id(`validator1`).slice(2, 66));
    //   await fastProver.addTrustedKey(trustedKey.address);

    //   // Create test data
    //   const execProgramId = ethers.id("exec_program");
    //   const tallyProgramId = ethers.id("tally_program");
    //   const execInput = ethers.id("BTC/USD"); // This should be bytes32, not bytes
    //   const tallyInputs = ethers.toUtf8Bytes("tally_inputs");

    //   const priceInfo = {
    //     price: 50000n,
    //     conf: 100n,
    //     publishTime: Math.floor(Date.now() / 1000),
    //   };

    //   const result = {
    //     exitCode: 0,
    //     result: ethers.AbiCoder.defaultAbiCoder().encode(
    //       ["int64", "uint64", "uint64"],
    //       [priceInfo.price, priceInfo.conf, priceInfo.publishTime]
    //     ),
    //     blockTimestamp: Math.floor(Date.now() / 1000),
    //   };

    //   const batch = {
    //     execInputs: [execInput],
    //     programConfig: {
    //       execProgramId,
    //       tallyProgramId,
    //       tallyInputs,
    //     },
    //     results: [result],
    //   };

    //   // Encode the batch data
    //   const data = ethers.AbiCoder.defaultAbiCoder().encode(
    //     ["tuple(bytes32[],tuple(bytes32,bytes32,bytes),tuple(uint8,bytes,uint64)[])"],
    //     [batch]
    //   );

    //   const dataHash = ethers.keccak256(data);
    //   const signature = await trustedKey.signingKey.sign(dataHash);
    //   const serializedSignature = ethers.Signature.from(signature).serialized;

    //   // Create SignedPayload struct
    //   const signedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
    //     ["tuple(bytes,bytes)"],
    //     [{ data, signature: serializedSignature }]
    //   );

    //   // Submit the update
    //   await expect(fastPriceFeedAdapter.submit(signedPayload))
    //     .to.emit(fastPriceFeedAdapter, "PriceFeedUpdate");

    //   // Verify the price was stored
    //   const assetId = ethers.keccak256(
    //     ethers.AbiCoder.defaultAbiCoder().encode(
    //       ["bytes32", "bytes32", "bytes32", "bytes"],
    //       [execProgramId, execInput, tallyProgramId, tallyInputs]
    //     )
    //   );

    //   const storedPriceInfo = await fastPriceFeedAdapter.getPriceInfo(assetId);
    //   expect(storedPriceInfo.price).to.equal(priceInfo.price);
    //   expect(storedPriceInfo.conf).to.equal(priceInfo.conf);
    //   expect(storedPriceInfo.publishTime).to.equal(priceInfo.publishTime);
    // });

    it("Should revert with invalid signature", async () => {
      const { fastPriceFeedAdapter, fastProver } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      const invalidPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes data, bytes signature)"],
        [{ data: ethers.toUtf8Bytes("invalid"), signature: "0x1234" }],
      );

      // Invalid signature length (2 bytes)
      await expect(fastPriceFeedAdapter.updatePriceFeeds([invalidPayload]))
        .to.be.revertedWithCustomError(
          fastProver,
          "ECDSAInvalidSignatureLength",
        )
        .withArgs(2);
    });

    it("Should revert with empty batch", async () => {
      const { fastPriceFeedAdapter, fastProver } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      const trustedKey = new ethers.Wallet(
        ethers.id(`validator1`).slice(2, 66),
      );
      await fastProver.addTrustedKey(trustedKey.address);

      const emptyBatch = {
        programConfig: {
          execProgramId: ethers.id("exec_program"),
          tallyProgramId: ethers.id("tally_program"),
        },
        result: {
          drId: ethers.id("dr_id"),
          gasUsed: 100000,
          blockHeight: 12345,
          blockTimestamp: Math.floor(Date.now() / 1000),
          consensus: true,
          exitCode: 0,
          version: "0.0.1",
          result: ethers.AbiCoder.defaultAbiCoder().encode(
            [
              "tuple(bytes32 id,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
            ],
            [[]], // Empty PriceUpdate array
          ),
          paybackAddress: "0x0000000000000000000000000000000000000000",
          sedaPayload: "0x",
        },
      };

      const priceUpdateBatch = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
        ],
        [emptyBatch],
      );

      const dataHash = ethers.keccak256(priceUpdateBatch);
      const signature = await trustedKey.signingKey.sign(dataHash);
      const serializedSignature = ethers.Signature.from(signature).serialized;

      const signedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes data, bytes signature)"],
        [{ data: priceUpdateBatch, signature: serializedSignature }],
      );

      await expect(
        fastPriceFeedAdapter.updatePriceFeeds([signedPayload]),
      ).to.be.revertedWithCustomError(fastPriceFeedAdapter, "ValidationFailed");
    });

    it("Should revert with invalid exit code", async () => {
      const { fastPriceFeedAdapter, fastProver } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      const trustedKey = new ethers.Wallet(
        ethers.id(`validator1`).slice(2, 66),
      );
      await fastProver.addTrustedKey(trustedKey.address);

      const priceUpdate = {
        id: ethers.id("BTC/USD"),
        priceInfo: {
          publishTime: Math.floor(Date.now() / 1000),
          expo: -8,
          price: 50000n,
          conf: 100n,
          emaPrice: 50000n,
          emaConf: 100n,
        },
      };

      const result = {
        drId: ethers.id("dr_id"),
        gasUsed: 100000,
        blockHeight: 12345,
        blockTimestamp: Math.floor(Date.now() / 1000),
        consensus: true,
        exitCode: 1, // Invalid exit code
        version: "0.0.1",
        result: ethers.AbiCoder.defaultAbiCoder().encode(
          [
            "tuple(bytes32 id,tuple(uint64 publishTime,int32 expo,int64 price,uint64 conf,int64 emaPrice,uint64 emaConf) priceInfo)[]",
          ],
          [[priceUpdate]],
        ),
        paybackAddress: "0x0000000000000000000000000000000000000000",
        sedaPayload: "0x",
      };

      const batch = {
        programConfig: {
          execProgramId: ethers.id("exec_program"),
          tallyProgramId: ethers.id("tally_program"),
        },
        result: result,
      };

      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "tuple(tuple(bytes32 execProgramId,bytes32 tallyProgramId) programConfig,tuple(bytes32 drId,uint128 gasUsed,uint64 blockHeight,uint64 blockTimestamp,bool consensus,uint8 exitCode,string version,bytes result,bytes paybackAddress,bytes sedaPayload) result)",
        ],
        [batch],
      );

      const dataHash = ethers.keccak256(data);
      const signature = await trustedKey.signingKey.sign(dataHash);
      const serializedSignature = ethers.Signature.from(signature).serialized;

      // Fix: Use struct syntax to match contract
      const signedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes data, bytes signature)"],
        [{ data, signature: serializedSignature }],
      );

      await expect(
        fastPriceFeedAdapter.updatePriceFeeds([signedPayload]),
      ).to.be.revertedWithCustomError(fastPriceFeedAdapter, "ValidationFailed");
    });

    it("Should revert when paused", async () => {
      const { fastPriceFeedAdapter } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      await fastPriceFeedAdapter.pause();

      // Fix: Use struct syntax to match contract
      const invalidPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes data, bytes signature)"],
        [{ data: ethers.toUtf8Bytes("test"), signature: "0x1234" }],
      );

      await expect(
        fastPriceFeedAdapter.updatePriceFeeds([invalidPayload]),
      ).to.be.revertedWithCustomError(fastPriceFeedAdapter, "EnforcedPause");
    });
  });

  describe("View Functions", () => {
    it("Should return empty asset IDs initially", async () => {
      const { fastPriceFeedAdapter } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      const assetIds = await fastPriceFeedAdapter.getAssetIds();
      expect(assetIds.length).to.equal(0);
    });

    it("Should return zero price info for non-existent asset", async () => {
      const { fastPriceFeedAdapter } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      const nonExistentAssetId = ethers.id("non_existent");
      const priceInfo =
        await fastPriceFeedAdapter.getPriceInfo(nonExistentAssetId);

      expect(priceInfo.price).to.equal(0);
      expect(priceInfo.conf).to.equal(0);
      expect(priceInfo.publishTime).to.equal(0);
    });
  });

  describe("UUPS Upgrade", () => {
    it("Should upgrade and preserve state", async () => {
      const { fastPriceFeedAdapter } = await loadFixture(
        deployFastPriceFeedAdapterFixture,
      );

      // Verify initial state
      const initialProver = await fastPriceFeedAdapter.getProver();

      // Upgrade the contract
      const FastPriceFeedAdapterV2 = await ethers.getContractFactory(
        "FastPriceFeedAdapter",
      );
      const upgradedContract = await upgrades.upgradeProxy(
        fastPriceFeedAdapter,
        FastPriceFeedAdapterV2,
      );

      // Verify state is preserved
      expect(await upgradedContract.getProver()).to.equal(initialProver);
    });
  });
});
