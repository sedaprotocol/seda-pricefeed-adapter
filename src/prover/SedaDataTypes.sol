// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SedaDataTypes Library
/// @author Open Oracle Association
/// @notice Data structures and utility functions for SEDA oracle results consumed by this repo.
/// @dev Only the `Result` shape and `deriveResultId` are used on-chain. Other SEDA types
///      (requests, batches, validator proofs) are not needed for the FAST verification path
///      and are intentionally omitted.
library SedaDataTypes {
    /// @notice Semantic version of the SEDA types layout. Mixed into `deriveResultId` to
    ///         domain-separate this version from future layouts.
    string internal constant VERSION = "0.0.1";

    /// @notice Result of a data request execution
    struct Result {
        /// Data Request Identifier
        bytes32 drId;
        /// Gas used by the complete data request execution
        uint128 gasUsed;
        /// Block Height at which data request was finalized
        uint64 blockHeight;
        /// Block timestamp when this result was included
        uint64 blockTimestamp;
        /// Whether reveal-phase results reached consensus (≥ 66%)
        bool consensus;
        /// Exit code of Tally WASM binary execution
        uint8 exitCode;
        /// Semantic Version
        string version;
        /// Result from Tally WASM binary execution
        bytes result;
        /// Payback address set by the relayer
        bytes paybackAddress;
        /// Payload set by SEDA Protocol (e.g. OEV-enabled data requests)
        bytes sedaPayload;
    }

    /// @notice Derives a unique result ID from a Result struct
    /// @param result The Result struct to derive the ID from
    /// @return The derived result ID
    function deriveResultId(Result memory result) internal pure returns (bytes32) {
        return
            keccak256(
                bytes.concat(
                    keccak256(bytes(SedaDataTypes.VERSION)),
                    result.drId,
                    result.consensus ? bytes1(0x01) : bytes1(0x00),
                    bytes1(result.exitCode),
                    keccak256(result.result),
                    bytes8(result.blockHeight),
                    bytes8(result.blockTimestamp),
                    bytes16(result.gasUsed),
                    keccak256(result.paybackAddress),
                    keccak256(result.sedaPayload)
                )
            );
    }
}
