## Summary

Add `docs/DISCOVERY_ARCHITECTURE.md` — an internal technical architecture guide
for the discovery pipeline spanning `src/discovery/` (37 files) and
`src/architecture/ErrorGuidedStructuralEvolution/` (38 files). Closes #1750.

The document covers:
- **Two-phase pipeline architecture** — Phase 1 (single candidate evaluation)
  and Phase 2 (combined candidate evaluation from Phase 1 successes), including
  the threshold change from 2→1 successful singles (#1734)
- **Module dependency map** — File-level dependency trees for both directories
  with cross-directory data flow
- **Cache architecture** — Success cache (storage, metadata, de-duplication,
  query methods), failure cache (caching rules, key generation, weight exponent
  bucketing), and cache-informed candidate building (#1731)
- **Candidate lifecycle** — Creation → application → filtering → evaluation →
  caching → combination/selection
- **Candidate filtering detail** — Four-stage slot allocation strategy
- **Discovery diagnostics** (#1735)
- **Rust FFI bridge** — Operations, data conversion, library management, focus
  neuron selection
- **References** to enhancement issues #1731, #1733, #1734, #1735

Also updates `AGENTS.md` Documentation Layout section to list the new guide.

## Evidence

Documentation-only change. No code modified.

## Test Plan

- Verified `./quality.sh --skip-tests --skip-discovery --skip-wasm` passes
  (formatting, linting, type-checking)
- No code changes, so no new tests required
