# SEDA PriceFeedAdapter

A specialized smart contract for verifying SEDA oracle results using cryptographic proofs. This project demonstrates how to integrate with the [SEDA Protocol](https://www.seda.xyz/) oracle network for result verification and event-driven architectures.

## 🏗️ Project Overview

The **PriceFeedAdapter** is a verification-oriented contract that focuses on verifying oracle results using cryptographic proofs and emitting verification events.

## 📋 Table of Contents

- [What is SEDA?](#what-is-seda)
- [Features](#features)
- [Installation & Setup](#installation--setup)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Contributing](#contributing)

## 🌟 What is SEDA?

SEDA is a modular data layer that allows any blockchain to configure its own data feed from scratch. It provides:

- **Decentralized Oracle Network**: Distributed validators provide secure data feeds
- **Cryptographic Verification**: Results are verified using Merkle proofs and validator consensus
- **Flexible Data Sources**: Support for price feeds, weather data, sports results, and custom APIs
- **Cross-Chain Compatibility**: Works across multiple blockchain networks

## ✨ Features

The PriceFeedAdapter provides:

- ✅ **Result Verification**: Cryptographic verification using SEDA provers
- ✅ **Event Emission**: Real-time verification success/failure events
- ✅ **Data Integrity**: Consensus and exit code validation
- ✅ **Price Decoding**: Basic price data extraction from oracle results
- ✅ **Prover Management**: Owner-controlled prover address updates
- ✅ **Gas Efficient**: Minimal state changes, focused verification
- ✅ **Event-Driven**: Perfect for monitoring and integration systems

## 🚀 Installation & Setup

### Prerequisites
- Node.js v18+ (v23 has compatibility warnings)
- npm or yarn
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd pricefeed

# Install dependencies
npm install

# Compile contracts
npx hardhat compile
```

### Environment Setup

Create a `.env` file:

```env
# Network Configuration
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
POLYGON_RPC_URL=https://polygon-rpc.com
PRIVATE_KEY=your_private_key_here

# SEDA Prover Addresses (network-specific)
SEPOLIA_SEDA_PROVER=0x...
POLYGON_SEDA_PROVER=0x...

# Block Explorer API Keys
ETHERSCAN_API_KEY=your_etherscan_key
POLYGONSCAN_API_KEY=your_polygonscan_key
```

## 💡 Usage Examples

The PriceFeedAdapter is a **pure verification contract** focused on validating oracle results:

```typescript
// Deploy the adapter
const adapter = await PriceFeedAdapter.deploy(sedaProverAddress, owner);

// 1. Verify a result (view function - no gas cost)
const [isValid, batchSender] = await adapter.verifyResult(
  oracleResult,
  batchHeight, 
  merkleProof
);

// 2. Submit and verify a result (emits events)
const success = await adapter.submitResult(
  oracleResult,
  batchHeight, 
  merkleProof
);
// Events emitted: ResultVerified or VerificationFailed

// 3. Decode price data from oracle results
const price = await adapter.decodePriceResult(resultData);

// 4. Listen to verification events for real-time monitoring
adapter.on("ResultVerified", (requestId, symbol, price, batchHeight, batchSender) => {
  console.log(`✅ Verified: ${symbol} = $${ethers.formatUnits(price, 8)}`);
});

adapter.on("VerificationFailed", (requestId, reason) => {
  console.log(`❌ Failed: ${requestId} - ${reason}`);
});
```

**Key Characteristics:**
- ✅ **Stateless**: No data storage, pure verification
- ✅ **Event-driven**: Emits events for external monitoring
- ✅ **Gas efficient**: Minimal state changes
- ✅ **Focused**: Does one thing well - cryptographic verification

## 🧪 Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run adapter tests
npx hardhat test test/PriceFeedAdapter.test.ts

# Run with gas reporting
REPORT_GAS=true npm test
```

### Test Coverage

- **PriceFeedAdapter**: 18 comprehensive tests covering result verification, event emission, prover management
- **Mock Contracts**: Complete mock prover for isolated testing
- **Integration Tests**: End-to-end verification workflows

## 🚀 Deployment

### Local Development

```bash
# Deploy to local Hardhat network
npx hardhat run scripts/deployAdapter.ts --network localhost

# Interact with the contract
npx hardhat run scripts/interactAdapter.ts
```

### Testnet Deployment

```bash
# Deploy to Sepolia
npx hardhat run scripts/deployAdapter.ts --network sepolia

# Verify on Etherscan
npx hardhat verify --network sepolia DEPLOYED_ADDRESS "constructor" "args"
```

### Production Deployment

```bash
# Deploy to mainnet (Polygon example)
npx hardhat run scripts/deployAdapter.ts --network polygon
```

## 🏛️ Architecture

### SEDA Protocol Flow

```mermaid
graph TD
    A[dApp/Contract] --> B[SEDA Request]
    B --> C[Oracle Network]
    C --> D[Data Sources]
    D --> C
    C --> E[Consensus]
    E --> F[Batch Creation]
    F --> G[Merkle Root]
    G --> H[On-Chain Proof]
    H --> I[Result Verification]
    I --> J[Data Consumer]
```

### Contract Architecture

```mermaid
graph LR
    A[PriceFeedAdapter] --> B[IProver]
    B --> C[Secp256k1Prover]
    C --> D[Merkle Verification]
    A --> E[Event Emission]
    A --> F[Price Decoding]
```

### Data Flow

**PriceFeedAdapter Flow:**
1. External oracle result with proof
2. Contract verifies proof against prover
3. Validation of consensus and exit codes
4. Event emission for verification results

## 📁 Project Structure

```
pricefeed/
├── contracts/
│   ├── PriceFeedAdapter.sol      # SEDA result verification contract
│   └── mocks/
│       └── MockSedaProver.sol    # Mock prover for testing
├── scripts/
│   ├── deployAdapter.ts          # Deploy PriceFeedAdapter
│   └── interactAdapter.ts        # Interact with adapter
├── test/
│   └── PriceFeedAdapter.test.ts  # Comprehensive test suite
└── README.md                     # This file
```

## 🔧 Configuration

### Network Configuration

The project supports multiple networks:

- **Local**: Hardhat network with mock prover
- **Sepolia**: Ethereum testnet  
- **Polygon**: Mainnet deployment
- **Custom**: Add your own network configuration

### Gas Optimization

Both contracts are optimized for gas efficiency:

- **Efficient Storage**: Packed structs for minimal storage slots
- **Batch Operations**: Support for multiple operations
- **View Functions**: Extensive read-only functions for off-chain queries

## 🛡️ Security Considerations

### PriceFeedAdapter Security  
- ✅ Cryptographic verification of all results
- ✅ Consensus validation requirements
- ✅ Batch sender authentication
- ✅ Timestamp and exit code validation
- ✅ Reentrancy protection on critical functions
- ✅ Owner controls for prover management
- ✅ Input validation for all external calls

### General Security
- ✅ OpenZeppelin contracts for proven security patterns
- ✅ Comprehensive test coverage
- ✅ Static analysis compatibility
- ✅ Minimal attack surface (stateless design)

## 🌍 Multi-Chain Support

The contracts are designed for easy multi-chain deployment:

- **Ethereum**: Mainnet and testnets
- **Polygon**: MATIC network support
- **Arbitrum**: Layer 2 compatibility  
- **Optimism**: Optimistic rollup support
- **Custom**: Easy adaptation for other EVM chains

## 🔮 Future Enhancements

### Planned Features
- [ ] **Automated Request Management**: Scheduled price updates
- [ ] **Advanced Fee Strategies**: Dynamic fee calculation
- [ ] **Multi-Asset Support**: Portfolio-based price feeds
- [ ] **Integration Templates**: Ready-to-use DeFi integrations
- [ ] **Monitoring Dashboard**: Real-time contract monitoring
- [ ] **Cross-Chain Bridges**: Multi-chain price synchronization

### Integration Roadmap
- [ ] **Multi-Prover Support**: Support for multiple verification backends
- [ ] **Result Aggregation**: Combine verification results from multiple sources
- [ ] **Advanced Event Filtering**: Enhanced event filtering capabilities
- [ ] **Verification Analytics**: Built-in metrics and monitoring

## 🤝 Contributing

Contributions are welcome! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add comprehensive tests
5. Submit a pull request

### Development Setup

```bash
# Install development dependencies
npm install --dev

# Run linting
npm run lint

# Run security analysis
npm run security

# Generate documentation
npm run docs
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [SEDA Protocol Docs](https://docs.seda.xyz)
- **Discord**: [SEDA Community](https://discord.gg/seda)
- **GitHub Issues**: For bugs and feature requests
- **Email**: For private inquiries

## ⚡ Quick Start

```bash
# 1. Setup project
git clone <repo> && cd pricefeed && npm install

# 2. Compile contracts  
npx hardhat compile

# 3. Run tests
npm test

# 4. Deploy locally
npx hardhat run scripts/deployAdapter.ts

# 5. Interact with the contract
npx hardhat run scripts/interactAdapter.ts

# 6. Start building! 🚀
```

---

**Built with ❤️ for the SEDA ecosystem**
