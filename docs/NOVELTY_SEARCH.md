# 🧭 Novelty (Behavioural-Diversity) Selection

> **Novelty search** ([glossary](GLOSSARY.md#-themed--house-terms)) is optional
> selection that rewards what a [Creature](GLOSSARY.md#-themed--house-terms)
> _does_ — its behaviour on a probe set — rather than its raw fitness, to escape
> deceptive landscapes. The mechanism is **OFF by default** (Issue #2932); when
> disabled, ranking and selection are exactly as before. Implementation:
> [`src/config/NoveltyConfig.ts`](../src/config/NoveltyConfig.ts).
>
> Acronyms used here: **kNN** (k-Nearest Neighbours), **FIFO**
> (First-In-First-Out), **i.i.d.** (independent and identically distributed).

## 🔗 Foundation docs

- [GLOSSARY.md](GLOSSARY.md) — canonical terms (Creature, novelty search,
  Islands).
- [DOC_STYLE.md](DOC_STYLE.md) — the house style this guide follows.
- [docs/README.md](README.md) — full topic index.

## 🌍 The problem: deceptive landscapes

On **deceptive** problems, pure-fitness selection drives the population into a
local optimum where fitness stops improving and the effective pace of evolution
collapses. **Novelty search**
([Lehman & Stanley, 2011](https://doi.org/10.1162/EVCO_a_00025)) rewards
behavioural diversity rather than — or blended with — raw fitness, and is a
well-established accelerant for escaping deception.

## 🆚 NEAT-AI vs the textbook

Novelty search is a **standard** evolutionary-computation technique, not a
NEAT-AI invention — the algorithm below is the
[Lehman & Stanley](https://doi.org/10.1162/EVCO_a_00025) formulation (behaviour
descriptor → kNN distance to population + archive → blend with fitness). What is
**NEAT-AI-specific** is how it slots into the existing machinery:

- NEAT-AI's prior diversity mechanisms
  ([Islands](GLOSSARY.md#-themed--house-terms), speciation, fitness sharing,
  compatibility gating) maintain **structural** diversity only — they compare
  how Creatures are _wired_. Novelty selection adds **behavioural** diversity:
  it compares what Creatures _do_.
- It is **OFF by default**, layered on the standard NEAT-AI fitness ranking as
  an opt-in blend rather than replacing it. For the project-wide convention on
  when a behaviour is "NEAT-AI" versus "standard NEAT", see the
  [NEAT-vs-NEAT-AI rule](../AGENTS.md#-neat-vs-neat-ai--which-term-to-use).

## How it works

1. **Behaviour descriptor** — a numeric vector describing a creature's
   behaviour, supplied by the problem's fitness function as a comma-separated
   `behaviour` tag (for example, the creature's output vector on a fixed probe
   set). Creatures without a parseable descriptor contribute no novelty.
2. **Novelty score** — the mean Euclidean distance from a creature's descriptor
   to its `k` nearest neighbours, drawn from both the current population and a
   bounded **archive** of past behaviours. A creature that behaves unlike
   everything seen so far scores high.
3. **Bounded archive** — novel behaviours are retained (first-in, first-out once
   `archiveLimit` is reached) so the population is pushed away from regions
   already explored, not just away from the current generation.
4. **Blend** — ranking uses `score' = (1 - weight)·fitness + weight·novelty`,
   with fitness and novelty min-max normalised first so their scales do not
   dominate each other.

```mermaid
flowchart LR
    A[Population] --> B[Behaviour descriptor<br/>behaviour tag]
    B --> C[kNN novelty score<br/>population + archive]
    D[(Novelty archive<br/>bounded FIFO)] --> C
    C --> E["Blend<br/>(1-w)·fitness + w·novelty"]
    F[Raw fitness] --> E
    E --> G[FitnessRanking<br/>parent selection]
    C --> D
```

## Configuration

```ts
const neat = new Neat(input, output, fitness, {
  novelty: {
    enabled: true, // OFF by default
    weight: 0.5, // blend weight w in [0,1] (0 = pure fitness)
    neighbours: 15, // k nearest neighbours for the novelty score
    archiveLimit: 500, // maximum behaviours retained in the archive
    addThreshold: 0, // minimum novelty to admit a behaviour to the archive
    behaviourTag: "behaviour", // tag holding the descriptor
  },
});
```

| Option         | Default       | Meaning                                                     |
| -------------- | ------------- | ----------------------------------------------------------- |
| `enabled`      | `false`       | Master switch. OFF leaves ranking unchanged.                |
| `weight`       | `0.5`         | Blend weight `w`; `0` is pure fitness, `1` is pure novelty. |
| `neighbours`   | `15`          | `k` for the k-nearest-neighbour novelty score.              |
| `archiveLimit` | `500`         | Archive cap; oldest behaviours are evicted first.           |
| `addThreshold` | `0`           | Minimum novelty before a behaviour is archived.             |
| `behaviourTag` | `"behaviour"` | Creature tag holding the descriptor.                        |

## Supplying behaviour descriptors

The fitness function tags each creature with its behaviour descriptor — a
comma-separated list of finite numbers:

```ts
import { addTag } from "@stsoftware/tags/mod";

// e.g. the creature's outputs on a fixed probe set
addTag(creature, "behaviour", probeOutputs.join(","));
```

When fewer than two creatures expose a parseable descriptor there is nothing
meaningful to compare, so ranking is left untouched — novelty is safe to enable
even before descriptors are wired up.

## Evidence

A deterministic deceptive-landscape benchmark
([`bench/NoveltyDeceptiveEscape.ts`](../bench/NoveltyDeceptiveEscape.ts)) starts
the population inside a deceptive basin (fitness cap `0.8`) with the global
optimum (`1.0`) on the far side of a fitness valley. Pure-fitness selection is
trapped; novelty selection escapes in a handful of generations:

| seed  | fitness-only         | with novelty    |
| ----- | -------------------- | --------------- |
| 12345 | trapped (best 0.800) | solved @ gen 8  |
| 222   | trapped (best 0.800) | solved @ gen 9  |
| 9001  | trapped (best 0.800) | solved @ gen 8  |
| 4242  | trapped (best 0.800) | solved @ gen 11 |
| 77777 | trapped (best 0.800) | solved @ gen 5  |

The acceptance test
[`test/NEAT/NoveltySearchDeceptive.ts`](../test/NEAT/NoveltySearchDeceptive.ts)
asserts novelty escapes the trap in strictly fewer generations than
fitness-only.

## 🔗 Related

- [`src/config/NoveltyConfig.ts`](../src/config/NoveltyConfig.ts) —
  configuration shape and defaults (matched by the table above).
- [GLOSSARY.md](GLOSSARY.md#-themed--house-terms) — the canonical novelty-search
  and Islands definitions.
- [Lehman & Stanley, 2011](https://doi.org/10.1162/EVCO_a_00025) — the original
  novelty-search paper.
- [`README.md`](../README.md) and [`docs/README.md`](README.md) — entry point
  and topic index.
