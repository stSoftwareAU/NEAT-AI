## Summary

Created a comprehensive `CONTRIBUTING.md` guide for first-time contributors
covering development setup, workflow, testing, configuration patterns, activation
functions, and code style. Updated `README.md` and `AGENTS.md` to reference the
new guide. Closes #1406.

## Evidence

This is a documentation-only change with no UI or performance impact. All 2906
existing tests continue to pass. The quality gate (`./quality.sh`) passes
cleanly.

## Changes

- **`CONTRIBUTING.md`** (new) — Complete contributor guide with:
  - Quick start (Deno 2.x install, clone, quality gate verification)
  - WASM activation module setup and optional rebuild instructions
  - Rust Discovery library setup (optional)
  - Development workflow (branching from `Develop`, TDD, quality gate, PR submission)
  - Testing conventions (unit tests vs benchmarks, "what" vs "how" tests)
  - Step-by-step guide for adding configuration options (the established pattern)
  - Step-by-step guide for adding activation functions
  - Code style reference (Australian English, key lint rules with examples)
  - Project structure overview
- **`README.md`** — Added CONTRIBUTING.md to documentation list and
  contributions section
- **`AGENTS.md`** — Added CONTRIBUTING.md to documentation layout section

## Test Plan

- No functional code changed; all 2906 existing tests pass
- Verified `./quality.sh` passes cleanly with the new documentation files
