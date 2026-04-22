// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseSedaAdapter} from "./base/BaseSedaAdapter.sol";
import {BasePythAdapter} from "./base/BasePythAdapter.sol";
import {SedaDataTypes} from "./libraries/SedaDataTypes.sol";
import {PythStructs} from "./interfaces/pyth/PythStructs.sol";
import {PythAdapterStorage} from "./storage/PythAdapterStorage.sol";

/// @title SedaPythAdapter
/// @author Open Oracle Association
/// @notice SEDA-backed price feed adapter exposing the Pyth (`IPyth`) interface.
/// @dev Accepts signed SEDA FAST oracle results (via `BaseSedaAdapter`) and exposes them through
///      the Pyth interface (via `BasePythAdapter`). Each SEDA result carries an ABI-encoded
///      `SedaPriceUpdate[]` in `result.result`; this contract maps each entry to a Pyth-shaped
///      price, keyed by `feedId = keccak256(abi.encode(drId, symbolId))`.
/// @custom:security Inherits UUPS + Ownable + Pausable from `BaseSedaAdapter`. Oracle result
///                  authenticity is enforced by `FastProver`; consensus and a zero exit code are
///                  additionally required for every accepted result.
/// @custom:upgrades UUPS upgradeable, ERC-7201 storage layout (v1).
contract SedaPythAdapter is BaseSedaAdapter, BasePythAdapter {
    // ============ Structs ============

    /// @notice Per-symbol price update emitted by the oracle program's tally phase.
    /// @dev ABI-encoded as `SedaPriceUpdate[]` and returned in `result.result`.
    ///      `symbolId` is the per-asset identifier chosen by the oracle program (for Pyth-shaped
    ///      deployments this is typically the Pyth price feed id). The feedId used for storage
    ///      is `keccak256(abi.encode(drId, symbolId))`.
    struct SedaPriceUpdate {
        bytes32 symbolId;
        PythAdapterStorage.PriceInfo priceInfo;
    }

    // ============ Initialization ============

    /// @notice Initializes the SedaPythAdapter with required contracts and configuration
    /// @param sedaProverAddress Address of the SEDA FastProver contract for result verification
    /// @param owner Address that will have administrative privileges over the adapter
    function initialize(address sedaProverAddress, address owner) public initializer {
        __BaseSedaAdapter_init(sedaProverAddress, owner);
    }

    // ============ BasePythAdapter Overrides ============

    /// @inheritdoc BasePythAdapter
    function updatePriceFeeds(bytes[] calldata updateData) public payable override whenNotPaused {
        super.updatePriceFeeds(updateData);
    }

    /// @inheritdoc BasePythAdapter
    function updatePriceFeedsIfNecessary(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) public payable override whenNotPaused {
        super.updatePriceFeedsIfNecessary(updateData, priceIds, publishTimes);
    }

    /// @inheritdoc BasePythAdapter
    function parsePriceFeedUpdatesWithConfig(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minAllowedPublishTime,
        uint64 maxAllowedPublishTime,
        bool checkUniqueness,
        bool checkUpdateDataIsMinimal,
        bool storeUpdatesIfFresh
    ) public payable override returns (PythStructs.PriceFeed[] memory priceFeeds, uint64[] memory slots) {
        if (storeUpdatesIfFresh) {
            if (paused()) revert EnforcedPause();
        }
        return
            super.parsePriceFeedUpdatesWithConfig(
                updateData,
                priceIds,
                minAllowedPublishTime,
                maxAllowedPublishTime,
                checkUniqueness,
                checkUpdateDataIsMinimal,
                storeUpdatesIfFresh
            );
    }

    /// @notice Verifies + decodes a signed payload and returns feedIds with their decoded prices
    /// @param updateData The update data (SignedPayload with ABI-encoded Result + SEDA FAST signature)
    /// @return ids feedIds computed as `keccak256(abi.encode(drId, symbolId))`
    /// @return infos Decoded price infos from the oracle output
    function _processUpdateData(
        bytes calldata updateData
    ) internal view override returns (bytes32[] memory ids, PythAdapterStorage.PriceInfo[] memory infos) {
        SedaDataTypes.Result memory result = _verifySedaResult(updateData);

        SedaPriceUpdate[] memory ups = abi.decode(result.result, (SedaPriceUpdate[]));
        if (ups.length == 0) revert InvalidResult("No price updates found in batch");

        ids = new bytes32[](ups.length);
        infos = new PythAdapterStorage.PriceInfo[](ups.length);

        for (uint256 i = 0; i < ups.length; ++i) {
            ids[i] = _computeFeedId(result.drId, ups[i].symbolId);
            infos[i] = ups[i].priceInfo;
        }
    }
}
