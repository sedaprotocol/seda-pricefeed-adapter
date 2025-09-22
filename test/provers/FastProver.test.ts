import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { createTrustedKey, createUntrustedKey } from "../helpers/proverHelpers";

describe("FastProver", () => {
  async function deployFastProverFixture() {
    const trustedKey1 = createTrustedKey("validator1");
    const trustedKey2 = createTrustedKey("validator2");
    const untrustedKey = createUntrustedKey();
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

    it("Should revert when trying to initialize twice", async () => {
      const { fastProver, user } = await loadFixture(deployFastProverFixture);

      await expect(
        fastProver.initialize(user.address),
      ).to.be.revertedWithCustomError(fastProver, "InvalidInitialization");
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
      await expect(fastProver.removeTrustedKey(trustedKey2.address))
        .to.emit(fastProver, "TrustedKeyRemoved")
        .withArgs(trustedKey2.address, owner.address);

      expect(await fastProver.getTrustedKeysCount()).to.equal(1);
      expect(await fastProver.isTrustedKey(trustedKey2.address)).to.be.false;
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

    it("Should revert when non-owner tries to remove keys", async () => {
      const { fastProver, user, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      // First add the key as owner
      await fastProver.addTrustedKey(trustedKey1.address);

      // Then try to remove it as non-owner
      await expect(
        fastProver.connect(user).removeTrustedKey(trustedKey1.address),
      ).to.be.revertedWithCustomError(fastProver, "OwnableUnauthorizedAccount");
    });

    it("Should revert when trying to remove non-existent trusted key", async () => {
      const { fastProver, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      // Try to remove a key that was never added
      await expect(
        fastProver.removeTrustedKey(trustedKey1.address),
      ).to.be.revertedWithCustomError(fastProver, "TrustedKeyNotFound");
    });

    it("Should get all trusted keys", async () => {
      const { fastProver, trustedKey1, trustedKey2 } = await loadFixture(
        deployFastProverFixture,
      );

      // Initially no trusted keys
      expect(await fastProver.getAllTrustedKeys()).to.deep.equal([]);

      // Add first key
      await fastProver.addTrustedKey(trustedKey1.address);
      const keysAfterFirst = await fastProver.getAllTrustedKeys();
      expect(keysAfterFirst).to.deep.equal([trustedKey1.address]);

      // Add second key
      await fastProver.addTrustedKey(trustedKey2.address);
      const keysAfterSecond = await fastProver.getAllTrustedKeys();
      expect(keysAfterSecond).to.deep.equal([
        trustedKey1.address,
        trustedKey2.address,
      ]);

      // Remove first key
      await fastProver.removeTrustedKey(trustedKey1.address);
      const keysAfterRemoval = await fastProver.getAllTrustedKeys();
      expect(keysAfterRemoval).to.deep.equal([trustedKey2.address]);
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

    it("Should revert when non-owner tries to pause", async () => {
      const { fastProver, user } = await loadFixture(deployFastProverFixture);

      await expect(
        fastProver.connect(user).pause(),
      ).to.be.revertedWithCustomError(fastProver, "OwnableUnauthorizedAccount");
    });

    it("Should revert when non-owner tries to unpause", async () => {
      const { fastProver, user } = await loadFixture(deployFastProverFixture);

      // First pause as owner
      await fastProver.pause();

      // Then try to unpause as non-owner
      await expect(
        fastProver.connect(user).unpause(),
      ).to.be.revertedWithCustomError(fastProver, "OwnableUnauthorizedAccount");
    });

    it("Should allow key management when paused", async () => {
      const { fastProver, trustedKey1, trustedKey2 } = await loadFixture(
        deployFastProverFixture,
      );

      // Add a key first
      await fastProver.addTrustedKey(trustedKey1.address);

      // Pause the contract
      await fastProver.pause();

      // Should still be able to add/remove keys when paused
      await expect(fastProver.addTrustedKey(trustedKey2.address))
        .to.emit(fastProver, "TrustedKeyAdded")
        .withArgs(trustedKey2.address, await fastProver.owner());

      await expect(fastProver.removeTrustedKey(trustedKey1.address))
        .to.emit(fastProver, "TrustedKeyRemoved")
        .withArgs(trustedKey1.address, await fastProver.owner());

      expect(await fastProver.getTrustedKeysCount()).to.equal(1);
      expect(await fastProver.isTrustedKey(trustedKey2.address)).to.be.true;
    });

    it("Should revert verifyData when paused", async () => {
      const { fastProver, trustedKey1 } = await loadFixture(
        deployFastProverFixture,
      );

      await fastProver.addTrustedKey(trustedKey1.address);
      await fastProver.pause();

      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test data"));
      const validSig = await trustedKey1.signingKey.sign(dataHash);
      const validSignature = ethers.Signature.from(validSig).serialized;

      await expect(
        fastProver.verifyData(dataHash, validSignature),
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

    it("Should test _authorizeUpgrade onlyOwner modifier through upgrade", async () => {
      const { fastProver, user } = await loadFixture(deployFastProverFixture);

      // The _authorizeUpgrade function is internal and only called during upgrades
      // We test that the upgrade process works for the owner (which calls _authorizeUpgrade)
      const FastProverV2 = (
        await ethers.getContractFactory("FastProver")
      ).connect(user);

      // Try to upgrade as non-owner using the user account
      await expect(upgrades.upgradeProxy(fastProver, FastProverV2))
        .to.be.revertedWithCustomError(fastProver, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });
  });
});
