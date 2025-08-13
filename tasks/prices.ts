import { getAdapterContract } from "./common/contract";
import { sedaScope } from "./index";

sedaScope
  .task("adapter:tickers", "Get all registered ticker symbols")
  .setAction(async (_taskArgs, hre) => {
    console.log(`\n🔍 Getting registered tickers on ${hre.network.name}...`);

    try {
      const { adapter } = await getAdapterContract(hre);
      const tickers = await adapter.getAllTickers();

      console.log("\n📋 Registered tickers:");
      if (tickers.length === 0) {
        console.log("  No tickers registered yet");
      } else {
        tickers.forEach((ticker: string, index: number) => {
          console.log(`  ${index + 1}. ${ticker}`);
        });
      }
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

sedaScope
  .task("adapter:feed-address", "Get price feed address for a ticker")
  .addPositionalParam("ticker", "Ticker symbol (e.g., BTC-USDT)")
  .setAction(async (taskArgs, hre) => {
    console.log(
      `\n🔗 Getting price feed address for ${taskArgs.ticker} on ${hre.network.name}...`,
    );

    try {
      const { adapter } = await getAdapterContract(hre);
      const feedAddress = await adapter.getPriceFeedAddress(taskArgs.ticker);

      if (feedAddress === hre.ethers.ZeroAddress) {
        console.log(`❌ No price feed found for ${taskArgs.ticker}`);
      } else {
        console.log(`📈 Price feed for ${taskArgs.ticker}:`, feedAddress);
      }
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

sedaScope
  .task("adapter:price", "Get current price for a ticker")
  .addParam("ticker", "Ticker symbol (e.g., BTC-USDT)")
  .setAction(async (taskArgs, hre) => {
    console.log(
      `\n🔍 Getting current price for ${taskArgs.ticker} on ${hre.network.name}...`,
    );

    try {
      const { adapter } = await getAdapterContract(hre);
      const feedAddress = await adapter.getPriceFeedAddress(taskArgs.ticker);

      if (feedAddress === hre.ethers.ZeroAddress) {
        console.log(`❌ No price feed found for ${taskArgs.ticker}`);
        return;
      }

      const feed = await hre.ethers.getContractAt("PriceFeed", feedAddress);
      const [price, timestamp, roundId] = await Promise.all([
        feed.latestAnswer(),
        feed.latestTimestamp(),
        feed.latestRound(),
      ]);

      console.log(`\n💰 ${taskArgs.ticker} Price Data:`);
      console.log(`  - Price: ${price.toString()}`);
      console.log(`  - Round ID: ${roundId.toString()}`);
      console.log(
        `  - Last updated: ${new Date(Number(timestamp) * 1000).toISOString()}`,
      );
      console.log(`  - Feed address: ${feedAddress}`);
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

sedaScope
  .task("adapter:prices", "Get current prices for all registered tickers")
  .setAction(async (_taskArgs, hre) => {
    console.log(
      `\n🔍 Getting current prices for all tickers on ${hre.network.name}...`,
    );

    try {
      const { adapter } = await getAdapterContract(hre);
      const tickers = await adapter.getAllTickers();

      if (tickers.length === 0) {
        console.log("  No tickers registered yet");
        return;
      }

      console.log(`\n💰 Current Prices (${tickers.length} tickers):`);

      for (const ticker of tickers) {
        try {
          const feedAddress = await adapter.getPriceFeedAddress(ticker);

          if (feedAddress === hre.ethers.ZeroAddress) {
            console.log(`  ❌ ${ticker}: No price feed found`);
            continue;
          }

          const feed = await hre.ethers.getContractAt("PriceFeed", feedAddress);
          const [price, timestamp] = await Promise.all([
            feed.latestAnswer(),
            feed.latestTimestamp(),
          ]);

          const timeAgo = Math.floor(Date.now() / 1000 - Number(timestamp));
          const timeAgoStr =
            timeAgo < 60
              ? `${timeAgo}s ago`
              : timeAgo < 3600
                ? `${Math.floor(timeAgo / 60)}m ago`
                : `${Math.floor(timeAgo / 3600)}h ago`;

          console.log(`  - ${ticker}: ${price.toString()} (${timeAgoStr})`);
        } catch (error) {
          console.log(
            `  ❌ ${ticker}: Error - ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      console.log(
        "❌ Error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
