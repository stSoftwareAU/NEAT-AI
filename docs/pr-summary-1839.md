## Summary

Comprehensive Australian English audit across all documentation files. Converted
remaining American English spellings to Australian English while preserving code
identifiers, external references, and mermaid diagram syntax. Closes #1839.

## Changes Made

### `src/methods/activations/README.md` (7 changes)

| Line | American English | Australian English |
| ---- | ---------------- | ------------------ |
| 64   | center           | centre             |
| 65   | stabilize        | stabilise          |
| 69   | center           | centre             |
| 80   | center           | centre             |
| 86   | stabilize        | stabilise          |
| 96   | center           | centre             |
| 107  | optimize         | optimise           |

### `COMPARISON.md` (1 change)

| Line | American English | Australian English |
| ---- | ---------------- | ------------------ |
| 470  | Optimizers       | Optimisers         |

### Items Preserved (Not Changed)

- **Code identifiers**: `optimize/` directory name, `analyzeParallel()`,
  `analyzeSynapses()`, `lazyInitialization`, mermaid `color` properties
- **External references**: Paper titles, Wikipedia article names, blog post
  titles
- **CONTRIBUTING.md spelling table**: Intentionally contains American spellings
  as "do not use" examples
- **Archived PR summaries**: Excluded per issue requirements

## Evidence

All documentation files (excluding archived PR summaries) were audited for the
full list of American-to-Australian English substitutions specified in the
issue. The 8 instances found above were the only remaining American English
spellings in non-code-identifier, non-external-reference contexts.

## Test Plan

- Verified `./quality.sh --skip-tests --skip-discovery --skip-wasm` passes
- Manual review confirmed no code identifiers or external references were
  modified
