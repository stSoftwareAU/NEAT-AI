# 🗄️ Evaluation archive: keeping the exact scores (Issue #3929)

Every surrogate in
[Jin (2011)](comparison/REFERENCES.md#-surrogate-assisted-search-and-racing) —
polynomial, kriging,
[RBF (radial basis function)](https://en.wikipedia.org/wiki/Radial_basis_function_network),
[SVM (support vector machine)](https://en.wikipedia.org/wiki/Support_vector_machine),
neural net — is a supervised model, and every one of them needs the same thing
to exist first: an archive of `(design point, true fitness)` pairs. Jin treats
managing that data set as part of the method, not a detail.

NEAT-AI kept no such archive. `Fitness.calculate` computed a score, attached it
to the creature, and the pair evaporated when the creature was culled — tens of
thousands of exact evaluations of production-scale creatures, each the product
of minutes of compute against a multi-gigabyte corpus, discarded as they were
produced.

The evaluation archive keeps them. It is **off by default**: it is run
infrastructure, it writes to disk, and it never rides the creature export.

```typescript
await creature.evolveDir(dataSetDir, {
  iterations: 100,
  evaluationArchive: {
    enabled: true,
    directory: ".evaluation-archive", // default; one directory is one archive
    maxRecords: 100_000, // default retention bound
    runId: "grq-2026-08", // default: a fresh UUID per run
  },
});
```

Throughout, **UUID** is a [universally unique identifier](GLOSSARY.md), **JSON**
is [JavaScript Object Notation](https://www.json.org/) and **JSONL** is its
newline-delimited form.

## 🧭 What is written, and when

```mermaid
flowchart LR
  G[generation starts] --> B[beginGeneration:<br/>index + current fittest]
  B --> S[Fitness.calculate]
  S --> X{exact<br/>full-corpus<br/>score?}
  X -->|yes| R[record: descriptor + score +<br/>fidelity + provenance]
  X -->|racing-abandoned<br/>partial| N[not recorded]
  R --> M[in-memory buffer]
  M -->|end of calculate| F[flush: one append]
  F --> T{over the bound<br/>+ slack?}
  T -->|no| D[(evaluations.jsonl)]
  T -->|yes| C[compact: keep newest maxRecords] --> D
```

One record per **true** evaluation:

| Field               | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `descriptorVersion` | Layout version of `descriptor`. Readers refuse to mix these. |
| `runId`             | The run that produced the evaluation.                        |
| `generation`        | Generation index within that run.                            |
| `uuid`              | Content-hash UUID of the creature scored.                    |
| `parents`           | UUIDs of the parents it was bred from; empty if not bred.    |
| `operators`         | Mutation operators applied to it, when telemetry knew them.  |
| `approach`          | Pipeline stage that produced it (the `approach` tag).        |
| `score`             | The exact score.                                             |
| `error`             | The raw error the score came from.                           |
| `fidelity`          | Corpus fraction the score covers. `1` is ground truth.       |
| `referenceUuid`     | Creature the genetic-distance slot was measured against.     |
| `recordedAt`        | Wall-clock instant it was archived.                          |
| `descriptor`        | The fixed-length feature vector (below).                     |

The file is newline-delimited JSON (`evaluations.jsonl`), appended once per
generation. Runs sharing a directory append to the same archive — cross-run
history is the point, since a surrogate is fitted to what the lineage has
already learnt.

### Exact scores only

A partial score from [racing](RACING.md) (Issue #3928) or a sampled score (Issue
#3926) is **not** ground truth. `fidelity` is required on every record and the
exact-evaluation path passes `1`; anything outside `(0, 1]` is refused rather
than stored, and a racing-abandoned creature never reaches the archive at all. A
non-finite score (the `-Infinity` a WASM panic takes) is also skipped: it
describes the runtime, not the design point.

De-duplication holds too. `Fitness.calculate` scores one representative per UUID
and fans the score out to its duplicates (Issue #1016); only the representative
is archived, so the archive counts evaluations, not creatures.

## 🧬 The descriptor (version 1)

The descriptor is the _design point_: a fixed-length, purely structural summary
computable without touching the corpus. Version 1 has **57** slots.

**Scalars (17):** `neurons`, `inputs`, `outputs`, `hiddenNeurons`,
`constantNeurons`, `synapses`, `depth`, `meanFanIn`, `maxFanIn`, `meanFanOut`,
`maxFanOut`, `weightMeanAbs`, `weightMaxAbs`, `weightRms`, `biasMeanAbs`,
`biasMaxAbs`, `geneticDistanceToReference`.

**Squash histogram (39 + 1):** one slot per canonical activation in
`DESCRIPTOR_V1_SQUASH_NAMES`, plus a trailing `squash:other`. Aliases are
canonicalised, so `RELU` and `ReLU` share a slot. Only hidden and output neurons
are counted — inputs carry no squash.

`meanFanIn` is the mean in-degree over neurons that receive at least one
synapse, `meanFanOut` the mean out-degree over neurons that emit at least one,
and `biasMeanAbs` the mean bias magnitude over neurons that carry a bias. Each
is taken over the population the statistic applies to, never over the whole
neuron array — an input neuron has no bias and a `constant` neuron receives
nothing, so including them would scale the slot by the creature's shape rather
than report the quantity named.

`geneticDistanceToReference` is `1 - geneticCompatibility(creature, fittest)`
against the run's current fittest, or **`-1`** when the run has no fittest yet.
The sentinel is negative on purpose, and it means _only_ that: a creature
measured against itself, or against an identical twin, is a genuine zero
distance and is reported as one.

### One relative slot, and how to read it

`geneticDistanceToReference` is the single **relative** entry in an otherwise
absolute vector. Its origin moves whenever the fittest changes, and an archive
appended to across runs holds distances measured against different lineages — so
two records with the same value in that slot are not necessarily saying the same
thing.

That is why every record carries `referenceUuid`. A consumer fitting a model
over an archive should either **group by `referenceUuid`**, or **drop slot 16**
and fit over the 56 absolute slots. What must not happen is the drift going
unnoticed, which is exactly what recording the origin prevents — the version
gate cannot see it, because the version does not change.

### Descriptor stability is the whole contract

If a slot's meaning drifts, the archive silently becomes a mixture of two
feature spaces and every model fitted to it is wrong in a way that will not show
up as an error. So:

- **Adding, removing, reordering, or re-meaning a slot means bumping
  `EVALUATION_DESCRIPTOR_VERSION`.**
- The squash histogram runs over a **frozen** name list, not over the live
  activation registry. Registering a new activation lands it in `squash:other`
  and does **not** change the layout — the registry stays free to grow.
- Only [IEEE 754](https://en.wikipedia.org/wiki/IEEE_754)-deterministic
  arithmetic is used, so re-deriving a descriptor from the same creature
  reproduces the same vector bit for bit. A committed creature fixture and its
  committed vector (`test/fixtures/archive/descriptor-v1-*.json`) turn any drift
  into a failing test rather than a silent corruption.

**Version mismatches fail loudly.** `readEvaluationArchive` validates **every**
record and throws `EvaluationArchiveError` with reason
`DESCRIPTOR_VERSION_MISMATCH` on the first foreign one. Nothing is coerced, and
a malformed or wrong-length record is reported rather than skipped: a partially
readable archive is not a smaller archive, it is an archive whose contents are
not what they claim.

Opening an archive for **append** checks its **first and last** records rather
than all of them — validating 100,000 records at every run start would cost more
than the archive saves, and the two ends are where a foreign version actually
appears (the first dates the archive, the last is what a newer build most
recently appended). That gate exists to stop _this_ run adding a second feature
space to a file that already holds one; the exhaustive check is the reader's.

## 📦 Retention

The archive keeps the **newest** `maxRecords` records (default `100,000`) and
drops the oldest. Compaction rewrites the file, so it runs only once the archive
is past `maxRecords + slack`, where slack is `max(64, maxRecords / 10)` — that
amortises the rewrite to `O(1)` per record. At the default bound the file is
rewritten once per 10,000 records, which at ~20 evaluations a generation is once
every 500 generations. The file therefore settles between `maxRecords` and
`maxRecords + slack` records: the bound is an "at least", not an exact size.

**One live writer per directory.** Compaction rewrites the file and renames it
into place, and each writer tracks its own record count, so two concurrent runs
sharing a directory can lose each other's appends. Runs may share a directory
**sequentially** — that is how cross-run history accumulates — but a run that
overlaps another needs its own. The file name is fixed for this reason: one
directory is one archive.

**A failed flush loses nothing.** If the write or the version gate fails, the
generation's records stay buffered and the error propagates. Fixing the fault
and flushing again lands them; the loud failure is never also a destructive one.

## ⏱️ Overhead

Measured with `bench/EvaluationArchiveOverhead.ts` against a production-scale
creature (5,300 neurons, 87,096 synapses) and a generation of 20:

| Operation                                         | Cost    |
| ------------------------------------------------- | ------- |
| Descriptor, one creature (no reference)           | 1.4 ms  |
| Descriptor, one creature (with reference)         | 1.4 ms  |
| Descriptor, 20 distinct creatures, cold distances | 40.6 ms |
| `record()` — one exact evaluation                 | 1.4 ms  |
| A whole generation: 20 records + one flush        | 41.7 ms |

Against a ~7.8-minute (468,000 ms) generation that is **~0.017%** — three to
four orders of magnitude below the thing it observes. The distinct-creature row
is the one that matters: the single-pair rows are served by the genetic-distance
cache after their first iteration, so they understate a real generation.

**The budget is asserted, not assumed.** The benchmark times one archived
generation on start-up and **throws** if it exceeds 1% of a generation (4,680
ms) — about 100x the measured cost, so it fires on a two-order-of- magnitude
regression rather than on machine noise. It lives in `bench/` because
`AGENTS.md` forbids timing APIs in `test/`, where parallel execution makes wall-
clock readings unreliable.

## 🔍 How blind is the descriptor?

Two creatures with identical descriptors but materially different exact scores
mean the descriptor cannot see something that decides fitness. No surrogate
fitted to the archive can distinguish them either, so the incidence of that case
is a **ceiling** on how good any such model can be. `reportDescriptorCollisions`
measures it:

```typescript
import {
  formatDescriptorCollisionReport,
  readEvaluationArchive,
  reportDescriptorCollisions,
} from "@stsoftware/neat-ai";

const records = await readEvaluationArchive(
  ".evaluation-archive/evaluations.jsonl",
);
console.log(
  formatDescriptorCollisionReport(reportDescriptorCollisions(records)),
);
```

Only exact records are judged — a partial score differing from an exact one says
something about the corpus fraction, not about the descriptor. Scores within
`DEFAULT_COLLISION_TOLERANCE` (`1e-9`) are treated as agreeing, four orders of
magnitude below the ~`1e-05` gains selection acts on.

### Measured incidence (descriptor v1)

Two real evolution runs against a 200-record regression corpus, reported on
Issue #3919:

| Run                     | Exact records | Distinct descriptors | Colliding records | Incidence  | Widest spread |
| ----------------------- | ------------- | -------------------- | ----------------- | ---------- | ------------- |
| pop 24, 40 generations  | 533           | 519                  | 4                 | **0.750%** | 0.0573        |
| pop 32, 120 generations | 2,114         | 2,071                | 7                 | **0.331%** | 0.1172        |

Under 1% of exact evaluations sit on a descriptor another evaluation disagrees
with, so v1 is not the binding constraint on a surrogate fitted to this archive.
But where it _is_ blind, it is blind to a lot: the widest spreads are four
orders of magnitude larger than the ~`1e-05` accepted gains on the GRQ lineage,
so a surrogate must not be trusted to rank two creatures sharing a descriptor.
Most collisions are structural twins whose weights differ in _arrangement_ but
not in magnitude — v1 summarises weights by magnitude only, so a positional or
per-layer weight summary is the cheapest lever if the incidence ever needs to
come down, at the cost of a version bump.

## 🚫 Not on the creature export

Nothing the archive records reaches `Creature.exportJSON()`. A creature's `uuid`
is a **content hash**, so anything persisted beside it that is not content is a
liability — and the export contract is fixed by the golden fixtures. Lineage in
particular lives in a module-level `WeakMap` (`src/archive/CreatureLineage.ts`),
never on the creature: nothing is serialised, nothing is hashed, and an
offspring dropped from the population stays collectable.

## 📚 See also

- [`docs/RACING.md`](RACING.md) — the model-free member of the same family, and
  the source of the partial scores this archive refuses.
- [`docs/comparison/REFERENCES.md`](comparison/REFERENCES.md) — Jin (2011), and
  Glover (1986) on remembering what was already tried.
