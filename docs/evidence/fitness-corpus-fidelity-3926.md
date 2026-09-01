# Wall-clock per generation vs corpus fidelity (Issue #3926)

The multi-fidelity claim is that scoring a corpus one tenth the size costs
roughly one tenth of the wall-clock, because each record is scored independently
on a forward-only creature. This is the measurement of that claim, not an
assumption of it.

## The run

```bash
deno task bench:fitness-corpus --records=20000 --rates=1,0.5,0.1 \
  --population=20 --seed=3926
```

| Parameter  | Value                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Creature   | `grq-3926` preset — 5,317 neurons / 39,031 synapses / 2,511 inputs, forward-only      |
| Generation | one scoring pass over a population of 20 (the requested production population)        |
| Corpus     | 20,000 synthetic records at the production record shape (2511 → 1, 10,048 B a record) |
| Cost       | `MSE`                                                                                 |
| Host       | 7-core container, Deno 2.x, WASM scoring path                                         |

A sampled corpus is a stride of the full one, so every fidelity scores the same
distribution of records and the comparison isolates corpus **size**.

## The measurement

| Fitness sample rate | Records | Corpus    | ms / generation | vs full |
| ------------------- | ------- | --------- | --------------- | ------- |
| 1                   | 20000   | 191.7 MiB | 97031           | 1.000   |
| 0.5                 | 10000   | 95.8 MiB  | 48123           | 0.496   |
| 0.1                 | 2000    | 19.2 MiB  | 9628            | 0.099   |

Wall-clock tracks corpus size to within half a percent at both rates: 0.496 and
0.099 against the 0.5 and 0.1 the corpora were cut at. The cost of a generation
is where the issue assumed it was — in the per-record scoring work — so a tenth
of the corpus really does buy about ten times the generations per hour.

```mermaid
flowchart LR
    A["rate 1<br/>20 000 records<br/>97.0 s"] --> B["rate 0.5<br/>10 000 records<br/>48.1 s"]
    B --> C["rate 0.1<br/>2 000 records<br/>9.6 s"]
```

## What this does not say

- **It is not a licence to sample.** Choosing when a run should score a sampled
  corpus is model management and is decided elsewhere; production keeps scoring
  the full corpus.
- **It is a synthetic corpus at the production record shape**, not the 21.2 GiB
  production corpus, and the creature is the `grq-3926` generated topology at
  the production neuron/synapse/input counts rather than the production
  `network.json`. The proportionality it measures is a property of per-record
  scoring work, which both share.
- **It says nothing about score quality.** A tenth of the records is a noisier
  estimate of the same quantity; that trade-off is the surrogate-model question
  the parent issue tracks, not this measurement.
