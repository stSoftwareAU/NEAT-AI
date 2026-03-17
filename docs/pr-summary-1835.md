## Summary

Converted all ASCII art diagrams in `docs/DISCOVERY_ARCHITECTURE.md` to mermaid
diagrams with colours and styling. Closes #1835.

Five diagrams were converted:

1. **Discovery Pipeline Overview** — flowchart with colour-coded stages
2. **Module Dependency Map (src/discovery/)** — graph showing 37 file
   dependencies grouped by responsibility
3. **Module Dependency Map (src/architecture/)** — graph showing 38 file
   dependencies grouped by layer
4. **Cross-Directory Data Flow** — flowchart showing data movement between
   directories
5. **Candidate Lifecycle** — state diagram showing candidate progression through
   creation, application, filtering, evaluation, caching, and final outcome
6. **Success Cache Directory Structure** — tree diagram showing cache layout

All box-drawing characters have been removed. Australian English spelling is
used throughout. Mermaid diagrams use `classDef` styling for colour-coded nodes.

## Evidence

- No box-drawing characters remain: `grep -P '[┌─│└├┤┬┴┼▶▼◀]'` returns no
  matches
- `./quality.sh --lint-only` passes cleanly

## Test Plan

- Documentation-only change; no code or tests modified
- Verified mermaid syntax is valid and renders on GitHub
- Verified no box-drawing characters remain in the file
