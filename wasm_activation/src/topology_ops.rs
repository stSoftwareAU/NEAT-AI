//! Issue #1959 - Selective WASM residency for read-heavy topology operations.
//!
//! Provides WASM-resident implementations of three read-heavy topology operations
//! that benefit from native code execution with typed array data:
//!
//! 1. Forward-only topology validation (`validate_topology`)
//! 2. Available connection scanning (`scan_available_connections`)
//! 3. Reverse topological order computation (`compute_reverse_topological_order`)
//!
//! These functions operate directly on typed arrays from TypedTopology,
//! eliminating the need for custom binary serialisation. The typed arrays
//! are passed as slices via wasm-bindgen, which translates to zero-copy
//! views into WASM linear memory.

use wasm_bindgen::prelude::*;

/// Error codes for topology validation — must match TypeScript constants
/// in WasmTopologyOps.ts.
const VALID: i32 = 0;
const SELF_CONNECTION: i32 = 1;
const BACKWARD_CONNECTION: i32 = 2;
const SORT_ERROR_FROM: i32 = 3;
const SORT_ERROR_TO: i32 = 4;
const DUPLICATE_CONNECTION: i32 = 5;

/// Issue #1959 - Validate topology synapse ordering and forward-only constraints.
///
/// Checks that synapses are sorted (ascending from, then ascending to within
/// the same from), contain no self-connections, and contain no backward
/// connections (from > to).
///
/// Operates directly on typed arrays from TypedTopology without custom
/// binary serialisation — wasm-bindgen passes the arrays as slices.
///
/// # Arguments
/// * `from_indices` - Uint32Array of source neuron indices per synapse
/// * `to_indices` - Uint32Array of destination neuron indices per synapse
///
/// # Returns
/// Int32Array of length 2: `[error_code, synapse_index]`
/// - error_code 0 = valid topology
/// - error_code 1 = self-connection at synapse_index
/// - error_code 2 = backward connection at synapse_index
/// - error_code 3 = from indices not sorted at synapse_index
/// - error_code 4 = to indices not sorted within same from at synapse_index
/// - error_code 5 = duplicate connection at synapse_index
#[wasm_bindgen]
pub fn validate_topology(from_indices: &[u32], to_indices: &[u32]) -> Vec<i32> {
    let len = from_indices.len();
    if len != to_indices.len() {
        return vec![SORT_ERROR_FROM, 0];
    }

    let mut last_from: i64 = -1;
    let mut last_to: i64 = -1;

    for i in 0..len {
        let from = from_indices[i] as i64;
        let to = to_indices[i] as i64;

        // Self-connection check
        if from == to {
            return vec![SELF_CONNECTION, i as i32];
        }

        // Backward connection check
        if from > to {
            return vec![BACKWARD_CONNECTION, i as i32];
        }

        // Sort order check: from indices must be non-decreasing
        if from < last_from {
            return vec![SORT_ERROR_FROM, i as i32];
        } else if from > last_from {
            last_to = -1;
        }

        // Within same from, to indices must be strictly increasing
        if from == last_from {
            if to < last_to {
                return vec![SORT_ERROR_TO, i as i32];
            } else if to == last_to {
                return vec![DUPLICATE_CONNECTION, i as i32];
            }
        }

        last_from = from;
        last_to = to;
    }

    vec![VALID, 0]
}

/// Issue #1959 - Scan for available forward-only connection slots.
///
/// Computes all `(from, to)` pairs where `from < to`, `to >= num_inputs`,
/// the target neuron is not constant, and no connection already exists.
///
/// Uses a flat boolean array for O(1) connection existence checks,
/// which is more cache-friendly than a hash set for WASM linear memory.
///
/// # Arguments
/// * `from_indices` - Uint32Array of existing synapse source indices
/// * `to_indices` - Uint32Array of existing synapse destination indices
/// * `is_constant` - Uint8Array flag per neuron (1 = constant, 0 = not)
/// * `num_neurons` - Total number of neurons
/// * `num_inputs` - Number of input neurons
///
/// # Returns
/// Uint32Array of flattened `[from, to, from, to, ...]` pairs
#[wasm_bindgen]
pub fn scan_available_connections(
    from_indices: &[u32],
    to_indices: &[u32],
    is_constant: &[u8],
    num_neurons: u32,
    num_inputs: u32,
) -> Vec<u32> {
    let n = num_neurons as usize;
    let input_count = num_inputs as usize;

    // Build connection set as a flat boolean array for O(1) lookup.
    // Key encoding: from * num_neurons + to.
    let mut conn_set = vec![false; n * n];
    for i in 0..from_indices.len() {
        let from = from_indices[i] as usize;
        let to = to_indices[i] as usize;
        if from < n && to < n {
            conn_set[from * n + to] = true;
        }
    }

    let mut available = Vec::new();

    for from_idx in 0..n {
        let start_to = if from_idx + 1 > input_count {
            from_idx + 1
        } else {
            input_count
        };
        for to_idx in start_to..n {
            // Skip constant neurons
            if to_idx < is_constant.len() && is_constant[to_idx] != 0 {
                continue;
            }
            // Check if connection doesn't exist
            if !conn_set[from_idx * n + to_idx] {
                available.push(from_idx as u32);
                available.push(to_idx as u32);
            }
        }
    }

    available
}

/// Issue #1959 - Compute reverse topological order for backpropagation.
///
/// Uses Kahn's algorithm on the forward connection graph. Returns neuron
/// indices ordered with output neurons first, hidden neurons after their
/// downstream consumers. Input and constant neurons are excluded.
///
/// For recurrent networks with cycles, neurons remaining after the
/// topological sort are appended at the end.
///
/// # Arguments
/// * `from_indices` - Uint32Array of synapse source indices
/// * `to_indices` - Uint32Array of synapse destination indices
/// * `num_neurons` - Total number of neurons
/// * `num_inputs` - Number of input neurons
///
/// # Returns
/// Uint32Array of neuron indices in reverse topological order
#[wasm_bindgen]
pub fn compute_reverse_topological_order(
    from_indices: &[u32],
    to_indices: &[u32],
    num_neurons: u32,
    num_inputs: u32,
) -> Vec<u32> {
    let n = num_neurons as usize;
    let input_count = num_inputs as usize;

    // Count outgoing forward edges for each non-input neuron
    let mut out_degree = vec![0i32; n];

    // Build inward adjacency list
    let mut inward: Vec<Vec<u32>> = vec![Vec::new(); n];

    for i in 0..from_indices.len() {
        let from = from_indices[i] as usize;
        let to = to_indices[i] as usize;

        if from == to {
            continue;
        } // Skip self-loops

        if from >= input_count {
            out_degree[from] += 1;
        }

        inward[to].push(from as u32);
    }

    // Start with neurons that have no outgoing forward edges
    let mut queue: Vec<usize> = Vec::new();
    for i in input_count..n {
        if out_degree[i] == 0 {
            queue.push(i);
        }
    }

    let mut result: Vec<u32> = Vec::new();
    let mut visited = vec![false; n];
    let mut head = 0;

    while head < queue.len() {
        let idx = queue[head];
        head += 1;

        if visited[idx] {
            continue;
        }
        visited[idx] = true;
        result.push(idx as u32);

        // For each inward connection, decrement source's out-degree
        for j in 0..inward[idx].len() {
            let from = inward[idx][j] as usize;
            if from == idx {
                continue;
            } // Skip self-loops
            if from < input_count {
                continue;
            } // Skip input neurons
            if visited[from] {
                continue;
            }

            out_degree[from] -= 1;
            if out_degree[from] <= 0 {
                queue.push(from);
            }
        }
    }

    // Handle remaining neurons in cycles (recurrent connections)
    for i in input_count..n {
        if !visited[i] {
            result.push(i as u32);
        }
    }

    result
}

/// Issue #1960 - Batch topology validation for multiple creatures.
///
/// Validates multiple topologies in a single WASM call to amortise boundary
/// crossing overhead. Each topology's from/to indices are concatenated, with
/// a lengths array specifying where each topology's data ends.
///
/// # Arguments
/// * `all_from_indices` - Concatenated from indices for all topologies
/// * `all_to_indices` - Concatenated to indices for all topologies
/// * `lengths` - Number of synapses per topology (used to split the arrays)
///
/// # Returns
/// Int32Array of length 2×N (N = number of topologies):
///   `[error_code_0, synapse_index_0, error_code_1, synapse_index_1, ...]`
#[wasm_bindgen]
pub fn validate_topology_batch(
    all_from_indices: &[u32],
    all_to_indices: &[u32],
    lengths: &[u32],
) -> Vec<i32> {
    let num_topologies = lengths.len();
    let mut result = vec![0i32; num_topologies * 2];
    let mut offset: usize = 0;

    for t in 0..num_topologies {
        let len = lengths[t] as usize;
        let end = offset + len;

        if end > all_from_indices.len() || end > all_to_indices.len() {
            result[t * 2] = SORT_ERROR_FROM;
            result[t * 2 + 1] = 0;
            offset = end;
            continue;
        }

        let from_slice = &all_from_indices[offset..end];
        let to_slice = &all_to_indices[offset..end];
        let single_result = validate_topology(from_slice, to_slice);

        result[t * 2] = single_result[0];
        result[t * 2 + 1] = single_result[1];

        offset = end;
    }

    result
}

// ===========================================================================
// Issue #1961 — Structural integrity error codes
// ===========================================================================

const STRUCTURAL_VALID: i32 = 0;
const STRUCTURAL_SYNAPSE_TARGETS_INPUT: i32 = 1;
const STRUCTURAL_CONSTANT_HAS_INWARD: i32 = 2;
const STRUCTURAL_HIDDEN_NO_INWARD: i32 = 3;
const STRUCTURAL_HIDDEN_NO_OUTWARD: i32 = 4;
const STRUCTURAL_BIAS_NOT_FINITE: i32 = 5;
const STRUCTURAL_IF_TOO_FEW_INWARD: i32 = 6;
const STRUCTURAL_IF_MISSING_CONDITION: i32 = 7;
const STRUCTURAL_IF_MISSING_POSITIVE: i32 = 8;
const STRUCTURAL_IF_MISSING_NEGATIVE: i32 = 9;

/// Squash type code for IF neurons (must match SquashType::If in squash.rs).
const IF_SQUASH: u8 = 34;
/// Synapse type codes (must match SynapseType enum in synapse_type.rs).
const SYN_STANDARD: u8 = 0;
const SYN_CONDITION: u8 = 1;
const SYN_NEGATIVE: u8 = 2;
const SYN_POSITIVE: u8 = 3;

/// Issue #1961 — Validate structural integrity of a typed topology.
///
/// Checks:
/// - No synapse targets an input neuron
/// - Constant neurons have no inward connections
/// - Hidden neurons have at least 1 inward and 1 outward connection
/// - Non-input neuron biases are finite
/// - IF neurons have at least 3 inward connections with
///   condition, positive (or standard), and negative synapse types
///
/// # Arguments
/// * `from_indices` - Synapse source indices
/// * `to_indices` - Synapse destination indices
/// * `is_constant` - Per-neuron constant flag (1 = constant)
/// * `squash_types` - Per-neuron squash type code
/// * `biases` - Per-neuron bias values (f64)
/// * `num_inputs` - Number of input neurons
/// * `num_outputs` - Number of output neurons
/// * `synapse_types` - Per-synapse type code (condition/positive/negative/standard)
///
/// # Returns
/// Int32Array of length 2: `[error_code, neuron_or_synapse_index]`
#[wasm_bindgen]
pub fn validate_structural_integrity(
    from_indices: &[u32],
    to_indices: &[u32],
    is_constant: &[u8],
    squash_types: &[u8],
    biases: &[f64],
    num_inputs: u32,
    num_outputs: u32,
    synapse_types: &[u8],
) -> Vec<i32> {
    let num_neurons = biases.len();
    let num_synapses = from_indices.len();
    let input_count = num_inputs as usize;
    let output_count = num_outputs as usize;

    // Check no synapse targets an input neuron
    for i in 0..num_synapses {
        if (to_indices[i] as usize) < input_count {
            return vec![STRUCTURAL_SYNAPSE_TARGETS_INPUT, to_indices[i] as i32];
        }
    }

    // Count inward and outward connections per neuron
    let mut inward_count = vec![0u32; num_neurons];
    let mut outward_count = vec![0u32; num_neurons];

    for i in 0..num_synapses {
        let from = from_indices[i] as usize;
        let to = to_indices[i] as usize;
        if from < num_neurons {
            outward_count[from] += 1;
        }
        if to < num_neurons {
            inward_count[to] += 1;
        }
    }

    // Validate each non-input neuron
    let output_start = num_neurons - output_count;

    for i in input_count..num_neurons {
        let is_output = i >= output_start;
        let is_const = i < is_constant.len() && is_constant[i] != 0;

        // Check bias is finite for non-constant, non-input neurons
        if !is_const {
            let bias = biases[i];
            if bias.is_nan() || bias.is_infinite() {
                return vec![STRUCTURAL_BIAS_NOT_FINITE, i as i32];
            }
        }

        // Constant neuron checks
        if is_const {
            if inward_count[i] > 0 {
                return vec![STRUCTURAL_CONSTANT_HAS_INWARD, i as i32];
            }
            continue;
        }

        // Hidden neuron checks (not output, not constant)
        if !is_output {
            if inward_count[i] == 0 {
                return vec![STRUCTURAL_HIDDEN_NO_INWARD, i as i32];
            }
            if outward_count[i] == 0 {
                return vec![STRUCTURAL_HIDDEN_NO_OUTWARD, i as i32];
            }
        }

        // IF neuron validation
        if i < squash_types.len() && squash_types[i] == IF_SQUASH {
            if inward_count[i] < 3 {
                return vec![STRUCTURAL_IF_TOO_FEW_INWARD, i as i32];
            }

            // Check for required synapse types
            let mut has_condition = false;
            let mut has_positive = false;
            let mut has_negative = false;

            for s in 0..num_synapses {
                if to_indices[s] as usize != i {
                    continue;
                }
                if s < synapse_types.len() {
                    let st = synapse_types[s];
                    if st == SYN_CONDITION {
                        has_condition = true;
                    }
                    if st == SYN_POSITIVE || st == SYN_STANDARD {
                        has_positive = true;
                    }
                    if st == SYN_NEGATIVE {
                        has_negative = true;
                    }
                }
            }

            if !has_condition {
                return vec![STRUCTURAL_IF_MISSING_CONDITION, i as i32];
            }
            if !has_positive {
                return vec![STRUCTURAL_IF_MISSING_POSITIVE, i as i32];
            }
            if !has_negative {
                return vec![STRUCTURAL_IF_MISSING_NEGATIVE, i as i32];
            }
        }
    }

    vec![STRUCTURAL_VALID, 0]
}

/// Issue #1961 — Detect whether the topology contains cycles among non-input neurons.
///
/// Uses Kahn's algorithm: if after processing all zero-in-degree neurons
/// some non-input neurons remain unprocessed, a cycle exists.
///
/// Self-loops are explicitly detected as cycles.
///
/// # Arguments
/// * `from_indices` - Synapse source indices
/// * `to_indices` - Synapse destination indices
/// * `num_neurons` - Total number of neurons
/// * `num_inputs` - Number of input neurons
///
/// # Returns
/// 0 if acyclic, 1 if cycles detected
#[wasm_bindgen]
pub fn detect_cycles(
    from_indices: &[u32],
    to_indices: &[u32],
    num_neurons: u32,
    num_inputs: u32,
) -> u32 {
    let n = num_neurons as usize;
    let input_count = num_inputs as usize;

    // Check for self-loops first
    for i in 0..from_indices.len() {
        if from_indices[i] == to_indices[i] && (from_indices[i] as usize) >= input_count {
            return 1;
        }
    }

    // Build in-degree counts for non-input neurons.
    // Only count edges from other non-input neurons — edges from inputs
    // cannot participate in cycles, so they are excluded.
    let mut in_degree = vec![0i32; n];

    for i in 0..from_indices.len() {
        let from = from_indices[i] as usize;
        let to = to_indices[i] as usize;
        if from == to {
            continue;
        }
        if from >= input_count && to >= input_count && to < n {
            in_degree[to] += 1;
        }
    }

    // Start with non-input neurons that have zero in-degree from non-input sources
    let mut queue: Vec<usize> = Vec::new();
    for i in input_count..n {
        if in_degree[i] == 0 {
            queue.push(i);
        }
    }

    let mut processed = 0usize;
    let mut head = 0;

    while head < queue.len() {
        let idx = queue[head];
        head += 1;
        processed += 1;

        // Decrement in-degree for outgoing edges to non-input neurons
        for s in 0..from_indices.len() {
            if from_indices[s] as usize != idx {
                continue;
            }
            let to = to_indices[s] as usize;
            if to == idx || to < input_count || to >= n {
                continue;
            }
            in_degree[to] -= 1;
            if in_degree[to] == 0 {
                queue.push(to);
            }
        }
    }

    let non_input_count = n - input_count;
    if processed < non_input_count { 1 } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_valid_topology() {
        let from = [0, 1, 2];
        let to = [2, 2, 3];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], VALID);
    }

    #[test]
    fn test_validate_self_connection() {
        let from = [0, 2, 2];
        let to = [2, 2, 3];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], SELF_CONNECTION);
        assert_eq!(result[1], 1);
    }

    #[test]
    fn test_validate_backward_connection() {
        let from = [0, 3];
        let to = [2, 1];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], BACKWARD_CONNECTION);
        assert_eq!(result[1], 1);
    }

    #[test]
    fn test_validate_sort_error_from() {
        let from = [0, 2, 1];
        let to = [2, 3, 3];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], SORT_ERROR_FROM);
        assert_eq!(result[1], 2);
    }

    #[test]
    fn test_validate_sort_error_to() {
        let from = [0, 0];
        let to = [3, 2];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], SORT_ERROR_TO);
        assert_eq!(result[1], 1);
    }

    #[test]
    fn test_validate_duplicate() {
        let from = [0, 0];
        let to = [2, 2];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], DUPLICATE_CONNECTION);
        assert_eq!(result[1], 1);
    }

    #[test]
    fn test_validate_empty() {
        let from: [u32; 0] = [];
        let to: [u32; 0] = [];
        let result = validate_topology(&from, &to);
        assert_eq!(result[0], VALID);
    }

    #[test]
    fn test_scan_available_simple() {
        // 4 neurons: 2 inputs (0, 1), 1 hidden (2), 1 output (3)
        // Existing connections: 0->2, 1->2, 2->3
        let from = [0, 1, 2];
        let to = [2, 2, 3];
        let is_const = [0, 0, 0, 0];
        let result = scan_available_connections(&from, &to, &is_const, 4, 2);
        // Available forward-only slots: 0->3, 1->3
        // (0->2 exists, 1->2 exists, 2->3 exists)
        assert!(result.len() % 2 == 0);
        let pairs: Vec<(u32, u32)> = result.chunks(2).map(|c| (c[0], c[1])).collect();
        assert!(pairs.contains(&(0, 3)));
        assert!(pairs.contains(&(1, 3)));
    }

    #[test]
    fn test_scan_skips_constant() {
        // 3 neurons: 1 input (0), 1 constant (1), 1 output (2)
        let from = [1u32];
        let to = [2u32];
        let is_const = [0, 1, 0]; // neuron 1 is constant
        let result = scan_available_connections(&from, &to, &is_const, 3, 1);
        let pairs: Vec<(u32, u32)> = result.chunks(2).map(|c| (c[0], c[1])).collect();
        // Should not contain any pair targeting neuron 1 (constant)
        for (_, to_idx) in &pairs {
            assert_ne!(*to_idx, 1);
        }
    }

    #[test]
    fn test_reverse_topological_order_simple() {
        // 4 neurons: 2 inputs (0, 1), 1 hidden (2), 1 output (3)
        // Connections: 0->2, 1->2, 2->3
        let from = [0, 1, 2];
        let to = [2, 2, 3];
        let result = compute_reverse_topological_order(&from, &to, 4, 2);
        // Expected: output (3) first, then hidden (2)
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], 3); // Output first
        assert_eq!(result[1], 2); // Then hidden
    }

    #[test]
    fn test_reverse_topological_order_larger() {
        // 8 neurons: 3 inputs (0-2), 3 hidden (3-5), 2 outputs (6-7)
        // 0->3, 1->4, 2->5, 3->4, 3->6, 4->6, 5->7
        let from = [0, 1, 2, 3, 3, 4, 5];
        let to = [3, 4, 5, 4, 6, 6, 7];
        let result = compute_reverse_topological_order(&from, &to, 8, 3);
        assert_eq!(result.len(), 5); // 3 hidden + 2 output

        // Outputs should appear before their upstream hidden neurons
        let pos_of = |idx: u32| result.iter().position(|&x| x == idx).unwrap();
        assert!(pos_of(6) < pos_of(4)); // output-0 before h-1
        assert!(pos_of(6) < pos_of(3)); // output-0 before h-0
        assert!(pos_of(7) < pos_of(5)); // output-1 before h-2
    }

    #[test]
    fn test_validate_topology_batch_multiple_valid() {
        // Two valid topologies concatenated
        let all_from = [0, 1, 2, 0, 2]; // topo1: [0,1,2], topo2: [0,2]
        let all_to = [2, 2, 3, 2, 3]; // topo1: [2,2,3], topo2: [2,3]
        let lengths = [3, 2];

        let result = validate_topology_batch(&all_from, &all_to, &lengths);
        assert_eq!(result.len(), 4);
        assert_eq!(result[0], VALID); // topo1 error_code
        assert_eq!(result[2], VALID); // topo2 error_code
    }

    #[test]
    fn test_validate_topology_batch_mixed_valid_invalid() {
        // First valid, second has backward connection
        let all_from = [0, 1, 2, 3]; // topo1: [0,1,2], topo2: [3]
        let all_to = [2, 2, 3, 1]; // topo1: [2,2,3], topo2: [1] (backward!)
        let lengths = [3, 1];

        let result = validate_topology_batch(&all_from, &all_to, &lengths);
        assert_eq!(result.len(), 4);
        assert_eq!(result[0], VALID); // topo1 valid
        assert_eq!(result[2], BACKWARD_CONNECTION); // topo2 backward
    }

    #[test]
    fn test_validate_topology_batch_empty() {
        let all_from: [u32; 0] = [];
        let all_to: [u32; 0] = [];
        let lengths: [u32; 0] = [];

        let result = validate_topology_batch(&all_from, &all_to, &lengths);
        assert_eq!(result.len(), 0);
    }

    // -----------------------------------------------------------------------
    // Issue #1961 — Structural integrity tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_structural_valid() {
        // 2 inputs, 1 hidden, 1 output: 0->2, 1->2, 2->3
        let from = [0u32, 1, 2];
        let to = [2u32, 2, 3];
        let is_const = [0u8, 0, 0, 0];
        let squash = [0u8, 0, 1, 7]; // hidden=ReLU, output=TANH
        let biases = [0.0f64, 0.0, 0.5, -0.3];
        let syn_types = [0u8, 0, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_VALID);
    }

    #[test]
    fn test_structural_synapse_targets_input() {
        let from = [0u32, 2];
        let to = [1u32, 3]; // to=1 is input (numInputs=2)
        let is_const = [0u8, 0, 0, 0];
        let squash = [0u8, 0, 1, 7];
        let biases = [0.0f64, 0.0, 0.5, -0.3];
        let syn_types = [0u8, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_SYNAPSE_TARGETS_INPUT);
    }

    #[test]
    fn test_structural_constant_has_inward() {
        // input-0 -> constant (idx 2) is invalid
        let from = [0u32, 2];
        let to = [2u32, 3];
        let is_const = [0u8, 0, 1, 0]; // idx 2 is constant
        let squash = [0u8, 0, 0, 7];
        let biases = [0.0f64, 0.0, 1.0, -0.3];
        let syn_types = [0u8, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_CONSTANT_HAS_INWARD);
    }

    #[test]
    fn test_structural_hidden_no_inward() {
        // hidden (idx 2) has outward only
        let from = [2u32];
        let to = [3u32];
        let is_const = [0u8, 0, 0, 0];
        let squash = [0u8, 0, 1, 7];
        let biases = [0.0f64, 0.0, 0.5, -0.3];
        let syn_types = [0u8];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_HIDDEN_NO_INWARD);
    }

    #[test]
    fn test_structural_hidden_no_outward() {
        // hidden (idx 2) has inward only, input-1 -> output directly
        let from = [0u32, 1];
        let to = [2u32, 3];
        let is_const = [0u8, 0, 0, 0];
        let squash = [0u8, 0, 1, 7];
        let biases = [0.0f64, 0.0, 0.5, -0.3];
        let syn_types = [0u8, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_HIDDEN_NO_OUTWARD);
    }

    #[test]
    fn test_structural_bias_not_finite() {
        let from = [0u32, 2];
        let to = [2u32, 3];
        let is_const = [0u8, 0, 0, 0];
        let squash = [0u8, 0, 1, 7];
        let biases = [0.0f64, 0.0, f64::INFINITY, -0.3];
        let syn_types = [0u8, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_BIAS_NOT_FINITE);
    }

    #[test]
    fn test_structural_bias_nan() {
        let from = [0u32, 2];
        let to = [2u32, 3];
        let is_const = [0u8, 0, 0, 0];
        let squash = [0u8, 0, 1, 7];
        let biases = [0.0f64, 0.0, f64::NAN, -0.3];
        let syn_types = [0u8, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 2, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_BIAS_NOT_FINITE);
    }

    #[test]
    fn test_structural_if_too_few_inward() {
        // IF neuron (idx 3) with only 2 inward connections
        let from = [0u32, 1, 3];
        let to = [3u32, 3, 4];
        let is_const = [0u8, 0, 0, 0, 0];
        let squash = [0u8, 0, 0, IF_SQUASH, 0]; // idx 3 = IF
        let biases = [0.0f64, 0.0, 0.0, 0.0, 0.0];
        let syn_types = [SYN_CONDITION, SYN_POSITIVE, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 3, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_IF_TOO_FEW_INWARD);
    }

    #[test]
    fn test_structural_if_missing_negative() {
        // IF neuron (idx 3) with 3 inward but no negative
        let from = [0u32, 1, 2, 3];
        let to = [3u32, 3, 3, 4];
        let is_const = [0u8, 0, 0, 0, 0];
        let squash = [0u8, 0, 0, IF_SQUASH, 0];
        let biases = [0.0f64, 0.0, 0.0, 0.0, 0.0];
        let syn_types = [SYN_CONDITION, SYN_POSITIVE, SYN_POSITIVE, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 3, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_IF_MISSING_NEGATIVE);
    }

    #[test]
    fn test_structural_if_valid() {
        // IF neuron (idx 3) with proper condition/positive/negative
        let from = [0u32, 1, 2, 3];
        let to = [3u32, 3, 3, 4];
        let is_const = [0u8, 0, 0, 0, 0];
        let squash = [0u8, 0, 0, IF_SQUASH, 0];
        let biases = [0.0f64, 0.0, 0.0, 0.0, 0.0];
        let syn_types = [SYN_CONDITION, SYN_POSITIVE, SYN_NEGATIVE, 0];

        let result = validate_structural_integrity(
            &from, &to, &is_const, &squash, &biases, 3, 1, &syn_types,
        );
        assert_eq!(result[0], STRUCTURAL_VALID);
    }

    // -----------------------------------------------------------------------
    // Issue #1961 — Cycle detection tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_cycles_acyclic() {
        let from = [0u32, 1, 2];
        let to = [2u32, 2, 3];
        assert_eq!(detect_cycles(&from, &to, 4, 2), 0);
    }

    #[test]
    fn test_detect_cycles_with_cycle() {
        // 2->3 and 3->2 form a cycle
        let from = [0u32, 1, 2, 3];
        let to = [2u32, 3, 3, 2];
        assert_eq!(detect_cycles(&from, &to, 4, 2), 1);
    }

    #[test]
    fn test_detect_cycles_self_loop() {
        let from = [0u32, 2];
        let to = [2u32, 2]; // self-loop
        assert_eq!(detect_cycles(&from, &to, 3, 1), 1);
    }

    #[test]
    fn test_detect_cycles_longer_cycle() {
        // 3->4, 4->5, 5->3 form a 3-node cycle
        let from = [0u32, 1, 2, 3, 4, 5];
        let to = [3u32, 4, 5, 4, 5, 3];
        assert_eq!(detect_cycles(&from, &to, 7, 3), 1);
    }

    #[test]
    fn test_detect_cycles_empty() {
        let from: [u32; 0] = [];
        let to: [u32; 0] = [];
        assert_eq!(detect_cycles(&from, &to, 3, 2), 0);
    }
}
