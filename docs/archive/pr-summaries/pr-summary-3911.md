# Rebuild REFERENCES.md around primary sources; correct the MCMC optimal-scaling gloss

## Summary

`docs/comparison/REFERENCES.md` was Wikipedia-led and organised around the house
vocabulary, so the other comparison docs had nothing precise to cite. This
rebuilds it around the literature and fixes one factual error. Closes #3911.

- **Every literature section now leads with a primary source.** Wikipedia and
  tutorial links are retained — they are good orientation for the stated
  no-prior-expertise audience — but moved out of the lead position and labelled
  as orientation.
- **Corrected the Roberts, Gelman & Gilks (1997) gloss.** It previously read
  "optimal acceptance-rate theory (~23.4%)", which implies the result covers
  evolutionary-algorithm acceptance rates. It does not: it is an optimal-scaling
  result for random-walk Metropolis on smooth high-dimensional targets. The
  entry now says so and states plainly that NEAT-AI's ~23.4% target is a
  heuristic borrowed from it, not a consequence of it. Metropolis et al. (1953)
  and Kirkpatrick, Gelatt & Vecchi (1983) are cited alongside it — the latter
  being the actual ancestor of temperature-scaled acceptance in a search
  algorithm.
- **New sections:** ✂️ Pruning and sparsity, 🌱 Structural growth, 🎯
  Surrogate-assisted search and racing, 🔍 Attribution and saliency, 📏
  Evaluation validity, 🔗 Linkage and epistasis, and 🧬 Lamarckian and
  Baldwinian evolution (split out of the memetic section).
- **Extended sections:** 🔬 Neuroevolution (ES, deep neuroevolution, novelty
  search, MAP-Elites, CMA-ES), 🧬 Horizontal gene transfer and breeding (Barr et
  al. 2015 software transplantation; Cohoon et al. 1987 and Tanese 1989 as the
  island model's primary sources, previously cited only via Wikipedia), and 🧠
  Traditional neural networks (Rumelhart, Hinton & Williams 1986).
- Fahlman & Lebiere (1990) Cascade-Correlation is labelled as Discovery's direct
  ancestor, as the issue asked.
- Added a Mermaid map from NEAT-AI subsystem to the bibliography section that
  covers it, and added the new author surnames to `docs/cspell.json` so the
  spelling gate stays green.

Every external URL added was fetched and checked; publisher `403`s (ACM, AIP,
Science, MIT Press) are bot-blocking on a resolving DOI. Moscato (1989) has no
stable public copy and is cited by its Caltech report number instead of a dead
link.

## Evidence

Documentation-only change — no web interface to screenshot. The evidence is the
new test file, which fails against the old bibliography and passes against the
new one.

Before the change
(`deno test --allow-read test/docs/ComparisonReferencesPrimarySources.ts`):

```text
REFERENCES.md is missing required sections:
🧬 Lamarckian and Baldwinian evolution
🎲 Markov Chain Monte Carlo (MCMC)
✂️ Pruning and sparsity
🌱 Structural growth
🎯 Surrogate-assisted search and racing
🔍 Attribution and saliency
📏 Evaluation validity
🔗 Linkage and epistasis

Sections not led by a primary source:
🧬 Memetic algorithms: leads with a Wikipedia overview
🎲 Markov Chain Monte Carlo: leads with a Wikipedia overview
🧬 Horizontal gene transfer and breeding: leads with a Wikipedia overview

The optimal-scaling gloss must say the result is about random-walk Metropolis
— got: "… Roberts, Gelman & Gilks (1997) — optimal acceptance-rate theory (~23.4%)."

FAILED | 1 passed | 3 failed
```

After:

```text
REFERENCES.md carries a section for every cited literature area ... ok
REFERENCES.md leads every literature section with a primary source ... ok
REFERENCES.md retains its Wikipedia orientation links ... ok
REFERENCES.md scopes the ~23.4% optimal-scaling result to random-walk Metropolis ... ok

ok | 4 passed | 0 failed
```

`markdownlint-cli2` reports 0 errors across all 421 Markdown files, and `cspell`
with `docs/cspell.json` reports 0 issues on the changed files.

### Quality gate

`./quality.sh` was run twice in the foreground. Both runs reported **8916
passed, 1 failed**, but the failure was a _different_ pre-existing environment
flake each time, and neither touches anything this change alters (Markdown, a
cspell word list, and one read-only docs test):

| Run | Flaky failure                                                                                                                          | Isolated re-run |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | `test/scripts/InFlightTestLog.ts` — "expected one in-flight name file", saw 2 (shared in-flight directory race under parallel workers) | passes          |
| 2   | `test/score/RustScorerDatasetParity.ts` — `rust_scorer` could not read its own temp creature file (`/tmp` race)                        | passes          |

## Test Plan

- Added `test/docs/ComparisonReferencesPrimarySources.ts` with four structural
  tests, in the spirit of `ComparisonSplit.ts` (assert on structure, not prose
  or length):
  - `REFERENCES.md carries a section for every cited literature area` — every
    required `##` heading exists.
  - `REFERENCES.md leads every literature section with a primary source` — the
    first entry of each literature section is not a Wikipedia link. Orientation
    sections (GPU vendor docs, beginner courses, internal cross-links) are
    exempt, since they have no primary literature to lead with.
  - `REFERENCES.md retains its Wikipedia orientation links` — all eight
    Wikipedia URLs that existed before the rebuild are still present.
  - `REFERENCES.md scopes the ~23.4% optimal-scaling result to random-walk
    Metropolis`
    — the Roberts/Gelman/Gilks entry is located by its stable URL fragment and
    must qualify the result and call the ~23.4% target a heuristic; the old
    "optimal acceptance-rate theory" wording must be gone. This is the one
    wording-sensitive assertion and it is deliberate: it guards the factual
    correction the issue asked for.
- Existing `test/docs/ComparisonSplit.ts` and
  `test/docs/NeatTerminologyDefersToCanonical.ts` still pass, confirming the
  rewritten doc's relative links resolve and its NEAT-vs-NEAT-AI callout still
  defers to the canonical rule.
