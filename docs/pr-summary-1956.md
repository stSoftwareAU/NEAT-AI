## Summary

Created the `ts-rust-migration` GitHub milestone (#6) with a structured roadmap
for incrementally migrating TypeScript components to Rust/WASM. Closes #1956.

The milestone is informed by the extensive WASM performance research series
(#1630–#1633, #1639, #1642) and includes 5 sub-issues organised into two phases:

**Phase 1 — Foundation:**

- #1957: Typed array topology (replace JS objects with typed arrays)
- #1958: Integer neuron IDs (replace UUID strings with integers)

**Phase 2 — Selective Migration:**

- #1959: Selective WASM residency for read-heavy operations
- #1960: Batch API design for amortising WASM boundary crossing
- #1961: Migrate topology validation to Rust/WASM

Added `docs/TS_RUST_MIGRATION.md` as a living roadmap document covering current
WASM coverage, the migration plan, and what should not be migrated.

## Evidence

- GitHub milestone created: https://github.com/stSoftwareAU/NEAT-AI/milestone/6
- 5 sub-issues created and assigned to the milestone
- Migration roadmap based on empirical performance research documented in
  `docs/PERFORMANCE_RESEARCH.md` and `docs/WASM_RESIDENT_TOPOLOGY.md`

## Test Plan

- No code changes requiring tests — this is a documentation and project
  management milestone
- Verified milestone and all sub-issues are visible on GitHub
