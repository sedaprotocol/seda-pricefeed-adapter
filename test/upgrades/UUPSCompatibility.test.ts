import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers, upgrades } from "hardhat";

/**
 * Ensures each release's implementation stays OpenZeppelin-upgrade-compatible with the
 * deployed proxy (storage layout + unsafe delegatecall patterns). CI runs this on every push.
 *
 * When you introduce a new implementation contract, extend these tests or add a dedicated
 * `validateUpgrade` call that uses the new factory against the relevant proxy fixture.
 */
describe("UUPS upgrade compatibility", () => {
  async function deployFastProverProxy() {
    const [owner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("FastProver");
    const proxy = await upgrades.deployProxy(Factory, [owner.address], {
      initializer: "initialize",
      kind: "uups",
    });
    return { proxy, Factory };
  }

  async function deploySedaPythAdapterProxy() {
    const [owner] = await ethers.getSigners();
    const FastProverFactory = await ethers.getContractFactory("FastProver");
    const fastProver = await upgrades.deployProxy(
      FastProverFactory,
      [owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    const AdapterFactory = await ethers.getContractFactory("SedaPythAdapter");
    const adapter = await upgrades.deployProxy(
      AdapterFactory,
      [await fastProver.getAddress(), owner.address],
      { initializer: "initialize", kind: "uups" },
    );
    return { adapter, AdapterFactory };
  }

  it("FastProver: validateUpgrade succeeds for the current implementation artifact", async () => {
    const { proxy, Factory } = await loadFixture(deployFastProverProxy);
    await upgrades.validateUpgrade(await proxy.getAddress(), Factory);
  });

  it("SedaPythAdapter: validateUpgrade succeeds for the current implementation artifact", async () => {
    const { adapter, AdapterFactory } = await loadFixture(
      deploySedaPythAdapterProxy,
    );
    await upgrades.validateUpgrade(await adapter.getAddress(), AdapterFactory);
  });
});
