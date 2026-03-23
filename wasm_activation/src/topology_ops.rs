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
}
