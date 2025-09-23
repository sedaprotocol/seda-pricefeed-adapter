import { getAdapterContract } from "./common/contract";
import { sedaScope } from "./scope";

sedaScope
  .task("adapter:pause", "Pause the CoreAdapter (owner only)")
  .setAction(async (_taskArgs, hre) => {
    console.log(`\n⏸️  Pausing CoreAdapter on ${hre.network.name}...`);

    try {
      const { adapter } = await getAdapterContract(hre);
      const tx = await adapter.pause();
      await tx.wait();
      console.log("✅ Contract paused successfully");
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

sedaScope
  .task("adapter:unpause", "Unpause the CoreAdapter (owner only)")
  .setAction(async (_taskArgs, hre) => {
    console.log(`\n▶️  Unpausing CoreAdapter on ${hre.network.name}...`);

    try {
      const { adapter } = await getAdapterContract(hre);
      const tx = await adapter.unpause();
      await tx.wait();
      console.log("✅ Contract unpaused successfully");
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
