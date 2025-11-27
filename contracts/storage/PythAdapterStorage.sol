// SPDX-License-Identifier: MIT
pragma solidity >=0.8.28 <0.9.0;

/// @title PythAdapterStorage
/// @author Open Oracle Association
/// @notice Storage library for Pyth adapter using the ERC-7201 storage pattern.
/// @dev Storage layout and structs for Pyth adapter, including price info mapping and asset IDs.
/// @custom:storage-location pythadapter.storage.v1
library PythAdapterStorage {
    // ============ Constants ============

    /// @notice ERC-7201 storage slot for PythAdapterStorage (version 1)
    /// @dev Namespace: "pythadapter.storage.v1"
    ///      ERC-7201 calculation: keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT_V1 =
        keccak256(abi.encode(uint256(keccak256("pythadapter.storage.v1")) - 1)) & ~bytes32(uint256(0xff));

    // ============ Structs ============

    /// @notice Stores price information for a single asset, including EMA and confidence values
    /// @dev Used as the value type in the mapping from assetId to PriceInfo in PythAdapterStorage.
    ///      This struct is packed into two storage slots for gas efficiency.
    struct PriceInfo {
        // slot 1
        uint64 publishTime; /// @notice The timestamp (seconds) when the price was published
        int32 expo; /// @notice The exponent (decimals) for the price value
        int64 price; /// @notice The latest reported price (scaled by expo)
        uint64 conf; /// @notice Confidence interval for the price (same scale as price)
        // slot 2
        int64 emaPrice; /// @notice Exponential moving average price (scaled by expo)
        uint64 emaConf; /// @notice Confidence interval for the EMA price (same scale as price)
    }

    /// @notice Storage layout for PythAdapterStorage (v1)
    /// @dev Do not change the order of fields. For new fields, create a new versioned layout.
    struct Layout {
        /// @notice Mapping from assetId to stored price information
        mapping(bytes32 => PriceInfo) priceInfos;
        /// @notice Array of all registered asset IDs
        bytes32[] assetIds;
    }

    // ============ Functions ============

    /// @notice Returns the storage struct at the ERC-7201 storage slot
    /// @return s The storage struct containing the contract's state variables
    /// @dev Accesses the contract's storage layout using assembly based on the ERC-7201 slot.
    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = STORAGE_SLOT_V1;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            s.slot := slot
        }
    }
}
