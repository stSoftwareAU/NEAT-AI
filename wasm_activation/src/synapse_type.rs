//! Synapse type definitions for aggregate functions.
//!
//! This module provides the synapse type enum used by IF squash function
//! to categorise inputs (Issue #1125).

/// Synapse type identifiers for aggregate functions (Issue #1125)
/// These are used by IF squash function to categorise inputs
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SynapseType {
    /// Standard synapse (no special type) - also used as "positive" for IF
    Standard = 0,
    /// Condition synapse for IF activation
    Condition = 1,
    /// Negative synapse for IF activation
    Negative = 2,
    /// Positive synapse for IF activation (explicit)
    Positive = 3,
}

impl From<u8> for SynapseType {
    fn from(v: u8) -> Self {
        match v {
            1 => SynapseType::Condition,
            2 => SynapseType::Negative,
            3 => SynapseType::Positive,
            _ => SynapseType::Standard,
        }
    }
}
