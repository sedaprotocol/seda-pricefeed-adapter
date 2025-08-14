# Seda Price Feeds – Design Summary

This repo implements a lightweight, modular, and AggregatorV3Interface-compatible system for on-chain price feeds verified by the SEDA protocol.

This system is designed for flexibility, gas efficiency, and future extensibility (e.g. incentives, multi-oracle support).

## Key Design Assumptions

### Data Encoding Requirements
The system assumes specific encoding formats for SEDA oracle inputs and outputs:

**Execution Inputs (`execInputs`):**
- Must be ABI-encoded as `string[]` containing ticker symbols
- Example: `["BTC-USDT", "ETH-USD"]` encoded as ABI bytes

**Oracle Results (`result.result`):**
- Must be ABI-encoded as `int256[]` containing price values
- Array length must match the input symbols array length
- Prices are stored as integers with configurable decimal precision (default: 6)

**Validation:**
- Contract validates that symbol count equals price count
- Empty symbol arrays are rejected
- Mismatched array lengths cause transaction revert

### SEDA Protocol Assumptions
- Oracle programs return consensus-verified results
- Results include Merkle proofs for batch inclusion verification
- Data request parameters (DR ID) must match expected configuration
- Exit codes must be 0 for successful execution

## Data Request Input Parameters

Some Data Request parameters are hardcoded in the Adapter and apply globally to all feeds for simplicity.

All deployed feeds currently share:
- Oracle Program ID (Exec + Tally)
- Tally Inputs
- Replication Factor
- Consensus Filter

However, some other parameters are left open for push-solver to update as long as the data request can be resolved successfully:
- Gas limits (Exec + Tally)
- Gas price
- Memo (to be discussed)

## Core Components

### PriceFeedAdapter (Core Coordinator)

Acts as the central component for coordinating price feeds. Implements UUPS upgradeable pattern with ERC-7201 storage layout.

Its responsibilities:
- **Factory**: Deploys new PriceFeed contracts using the EIP-1167 minimal proxy pattern with deterministic addressing
- **Registry**: Maps a ticker (e.g., "ETH/USD") to its corresponding PriceFeed contract address
- **Verification & Submission**: Exposes `submit()` and `submitForIndices()` functions that verify SEDA results and update corresponding PriceFeed contracts
- **Configuration Management**: Stores and manages SEDA oracle configuration parameters

Key features:
- **Upgradeable**: Uses UUPS pattern with ERC-7201 storage layout for upgrade safety
- **Pausable**: Emergency pause functionality for all price feed operations
- **Batch Processing**: Supports processing multiple tickers from a single result
- **Selective Updates**: `submitForIndices()` allows updating specific tickers from a batch result
- **Automatic Deployment**: Price feeds are created on-demand when first referenced

### PriceFeed (Implementation Contract)

Implements the AggregatorV2V3Interface for seamless integration with DeFi protocols.

Stores only:
- `latestAnswer` (int256)
- `latestTimestamp` (uint256) 
- `latestRoundId` (uint80)
- `updater` (address) - only the adapter can update
- `description` (string) - human-readable ticker description
- `decimals` (uint8) - precision for price data

Key features:
- **Minimal Storage**: Only stores latest price data, no historical data
- **Access Control**: Only the designated adapter can update price data
- **Timestamp Validation**: Prevents stale data updates
- **Proxy-Ready**: Designed for EIP-1167 minimal proxy pattern
- **DeFi Compatible**: Full AggregatorV2V3Interface implementation

## Deployment Architecture

The system uses a proxy-based deployment pattern:

1. **PriceFeed Implementation**: Deployed once as the logic contract
2. **PriceFeedAdapter Proxy**: UUPS upgradeable proxy with adapter logic
3. **PriceFeed Proxies**: EIP-1167 minimal proxies created on-demand per ticker

### Deployment Flow

1. Deploy PriceFeed implementation contract
2. Deploy PriceFeedAdapter proxy with initialization
3. Push-solver calls `submit(ticker, result, proof, ...)` 
4. Adapter verifies the proof, decodes value, and updates the feed
5. Price feeds are created automatically on first reference

## Key Features

### Result Verification
- **Merkle Proof Validation**: Verifies result inclusion in SEDA batch
- **Consensus Verification**: Ensures result meets consensus requirements
- **DR ID Validation**: Validates data request parameters match expected configuration
- **Exit Code Validation**: Ensures oracle execution completed successfully

### Gas Optimization
- **Minimal Proxies**: EIP-1167 pattern for efficient price feed deployment
- **Deterministic Addressing**: Predictable addresses for price feed contracts
- **Batch Processing**: Multiple tickers in single transaction (already implemented)
- **Selective Updates**: Update only specific tickers from batch results (already implemented)

### Security Features
- **Access Control**: Only adapter can update price feeds
- **Timestamp Validation**: Prevents stale data updates
- **Emergency Pause**: Global pause functionality
- **Upgrade Safety**: ERC-7201 storage layout prevents collisions

## Interface Compatibility

### AggregatorV3Interface
- `latestRoundData()` - Returns latest price data
- `getRoundData(uint80)` - Not supported (no historical data)
- `decimals()` - Returns precision (default: 6)
- `description()` - Returns ticker description
- `version()` - Returns interface version

### AggregatorV2V3Interface (inherited)
- `latestRound()` - Returns latest round ID
- `getAnswer(uint256)` - Not supported
- `getTimestamp(uint256)` - Not supported

## Configuration Management

The adapter stores a `PriceFeedConfig` struct containing:
- `execProgramId` - SEDA execution program identifier
- `tallyProgramId` - SEDA tally program identifier  
- `replicationFactor` - Required consensus participants
- `tallyInputs` - Input parameters for tally execution
- `consensusFilter` - Consensus validation criteria

## Current Implementation Status

### ✅ Implemented Features
- **Batch Updates**: `submit()` processes all tickers from a single result
- **Selective Updates**: `submitForIndices()` allows updating specific tickers
- **Automatic Feed Creation**: Price feeds deployed on first reference
- **Deterministic Addressing**: Predictable proxy addresses per ticker
- **Full AggregatorV3Interface**: Complete DeFi compatibility
- **Emergency Pause**: Global pause functionality
- **Upgradeable Architecture**: UUPS pattern with ERC-7201 storage

### 🔄 Planned Improvements
- **IERC2362 Support**: Consider exposing a `valueFor(bytes32 id)` interface
- **Incentivization**: Add per-feed or global incentive mechanisms for push-solvers
- **Multi-Program Support**: Enable feed-specific oracle program IDs and inputs
- **Historical Data**: Optional historical data storage for specific feeds
- **Updater Rotation (?)**: Allow changing the updater address for individual feeds
