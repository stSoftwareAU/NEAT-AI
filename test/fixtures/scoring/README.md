# ⚖️ Magnitude penalty corpus — the cross-engine scoring contract

> [!CAUTION]
> **Changing `magnitude-penalty-corpus.json` changes every score in the fleet.**
> The TypeScript engine (`src/architecture/Score.ts`) and the Rust engine
> (`rust_scorer/src/scoring.rs` in
> [NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer)) must return
> the same number for every case here, or `NEAT_AI_RUST_SCORER_STRICT` fires on
> a creature that scored differently depending on which engine ran it.

## 📌 What this is

Issue #3881: the old `1 / (1 + 1 / value)` curve was 0.990 at `|w| = 100` and
0.9999 at `|w| = 1000`, so past about two decades it could no longer tell a
sensible weight from an absurd one. Nothing in the score objected to drift, and
production weights reached `1.156e+195`.

The replacement charges a **constant amount per decade**. This corpus is the
language-neutral statement of that curve across magnitudes `1 → 1e20`, so a port
can be checked without reading either implementation.

| Field               | Meaning                                                    |
| ------------------- | ---------------------------------------------------------- |
| `cases[].magnitude` | the absolute value of a single weight or bias              |
| `cases[].penalty`   | what every engine must return for that magnitude           |
| `decadeCap`         | decades above 1.0 that span the useful range (12)          |
| `maxSafeMagnitude`  | magnitudes are clamped to this before the curve is applied |
| `tolerance`         | absolute agreement required between engines (1e-12)        |

The last four cases (`9007199254740991`, `1e16`, `1e18`, `1e20`) deliberately
share one penalty: a magnitude beyond `maxSafeMagnitude` is clamped to it, which
is what stops a `1e+195` weight throwing instead of being charged for.

## ✅ The gates

| Engine     | Gate                                                            |
| ---------- | --------------------------------------------------------------- |
| TypeScript | `test/score/MagnitudeSelectionPressure.ts`                      |
| Rust       | `rust_scorer/tests/magnitude_penalty_corpus.rs` (vendored copy) |

Both read the same bytes. Vendor a copy into a downstream repo rather than
hand-rolling a near-copy — a near-copy diverges the moment a case is added.

```mermaid
flowchart LR
    C[("magnitude-penalty-corpus.json")] --> TS["TypeScript<br/>magnitudePenalty()"]
    C --> RS["Rust<br/>magnitude_penalty()"]
    TS -->|identical to 1e-12| RS
```
