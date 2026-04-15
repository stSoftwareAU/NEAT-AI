# Production-Scale evolveDir Bottleneck Analysis

Issue #2307 — Contrasting with small-data profiling from #2274.

## Environment

| Property | Value                              |
| -------- | ---------------------------------- |
| CPU      | Apple M4 Pro                       |
| Runtime  | Deno 2.7.12 (aarch64-apple-darwin) |
| Date     | 2026-04-15                         |

## Creature Dimensions

| Parameter            | Value  |
| -------------------- | ------ |
| Inputs               | 648    |
| Outputs              | 2      |
| Neurons              | 1,492  |
| Synapses             | 19,968 |
| Training files       | 520    |
| Records per file     | 100    |
| Training sample rate | 5%     |

## Profile Summary

- Generations profiled: 12
- Population size: ~20–23

## Phase Timing Breakdown

| Phase           |   Mean (ms) | % of Total | Rank |
| --------------- | ----------: | ---------: | ---: |
| fitness         |     29006.3 |      65.7% |    1 |
| breeding        |     13117.8 |      29.7% |    2 |
| deduplication   |       653.8 |       1.5% |    3 |
| mutation        |       298.8 |       0.7% |    4 |
| preWarm         |        69.6 |       0.2% |    5 |
| **Total (avg)** | **44124.2** | **100.0%** |    — |

## Per-Generation Detail

| Gen | Total (ms) | Fitness (ms) | Breeding (ms) | Mutation | Dedup | Pop |
| --: | ---------: | -----------: | ------------: | -------: | ----: | --: |
|   1 |      45733 |        29135 |         15349 |      102 |   313 |  22 |
|   2 |      46403 |        28906 |         15788 |      597 |   546 |  22 |
|   3 |      46353 |        29538 |         15192 |      261 |   459 |  23 |
|   4 |      47966 |        31064 |         15044 |      269 |   404 |  23 |
|   5 |      48531 |        30718 |         16009 |      298 |   380 |  22 |
|   6 |      46312 |        29301 |         14988 |      499 |   376 |  22 |
|   7 |      46252 |        29518 |         14582 |      297 |   608 |  20 |
|   8 |      43583 |        26671 |         14355 |      193 |  1274 |  20 |
|   9 |      43603 |        26626 |         14612 |      310 |   972 |  20 |
|  10 |      44140 |        26672 |         14666 |      292 |  1423 |  20 |
|  11 |      33928 |        28432 |          3264 |      298 |   776 |  19 |
|  12 |      36686 |        31494 |          3565 |      169 |   315 |  19 |

## Memory Usage Across Generations

| Gen | RSS (MB) | Heap Used (MB) | Heap Total (MB) |
| --: | -------: | -------------: | --------------: |
|   1 |     1257 |           1007 |            1083 |
|   2 |     1131 |            604 |             655 |
|   3 |     1002 |           1111 |            1192 |
|   4 |     1298 |           1049 |            1124 |
|   5 |     1094 |           1331 |            1396 |
|   6 |     1342 |           1100 |            1186 |
|   7 |     1229 |           1296 |            1370 |
|   8 |     1468 |            941 |            1016 |
|   9 |     1457 |           1123 |            1190 |
|  10 |     1428 |           1031 |            1104 |
|  11 |     1014 |            643 |             731 |
|  12 |      999 |            560 |             651 |

Memory growth from gen 1 to gen 12:

- RSS: -259 MB (1257 → 999 MB)
- Heap: -447 → 560 MB

## Comparison: Production-Scale vs Small-Data (#2274)

| Phase         | Small-Data (~80 neurons) | Production (~1,500 neurons) | Shift          |
| ------------- | -----------------------: | --------------------------: | -------------- |
| fitness       |                    15.5% |                       65.7% | ⬆️ up 50.2pp   |
| breeding      |                    53.5% |                       29.7% | ⬇️ down 23.8pp |
| mutation      |                     7.2% |                        0.7% | ⬇️ down 6.5pp  |
| deduplication |                     7.5% |                        1.5% | ⬇️ down 6.0pp  |

## Top Bottlenecks (Ranked by Wall-Clock Impact)

1. **fitness** — 65.7% of total (mean 29006 ms/gen)
2. **breeding** — 29.7% of total (mean 13118 ms/gen)
3. **deduplication** — 1.5% of total (mean 654 ms/gen)
4. **mutation** — 0.7% of total (mean 299 ms/gen)
5. **preWarm** — 0.2% of total (mean 70 ms/gen)

## I/O vs Compute Ratio

- Compute: 99.9% (44101 ms/gen)
- I/O: 0.1% (24 ms/gen)

## Actionable Recommendations

1. **Optimise fitness evaluation (WASM activation)**: At 65.7% of wall-clock
   time, fitness is the dominant bottleneck at production scale. Each activation
   of a 1,500-neuron network through WASM takes ~11 ms. With pop 20 × ~50
   training samples, this accounts for ~29 s/gen. Consider batched WASM
   activation, SIMD within WASM, or reducing activation overhead.

2. **Optimise breeding for large creatures**: At 29.7% of total, breeding is the
   second bottleneck. The per-offspring cost scales with genome size (~20,000
   synapses for alignment/crossover). Pre-computing alignment maps or caching
   could help.

3. **Investigate training sample rate tuning**: The fitness phase dominates
   because each creature is evaluated against many samples. Adaptive sample
   rates (lower in early generations, higher near convergence) could reduce
   fitness cost by 30–50% without significantly impacting convergence.

4. **Monitor memory pressure**: RSS ranges from ~1.0–1.5 GB across generations,
   with critical memory pressure events. Memory-efficient creature
   representation or streaming evaluation could reduce peak usage.

5. **De-duplication overhead grows**: While only 1.5% overall, de-duplication
   shows increasing cost in later generations (up to 1,400 ms in gen 10 vs 313
   ms in gen 1), suggesting cache or set growth over time.
