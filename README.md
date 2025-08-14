# SEDA PriceFeedAdapter

A lightweight, modular price feed system that integrates with the [SEDA Protocol](https://www.seda.xyz/) oracle network. This project provides AggregatorV3Interface-compatible price feeds verified by SEDA's cryptographic proofs.

For detailed technical specifications, see [DESIGN.md](DESIGN.md).

## 🏗️ Project Overview

The **PriceFeedAdapter** creates and manages on-chain price feeds that are automatically updated when SEDA oracle results are submitted. It uses a proxy-based architecture for gas efficiency and supports batch processing of multiple price feeds.

## ✨ Key Features

- **AggregatorV3Interface Compatible**: Seamless integration with DeFi protocols
- **Automatic Feed Creation**: Price feeds are deployed on-demand when first referenced
- **Batch Processing**: Update multiple price feeds in a single transaction
- **Gas Optimized**: Uses EIP-1167 minimal proxies for efficient deployment
- **Upgradeable**: UUPS upgradeable pattern with ERC-7201 storage layout
- **Emergency Controls**: Global pause functionality for all operations

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Bun (recommended) or npm
- Git

### Installation

```bash
git clone <repository-url>
cd pricefeed-adapter
bun install
```

### Environment Setup

Create a `.env` file with your configuration:

```env
# Block explorer API key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_key
```

### 🛠️ Deployment

Deploy the PriceFeedAdapter using the hardhat task:

```bash
# Deploy to network
bunx hardhat seda deploy [--network networkName]

# Deploy with custom SEDA configuration
bunx hardhat seda deploy --drconfig deployments/drconfig.json [--network networkName]
```

### 📊 Querying Price Feeds

Once deployed, you can interact with the price feeds using the available tasks:

```bash
# Check adapter status and configuration
bunx hardhat seda adapter:status [--network networkName]

# List all registered ticker symbols
bunx hardhat seda adapter:tickers [--network networkName]

# Get prices for all registered tickers
bunx hardhat seda adapter:prices [--network networkName]

# Get current price for a specific ticker
bunx hardhat seda adapter:price --ticker BTC-USDT [--network networkName]

# Get the contract address for a specific price feed
bunx hardhat seda adapter:feed-address --ticker ETH-USD [--network networkName]
```

##️ Architecture

### Core Components

**PriceFeedAdapter**: The central coordinator that:
- Deploys new PriceFeed contracts using minimal proxies
- Maps ticker symbols to their corresponding PriceFeed addresses
- Verifies SEDA oracle results and updates price feeds
- Manages SEDA configuration parameters

**PriceFeed**: Individual price feed contracts that:
- Implement the AggregatorV2V3Interface for DeFi compatibility
- Store latest price data (price, timestamp, round ID)
- Can only be updated by the designated adapter
- Use minimal storage for gas efficiency

### Data Flow

1. **Oracle Request**: External system requests price data from SEDA
2. **Result Generation**: SEDA oracle network processes the request and generates results with cryptographic proofs
3. **Result Submission**: Push-solver submits results to the adapter with Merkle proofs
4. **Verification**: Adapter verifies the proof and validates consensus requirements
5. **Price Update**: Adapter updates the corresponding PriceFeed contracts
6. **DeFi Integration**: DeFi protocols can read prices using standard AggregatorV3Interface calls

### Deployment Pattern

The system uses a proxy-based deployment:

- **PriceFeed Implementation**: Deployed once as the logic contract
- **PriceFeedAdapter Proxy**: UUPS upgradeable proxy with adapter logic
- **PriceFeed Proxies**: EIP-1167 minimal proxies created on-demand per ticker

## 🧪 Development

### Testing

```bash
# Run all tests
bun test

# Run with gas reporting
REPORT_GAS=true bun test

# Run specific test file
bunx hardhat test test/PriceFeedAdapter.test.ts
```

### Code Linting

```bash
# Lint Solidity code
bun run lint:sol

# Lint TypeScript code
bun run lint:ts

# Fix linting issues
bun run lint:sol:fix
bun run lint:ts:fix
```

### Mock Price Updates

For testing purposes, you can submit mock price updates:

```bash
# Submit mock prices for testing
bunx hardhat seda:mock-prices [--network networkName]
```

## ⚙️ Configuration

### SEDA Parameters

The adapter stores configuration for SEDA oracle parameters:

- **Exec Program ID**: SEDA execution program identifier
- **Tally Program ID**: SEDA tally program identifier
- **Replication Factor**: Required consensus participants
- **Tally Inputs**: Input parameters for tally execution
- **Consensus Filter**: Consensus validation criteria

### Data Encoding

The system expects specific encoding formats:

**Execution Inputs**: ABI-encoded `string[]` containing ticker symbols
```solidity
["BTC-USDT", "ETH-USD"] // encoded as ABI bytes
```

**Oracle Results**: ABI-encoded `int256[]` containing price values
```solidity
[50000000000, 3000000000] // prices with 6 decimal precision
```

## 🛡️ Security

### Access Control
- Only the adapter can update price feed data
- Owner controls for adapter configuration and emergency pause
- Timestamp validation prevents stale data updates

### Verification
- Cryptographic verification of all SEDA results
- Merkle proof validation for batch inclusion
- Consensus and exit code validation
- Input validation for all external calls

### Emergency Controls
- Global pause functionality for all operations
- Upgradeable architecture with storage collision protection

## 🔗 Integration

### DeFi Protocol Integration

Price feeds implement the standard AggregatorV3Interface:

```solidity
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
}
```

### Reading Prices

You can read prices either directly from individual PriceFeed contracts or through the adapter:

```solidity
// Direct from PriceFeed contract
(uint80 roundId, int256 price, , uint256 updatedAt, ) = priceFeed.latestRoundData();

// Through the adapter
(uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) = 
    adapter.getLatestRoundData("BTC-USDT");
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with comprehensive tests
4. Submit a pull request

## 📄 License

This project is licensed under the ISC License.
