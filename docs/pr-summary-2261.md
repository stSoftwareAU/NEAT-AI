## Summary

Add `bench/RealWorkerDatasetEvaluation.ts` — a benchmark harness that exercises the full production fitness evaluation path using real `WorkerHandler` instances, WASM activation scoring, and on-disk binary datasets. Closes #2261.

Unlike `bench/ParallelFitnessEvaluation.ts` (which uses mock workers), this harness measures actual `evaluateDir` wall time through the real worker pipeline, making it suitable for detecting fitness evaluation performance regressions.

### How to run

```bash
deno bench --allow-read --allow-write --allow-env --allow-net --allow-ffi \
  bench/RealWorkerDatasetEvaluation.ts
```

### What it benchmarks

| Group | Topology | Workers | Purpose |
|---|---|---|---|
| small topology | 2 hidden, 4 synapses | 1, 2 | Minimal network baseline |
| medium topology | 10 hidden, 25 synapses | 1, 2 | Typical early evolution |
| large topology | 30 hidden, 90 synapses | 1, 2 | Mature topology |
| mixed population | 10 creatures (4 small + 4 medium + 2 large) | 1, 2 | Production-like batch |

Dataset: 500 records (3 inputs, 2 outputs) across 5 partition files.

### Sample output

```
group small topology
| small topology (2 hidden), 1 worker       |   503.9 us |
| small topology (2 hidden), 2 workers      |   531.5 us |

group medium topology
| medium topology (10 hidden), 1 worker     |   592.2 us |
| medium topology (10 hidden), 2 workers    |   693.5 us |

group large topology
| large topology (30 hidden), 1 worker      |   962.6 us |
| large topology (30 hidden), 2 workers     |     1.1 ms |

group mixed population
| mixed population (10 creatures), 1 worker |     2.2 ms |
| mixed population (10 creatures), 2 workers|     2.3 ms |
```

## Evidence

This is a benchmark infrastructure change (no UI). Evidence is the successful benchmark run output above showing all groups complete with timing data.

## Test Plan

- Benchmark harness runs to completion with `deno bench` (verified above)
- Quality gate passes (`./quality.sh --skip-discovery --skip-wasm --skip-tests`)
- Type-checking passes (`deno check`)
- No existing tests modified
