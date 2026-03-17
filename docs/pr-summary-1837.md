## Summary

Unify documentation and make README.md the single source of truth for all
documentation. Closes #1837.

### Changes

1. **Reorganised README.md documentation section** into logical categories:
   Getting Started, Core Concepts, API & Reference, Advanced Topics, Operations,
   and For Contributors.

2. **Added all orphaned documents** to README.md:
   - `docs/API_REFERENCE.md`
   - `docs/CONFIGURATION_GUIDE.md`
   - `docs/DISCOVERY_ARCHITECTURE.md`
   - `docs/PERFORMANCE_RESEARCH.md` (renamed from `performance-guide.md`)
   - `docs/PREDICTIVE_CODING.md`
   - `docs/PREDICTIVE_CODING_BENCHMARKS.md`
   - `docs/WASM_RESIDENT_TOPOLOGY.md`

3. **Added cross-references** between related docs:
   - `PERFORMANCE_TUNING.md` ↔ `PERFORMANCE_RESEARCH.md`
   - `DISCOVERY_GUIDE.md` ↔ `DISCOVERY_ARCHITECTURE.md`
   - `CONFIGURATION_GUIDE.md` ↔ `PERFORMANCE_TUNING.md` / `PERFORMANCE_RESEARCH.md`

4. **Renamed files** for naming consistency:
   - `performance-guide.md` → `PERFORMANCE_RESEARCH.md`
   - `DiscoveryDir.md` → `DISCOVERY_DIR.md`

5. **Updated all internal references** to renamed files across AGENTS.md,
   PERFORMANCE_TUNING.md, DISCOVERY_ARCHITECTURE.md, DISCOVERY_GUIDE.md,
   WASM_RESIDENT_TOPOLOGY.md, and test files.

## Evidence

All documentation files in `docs/` are now reachable from README.md. No orphaned
documentation remains. `./quality.sh --skip-tests --skip-discovery --skip-wasm`
passes cleanly.

## Test Plan

- Verified all documentation links in README.md point to existing files
- Verified cross-references between related docs are bidirectional
- Verified `./quality.sh` passes (lint, format, type-check)
