// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FastProver} from "../../src/prover/FastProver.sol";

/// @title FastProverV2Mock
/// @notice Test-only V2 implementation used to exercise local upgrade flows.
/// @custom:oz-upgrades-from src/prover/FastProver.sol:FastProver
contract FastProverV2Mock is FastProver {
    /// @notice Reinitializer for V2 upgrade smoke tests.
    /// @custom:oz-upgrades-unsafe-allow missing-initializer-call
    /// @custom:oz-upgrades-validate-as-initializer
    function initializeV2() external reinitializer(2) {}

    /// @notice Returns the implementation version for upgrade smoke tests.
    function version() external pure returns (uint256) {
        return 2;
    }
}
