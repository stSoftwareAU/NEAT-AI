## Summary

Convert all ASCII art diagrams to mermaid diagrams in TROUBLESHOOTING.md,
DISCOVERY_GUIDE.md, and PREDICTIVE_CODING.md. Closes #1836.

### Changes

- **TROUBLESHOOTING.md**: Converted 5 diagnostic decision trees (Fitness
  Plateau, Training Is Slow, Memory Issues, Discovery Not Finding Improvements,
  Creatures Producing NaN) from ASCII tree characters to mermaid flowcharts with
  colour-coded node classes and emoji icons
- **DISCOVERY_GUIDE.md**: Converted the Distributed Discovery Swarm
  multi-machine architecture diagram from box-drawing characters to a mermaid
  flowchart with subgraphs and styled nodes. Converted the Real-World Results
  ASCII table to a proper markdown table
- **PREDICTIVE_CODING.md**: Converted the Dependency Graph (Phase 1-5), the
  Integration Pipeline diagram, the PC Inference (Settling) algorithm, and the
  PC Weight Update algorithm to mermaid flowcharts with colour-coded nodes

All mermaid diagrams use colours and styling, Australian English spelling, and
render correctly on GitHub. No box-drawing characters remain in diagram
contexts.

## Evidence

- All diagrams converted use `classDef` colour styling consistent with existing
  mermaid diagrams in `DISCOVERY_ARCHITECTURE.md` and `COMPARISON.md`
- `./quality.sh --lint-only` passes cleanly

## Test Plan

- Visual verification that mermaid diagrams render correctly on GitHub
- Confirmed no box-drawing characters remain in diagram contexts via grep
- `./quality.sh --lint-only` passes
