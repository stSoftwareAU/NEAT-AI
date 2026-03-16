## Summary

Converted all 5 ASCII art diagrams in `COMPARISON.md` to colourful mermaid
diagrams that render natively on GitHub. Closes #1834.

The following architecture diagrams were converted:

1. **Traditional Feedforward Neural Network** — linear flow with styled nodes
2. **CNN (Convolutional Neural Network)** — pipeline from image to
   classification
3. **RNN (Recurrent Neural Network)** — time-unrolled with subgraphs per step
4. **Transformer/LLM** — encoder block with attention and FFN stages
5. **NEAT (Our Implementation)** — evolving topology with dynamic connections

Each diagram uses colour styling, emoji labels, and informative descriptions. No
`+---+` style box-drawing characters remain outside tables. Australian English
spelling is used throughout.

## Evidence

- No ASCII box-drawing patterns remain in COMPARISON.md (verified via grep)
- `./quality.sh` passes cleanly (4483 tests, 0 failures)
- Mermaid diagrams use GitHub-compatible syntax

## Test Plan

- Verified no `+---+` patterns remain in COMPARISON.md
- Ran full `./quality.sh` — all 4483 tests pass
- Diagrams use standard mermaid `graph` syntax supported by GitHub rendering
