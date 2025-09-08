import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("FastProver", () => {
  async function deployFastProverFixture() {
    const trustedKey1 = new ethers.Wallet(ethers.id(`validator1`).slice(2, 66));
    const trustedKey2 = new ethers.Wallet(ethers.id(`validator2`).slice(2, 66));
    const untrustedKey = new ethers.Wallet(ethers.id(`untrusted`).slice(2, 66));
    const [owner, user] = await ethers.getSigners();

    const FastProver = await ethers.getContractFactory("FastProver");
    const fastProver = await upgrades.deployProxy(FastProver, [owner.address], {
      initializer: "initialize",
    });

    return { fastProver, owner, user, trustedKey1, trustedKey2, untrustedKey };
  }

  describe("Initialization", () => {
    it("Should initialize with correct owner and version", async () => {
      const { fastProver, owner } = await loadFixture(deployFastProverFixture);
      expect(await fastProver.owner()).to.equal(owner.address);
      expect(await fastProver.version()).to.equal(1);
    });

    it("Should revert when initializing with zero address", async () => {
      const FastProver = await ethers.getContractFactory("FastProver");
      await expect(
        upgrades.deployProxy(FastProver, [ethers.ZeroAddress], {
          initializer: "initialize",
        }),
      ).to.be.revertedWithCustomError(FastProver, "OwnableInvalidOwner");
    });
  });

  describe("Trusted Key Management", () => {
    it("Should add and remove trusted keys", async () => {
      const { fastProver, owner, trustedKey1, trustedKey2 } = await loadFixture(
        deployFastProverFixture,
      );

      // Add keys
      await expect(fastProver.addTrustedKey(trustedKey1.address))
        .to.emit(fastProver, "TrustedKeyAdded")
        .withArgs(trustedKey1.address, owner.address);

      await fastProver.addTrustedKey(trustedKey2.address);

      expect(await fastProver.getTrustedKeysCount()).to.equal(2);
      expect(await fastProver.isTrustedKey(trustedKey1.address)).to.be.true;

      // Remove key
      await expect(fastProver.removeTrustedKey(trustedKey1.address))
        .to.emit(fastProver, "TrustedKeyRemoved")
        .withArgs(trustedKey1.address, owner.address);

      expect(await fastProver.getTrustedKeysCount()).to.equal(1);
      expect(await fastProver.isTrustedKey(trustedKey1.address)).to.be.false;
    });

    it("Should revert when adding duplicate or zero address", async () => {
      const { fastProver, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      await fastProver.addTrustedKey(trustedKey1.address);

      await expect(
        fastProver.addTrustedKey(trustedKey1.address),
      ).to.be.revertedWithCustomError(fastProver, "DuplicateTrustedKey");

      await expect(
        fastProver.addTrustedKey(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(fastProver, "InvalidKeyAddress");
    });

    it("Should revert when non-owner tries to manage keys", async () => {
      const { fastProver, user, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      await expect(
        fastProver.connect(user).addTrustedKey(trustedKey1.address),
      ).to.be.revertedWithCustomError(fastProver, "OwnableUnauthorizedAccount");
    });
  });

  describe("Data Verification", () => {
    it("Should verify valid signatures and reject invalid ones", async () => {
      const { fastProver, trustedKey1, untrustedKey } = await loadFixture(
        deployFastProverFixture,
      );

      await fastProver.addTrustedKey(trustedKey1.address);

      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));

      // Valid signature
      const validSig = await trustedKey1.signingKey.sign(dataHash);
      const validSignature = ethers.Signature.from(validSig).serialized;
      const [valid, attester] = await fastProver.verifyData(
        dataHash,
        validSignature,
      );

      expect(valid).to.be.true;
      expect(attester).to.equal(trustedKey1.address);

      // Invalid signature (untrusted key)
      const invalidSig = await untrustedKey.signingKey.sign(dataHash);
      const invalidSignature = ethers.Signature.from(invalidSig).serialized;

      await expect(
        fastProver.verifyData(dataHash, invalidSignature),
      ).to.be.revertedWithCustomError(
        fastProver,
        "SignatureVerificationFailed",
      );
    });

    it("Should handle invalid signature format", async () => {
      const { fastProver, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      await fastProver.addTrustedKey(trustedKey1.address);
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));

      await expect(
        fastProver.verifyData(dataHash, "0x1234"),
      ).to.be.revertedWithCustomError(
        fastProver,
        "ECDSAInvalidSignatureLength",
      );
    });
  });

  describe("Pausable Functions", () => {
    it("Should allow owner to pause/unpause", async () => {
      const { fastProver, owner } = await loadFixture(deployFastProverFixture);

      await expect(fastProver.pause())
        .to.emit(fastProver, "Paused")
        .withArgs(owner.address);

      await expect(fastProver.unpause())
        .to.emit(fastProver, "Unpaused")
        .withArgs(owner.address);
    });

    it("Should revert operations when paused", async () => {
      const { fastProver, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      await fastProver.pause();

      await expect(
        fastProver.addTrustedKey(trustedKey1.address),
      ).to.be.revertedWithCustomError(fastProver, "EnforcedPause");
    });
  });

  describe("UUPS Upgrade", () => {
    it("Should upgrade and preserve state", async () => {
      const { fastProver, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      await fastProver.addTrustedKey(trustedKey1.address);

      const FastProverV2 = await ethers.getContractFactory("FastProver");
      const upgradedContract = await upgrades.upgradeProxy(
        fastProver,
        FastProverV2,
      );

      expect(await upgradedContract.getTrustedKeysCount()).to.equal(1);
      expect(await upgradedContract.isTrustedKey(trustedKey1.address)).to.be
        .true;
    });
  });
});
