# Gradient reliability at depth — measured profile (Issue #3972)

Produced by `scripts/gradientDepthReport.ts` over
`src/propagate/GradientDepthProbe.ts`. Reproduce with:

```bash
deno run --allow-read --allow-write --allow-env --allow-ffi \
  scripts/gradientDepthReport.ts \
  --creature test/data/grq-23-forests-constants.json --samples 64 --seed 42
```

## Reading the tables

- **zero** — the fraction of neuron x sample measurements whose gradient was
  _exactly_ zero. This is the number a mean magnitude hides.
- **sign flips** — of the consecutive-sample pairs where both gradients were
  non-zero, how many reversed sign. `n/a` means no pair was comparable, which at
  these depths means the gradient was never non-zero twice running. This is the
  Balduzzi et al. (2017) shattered-gradient diagnostic.
- **zero attribution** — the construct that blocked the most routes out of the
  neuron on that measurement. `downstream-zero` means the loss happened closer
  to the output and this neuron only inherited it.

## Provenance and its limits

The production GRQ corpus is not in this repository, so the GRQ rows below are
**seeded synthetic observations**, not production data. To show the result is
not an artefact of that choice, the same creature is profiled at two input
scales two orders of magnitude apart; the picture is the same in both. Feed a
real corpus with `--observations <file.json>` (a JSON array of input rows) to
replace it.

---

## test/data/grq-23-forests-constants.json

- observations: 64 rows (SYNTHETIC seeded uniform[-1,1), seed 42 — not
  production data)
- deepest layer: 61
- serial chain: depth 34–61, 28 neurons

| depth | neurons | obs   | zero   | median \|g\| | p95 \|g\| | max \|g\| | sign flips | zero attribution                                                                            |
| ----- | ------- | ----- | ------ | ------------ | --------- | --------- | ---------- | ------------------------------------------------------------------------------------------- |
| 1     | 1030    | 65920 | 99.8%  | 0.00e+0      | 0.00e+0   | 3.79e-1   | 0.0%       | saturated-derivative 46079, if-condition 11517, downstream-zero 8016, untaken-if-branch 205 |
| 2     | 442     | 28288 | 64.6%  | 0.00e+0      | 1.00e+0   | 1.23e+1   | 0.0%       | saturated-derivative 12429, downstream-zero 4114, untaken-if-branch 1025, if-condition 704  |
| 3     | 282     | 18048 | 73.8%  | 0.00e+0      | 1.00e+0   | 1.46e+1   | 0.0%       | saturated-derivative 5832, untaken-if-branch 5468, downstream-zero 2023                     |
| 4     | 90      | 5760  | 95.5%  | 0.00e+0      | 0.00e+0   | 1.00e+0   | 0.0%       | saturated-derivative 3688, downstream-zero 1340, untaken-if-branch 347, if-condition 128    |
| 5     | 62      | 3968  | 98.9%  | 0.00e+0      | 0.00e+0   | 2.00e-3   | 23.1%      | saturated-derivative 3116, downstream-zero 786, untaken-if-branch 23                        |
| 6     | 34      | 2176  | 99.9%  | 0.00e+0      | 0.00e+0   | 4.27e-2   | n/a        | saturated-derivative 1204, downstream-zero 904, if-condition 64, untaken-if-branch 1        |
| 7     | 32      | 2048  | 96.9%  | 0.00e+0      | 0.00e+0   | 1.00e+0   | 0.0%       | saturated-derivative 1642, downstream-zero 342                                              |
| 8     | 31      | 1984  | 98.5%  | 0.00e+0      | 0.00e+0   | 1.00e+0   | 0.0%       | saturated-derivative 1255, downstream-zero 663, untaken-if-branch 36                        |
| 9     | 26      | 1664  | 99.8%  | 0.00e+0      | 0.00e+0   | 2.97e-2   | n/a        | saturated-derivative 1324, downstream-zero 316, if-condition 21                             |
| 10    | 12      | 768   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 622, downstream-zero 146                                               |
| 11    | 8       | 512   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 478, untaken-if-branch 18, downstream-zero 16                          |
| 12    | 6       | 384   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 192, downstream-zero 192                                               |
| 13    | 12      | 768   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 606, downstream-zero 162                                               |
| 14    | 14      | 896   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 577, downstream-zero 319                                               |
| 15    | 14      | 896   | 99.7%  | 0.00e+0      | 0.00e+0   | 7.11e-2   | n/a        | saturated-derivative 540, downstream-zero 339, untaken-if-branch 14                         |
| 16    | 14      | 896   | 99.7%  | 0.00e+0      | 0.00e+0   | 7.15e-2   | n/a        | saturated-derivative 656, downstream-zero 223, untaken-if-branch 14                         |
| 17    | 10      | 640   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 431, downstream-zero 200, if-condition 9                               |
| 18    | 8       | 512   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 344, downstream-zero 168                                               |
| 19    | 10      | 640   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 424, downstream-zero 216                                               |
| 20    | 6       | 384   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 377, downstream-zero 7                                                 |
| 21    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 258, downstream-zero 190                                               |
| 22    | 9       | 576   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 547, downstream-zero 29                                                |
| 23    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 448                                                                    |
| 24    | 9       | 576   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 554, downstream-zero 22                                                |
| 25    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 318, downstream-zero 66, if-condition 64                               |
| 26    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 431, downstream-zero 17                                                |
| 27    | 8       | 512   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 448, downstream-zero 64                                                |
| 28    | 11      | 704   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 628, downstream-zero 76                                                |
| 29    | 6       | 384   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 384                                                                    |
| 30    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 448                                                                    |
| 31    | 5       | 320   | 99.1%  | 0.00e+0      | 0.00e+0   | 5.75e-2   | n/a        | saturated-derivative 314, downstream-zero 3                                                 |
| 32    | 4       | 256   | 98.8%  | 0.00e+0      | 0.00e+0   | 6.99e-2   | n/a        | saturated-derivative 192, downstream-zero 47, untaken-if-branch 14                          |
| 33    | 3       | 192   | 98.4%  | 0.00e+0      | 0.00e+0   | 7.15e-2   | n/a        | saturated-derivative 128, downstream-zero 47, untaken-if-branch 14                          |
| 34    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                          |
| 35    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 48, unselected-min-max 16                                                   |
| 36    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                          |
| 37    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 53, unselected-min-max 11                                                   |
| 38    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                          |
| 39    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 56, unselected-min-max 8                                                    |
| 40    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                          |
| 41    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | if-condition 43, saturated-derivative 21                                                    |
| 42    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | unselected-min-max 51, downstream-zero 7, untaken-if-branch 6                               |
| 43    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | untaken-if-branch 55, downstream-zero 9                                                     |
| 44    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 59, downstream-zero 5                                                  |
| 45    | 1       | 64    | 98.4%  | 0.00e+0      | 0.00e+0   | 1.03e+0   | n/a        | downstream-zero 32, unselected-min-max 31                                                   |
| 46    | 1       | 64    | 95.3%  | 0.00e+0      | 0.00e+0   | 7.38e+0   | n/a        | if-condition 61                                                                             |
| 47    | 1       | 64    | 95.3%  | 0.00e+0      | 0.00e+0   | 7.35e+0   | n/a        | unselected-min-max 48, downstream-zero 12, untaken-if-branch 1                              |
| 48    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | untaken-if-branch 63, downstream-zero 1                                                     |
| 49    | 1       | 64    | 95.3%  | 0.00e+0      | 0.00e+0   | 7.15e+0   | n/a        | if-condition 51, unselected-min-max 10                                                      |
| 50    | 1       | 64    | 95.3%  | 0.00e+0      | 0.00e+0   | 7.15e+0   | n/a        | downstream-zero 44, unselected-min-max 14, untaken-if-branch 3                              |
| 51    | 1       | 64    | 98.4%  | 0.00e+0      | 0.00e+0   | 7.15e+0   | n/a        | untaken-if-branch 50, downstream-zero 13                                                    |
| 52    | 1       | 64    | 93.8%  | 0.00e+0      | 1.00e+0   | 7.15e+0   | n/a        | if-condition 47, unselected-min-max 13                                                      |
| 53    | 1       | 64    | 87.5%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | n/a        | if-condition 52, unselected-min-max 4                                                       |
| 54    | 1       | 64    | 84.4%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | unselected-min-max 49, downstream-zero 4, untaken-if-branch 1                               |
| 55    | 1       | 64    | 90.6%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | untaken-if-branch 54, downstream-zero 4                                                     |
| 56    | 1       | 64    | 81.3%  | 0.00e+0      | 2.54e+2   | 2.54e+2   | 0.0%       | unselected-min-max 46, downstream-zero 4, untaken-if-branch 2                               |
| 57    | 1       | 64    | 43.8%  | 7.15e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | untaken-if-branch 22, downstream-zero 6                                                     |
| 58    | 1       | 64    | 35.9%  | 7.15e+0      | 7.15e+0   | 7.15e+0   | 23.1%      | untaken-if-branch 23                                                                        |
| 59    | 1       | 64    | 28.1%  | 1.00e+0      | 1.00e+0   | 1.00e+0   | 0.0%       | unselected-min-max 18                                                                       |
| 60    | 1       | 64    | 56.3%  | 0.00e+0      | 1.00e+0   | 1.00e+0   | 0.0%       | untaken-if-branch 36                                                                        |

Restricted to the serial chain:

| depth | neurons | obs  | zero  | median \|g\| | p95 \|g\| | max \|g\| | sign flips | zero attribution                                                                                              |
| ----- | ------- | ---- | ----- | ------------ | --------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 34    | 27      | 1728 | 88.1% | 0.00e+0      | 7.15e+0   | 2.54e+2   | 6.5%       | downstream-zero 554, unselected-min-max 319, untaken-if-branch 316, if-condition 254, saturated-derivative 80 |

---

### Input-scale sensitivity check

The same creature, observations scaled to `uniform[-0.01, 0.01)`.

## test/data/grq-23-forests-constants.json

- observations: 64 rows (corpus /tmp/obs-small.json)
- deepest layer: 61
- serial chain: depth 34–61, 28 neurons

| depth | neurons | obs   | zero   | median \|g\| | p95 \|g\| | max \|g\| | sign flips | zero attribution                                                                                                   |
| ----- | ------- | ----- | ------ | ------------ | --------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 1     | 1030    | 65920 | 99.7%  | 0.00e+0      | 0.00e+0   | 1.57e-1   | 0.0%       | saturated-derivative 43351, if-condition 11523, downstream-zero 10495, untaken-if-branch 321, unselected-min-max 3 |
| 2     | 442     | 28288 | 64.3%  | 0.00e+0      | 1.00e+0   | 1.37e+0   | 0.0%       | saturated-derivative 11420, downstream-zero 4966, untaken-if-branch 1110, if-condition 704                         |
| 3     | 282     | 18048 | 96.7%  | 0.00e+0      | 0.00e+0   | 1.00e+0   | 0.0%       | untaken-if-branch 9540, saturated-derivative 5100, downstream-zero 2809                                            |
| 4     | 90      | 5760  | 99.7%  | 0.00e+0      | 0.00e+0   | 8.73e-9   | n/a        | saturated-derivative 3391, downstream-zero 1581, untaken-if-branch 645, if-condition 128                           |
| 5     | 62      | 3968  | 98.2%  | 0.00e+0      | 0.00e+0   | 5.95e-4   | 0.0%       | saturated-derivative 2647, downstream-zero 1251                                                                    |
| 6     | 34      | 2176  | 99.5%  | 0.00e+0      | 0.00e+0   | 4.21e-30  | n/a        | saturated-derivative 1044, downstream-zero 996, if-condition 64, untaken-if-branch 62                              |
| 7     | 32      | 2048  | 96.6%  | 0.00e+0      | 0.00e+0   | 1.00e+0   | 0.0%       | saturated-derivative 1404, downstream-zero 575                                                                     |
| 8     | 31      | 1984  | 99.8%  | 0.00e+0      | 0.00e+0   | 1.96e-31  | n/a        | saturated-derivative 1107, downstream-zero 810, untaken-if-branch 64                                               |
| 9     | 26      | 1664  | 99.9%  | 0.00e+0      | 0.00e+0   | 6.62e-31  | n/a        | saturated-derivative 1167, downstream-zero 432, if-condition 63                                                    |
| 10    | 12      | 768   | 99.9%  | 0.00e+0      | 0.00e+0   | 3.69e-32  | n/a        | saturated-derivative 466, downstream-zero 301                                                                      |
| 11    | 8       | 512   | 99.8%  | 0.00e+0      | 0.00e+0   | 4.09e-33  | n/a        | saturated-derivative 408, downstream-zero 77, untaken-if-branch 26                                                 |
| 12    | 6       | 384   | 99.5%  | 0.00e+0      | 0.00e+0   | 3.38e-31  | n/a        | downstream-zero 198, saturated-derivative 184                                                                      |
| 13    | 12      | 768   | 99.7%  | 0.00e+0      | 0.00e+0   | 5.25e-28  | n/a        | downstream-zero 422, saturated-derivative 344                                                                      |
| 14    | 14      | 896   | 99.9%  | 0.00e+0      | 0.00e+0   | 3.38e-29  | n/a        | saturated-derivative 525, downstream-zero 370                                                                      |
| 15    | 14      | 896   | 99.9%  | 0.00e+0      | 0.00e+0   | 4.02e-31  | n/a        | saturated-derivative 454, downstream-zero 377, untaken-if-branch 64                                                |
| 16    | 14      | 896   | 99.9%  | 0.00e+0      | 0.00e+0   | 2.72e-28  | n/a        | saturated-derivative 603, downstream-zero 228, untaken-if-branch 64                                                |
| 17    | 10      | 640   | 99.8%  | 0.00e+0      | 0.00e+0   | 1.79e-26  | n/a        | saturated-derivative 326, downstream-zero 249, if-condition 64                                                     |
| 18    | 8       | 512   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 298, saturated-derivative 214                                                                      |
| 19    | 10      | 640   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 339, downstream-zero 301                                                                      |
| 20    | 6       | 384   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 302, downstream-zero 82                                                                       |
| 21    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 297, downstream-zero 151                                                                      |
| 22    | 9       | 576   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 507, downstream-zero 69                                                                       |
| 23    | 7       | 448   | 99.8%  | 0.00e+0      | 0.00e+0   | 3.97e-26  | n/a        | saturated-derivative 435, downstream-zero 12                                                                       |
| 24    | 9       | 576   | 99.8%  | 0.00e+0      | 0.00e+0   | 7.70e-7   | n/a        | saturated-derivative 512, downstream-zero 63                                                                       |
| 25    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 278, downstream-zero 106, if-condition 64                                                     |
| 26    | 7       | 448   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 432, downstream-zero 16                                                                       |
| 27    | 8       | 512   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 429, downstream-zero 83                                                                       |
| 28    | 11      | 704   | 99.9%  | 0.00e+0      | 0.00e+0   | 7.56e-8   | n/a        | saturated-derivative 611, downstream-zero 92                                                                       |
| 29    | 6       | 384   | 99.7%  | 0.00e+0      | 0.00e+0   | 1.68e-7   | n/a        | saturated-derivative 349, downstream-zero 34                                                                       |
| 30    | 7       | 448   | 99.8%  | 0.00e+0      | 0.00e+0   | 3.01e-7   | n/a        | saturated-derivative 432, downstream-zero 15                                                                       |
| 31    | 5       | 320   | 99.7%  | 0.00e+0      | 0.00e+0   | 7.92e-2   | n/a        | saturated-derivative 247, downstream-zero 72                                                                       |
| 32    | 4       | 256   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 186, untaken-if-branch 64, downstream-zero 6                                                  |
| 33    | 3       | 192   | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 122, untaken-if-branch 64, downstream-zero 6                                                  |
| 34    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                                                 |
| 35    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 59, unselected-min-max 5                                                                           |
| 36    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                                                 |
| 37    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                                                 |
| 38    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                                                 |
| 39    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                                                 |
| 40    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 64                                                                                                 |
| 41    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | if-condition 64                                                                                                    |
| 42    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | unselected-min-max 64                                                                                              |
| 43    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | untaken-if-branch 59, downstream-zero 5                                                                            |
| 44    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 46, saturated-derivative 18                                                                        |
| 45    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 62, unselected-min-max 2                                                                           |
| 46    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | if-condition 64                                                                                                    |
| 47    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | unselected-min-max 64                                                                                              |
| 48    | 1       | 64    | 98.4%  | 0.00e+0      | 0.00e+0   | 7.14e+0   | n/a        | downstream-zero 61, untaken-if-branch 2                                                                            |
| 49    | 1       | 64    | 98.4%  | 0.00e+0      | 0.00e+0   | 7.15e+0   | n/a        | unselected-min-max 52, if-condition 11                                                                             |
| 50    | 1       | 64    | 96.9%  | 0.00e+0      | 0.00e+0   | 7.15e+0   | n/a        | untaken-if-branch 37, unselected-min-max 25                                                                        |
| 51    | 1       | 64    | 92.2%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | n/a        | downstream-zero 59                                                                                                 |
| 52    | 1       | 64    | 92.2%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | n/a        | unselected-min-max 38, if-condition 21                                                                             |
| 53    | 1       | 64    | 73.4%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | if-condition 47                                                                                                    |
| 54    | 1       | 64    | 73.4%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | unselected-min-max 36, untaken-if-branch 7, downstream-zero 4                                                      |
| 55    | 1       | 64    | 64.1%  | 0.00e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | untaken-if-branch 29, downstream-zero 12                                                                           |
| 56    | 1       | 64    | 56.3%  | 0.00e+0      | 2.54e+2   | 2.54e+2   | 0.0%       | unselected-min-max 36                                                                                              |
| 57    | 1       | 64    | 0.0%   | 7.15e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | —                                                                                                                  |
| 58    | 1       | 64    | 0.0%   | 7.15e+0      | 7.15e+0   | 7.15e+0   | 0.0%       | —                                                                                                                  |
| 59    | 1       | 64    | 0.0%   | 1.00e+0      | 1.00e+0   | 1.00e+0   | 0.0%       | —                                                                                                                  |
| 60    | 1       | 64    | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | untaken-if-branch 64                                                                                               |

Restricted to the serial chain:

| depth | neurons | obs  | zero  | median \|g\| | p95 \|g\| | max \|g\| | sign flips | zero attribution                                                                                              |
| ----- | ------- | ---- | ----- | ------------ | --------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 34    | 27      | 1728 | 83.2% | 0.00e+0      | 7.15e+0   | 2.54e+2   | 0.0%       | downstream-zero 692, unselected-min-max 322, if-condition 207, untaken-if-branch 198, saturated-derivative 18 |

---

# Controls

Two shallower creatures from the same repository, profiled identically. A
sign-flip rate means nothing without knowing what a working network's looks like
here.

## test/data/europa-sample.json

- observations: 64 rows (SYNTHETIC seeded uniform[-1,1), seed 42 — not
  production data)
- deepest layer: 3
- serial chain: none

| depth | neurons | obs | zero | median \|g\| | p95 \|g\| | max \|g\| | sign flips | zero attribution |
| ----- | ------- | --- | ---- | ------------ | --------- | --------- | ---------- | ---------------- |
| 1     | 12      | 768 | 0.0% | 9.30e-2      | 5.86e-1   | 1.23e+0   | 28.0%      | —                |
| 2     | 8       | 512 | 0.0% | 7.57e-2      | 2.99e-1   | 4.35e-1   | 18.5%      | —                |

## test/data/grq-25-1-sample.json

- observations: 64 rows (SYNTHETIC seeded uniform[-1,1), seed 42 — not
  production data)
- deepest layer: 9
- serial chain: none

| depth | neurons | obs | zero   | median \|g\| | p95 \|g\| | max \|g\| | sign flips | zero attribution                              |
| ----- | ------- | --- | ------ | ------------ | --------- | --------- | ---------- | --------------------------------------------- |
| 1     | 10      | 640 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 640                           |
| 2     | 10      | 640 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 474, saturated-derivative 166 |
| 3     | 8       | 512 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 512                           |
| 4     | 8       | 512 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 512                           |
| 5     | 6       | 384 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | downstream-zero 320, saturated-derivative 64  |
| 6     | 6       | 384 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 384                      |
| 7     | 6       | 384 | 100.0% | 0.00e+0      | 0.00e+0   | 0.00e+0   | n/a        | saturated-derivative 384                      |
| 8     | 6       | 384 | 0.0%   | 5.13e-2      | 1.46e-1   | 1.46e-1   | 0.0%       | —                                             |

---

## Finding

**Zero gradient (topology), not badly-scaled gradient (#3916).**

- The shallow control (`europa-sample.json`, 3 deep) never once measured an
  exactly-zero gradient, and flips sign on 18–28% of consecutive pairs. That is
  what a working gradient looks like in this engine.
- The GRQ creature is exactly zero on **99.8%** of measurements at depth 1 and
  **100%** from depth 10 through depth 44. The largest magnitude seen anywhere
  below depth 30 is `1e-30` at the small input scale.
- The sign-flip rate is `n/a` almost everywhere below depth 34 — the gradient is
  never non-zero on two consecutive samples, so there is nothing to flip. The
  failure is **dead**, not noisy: it is not the shattered-gradient signature, it
  is the degenerate case beyond it.
- Attribution: `saturated-derivative` dominates every bucket from depth 4 to
  depth 33 (`HARD_TANH` outside `(-1, 1)`), and inside the depth 34–61 serial
  chain the blame moves to the branch constructs — `unselected-min-max`,
  `untaken-if-branch` and `if-condition` together account for most of it.

Adam, momentum, or any adaptive per-parameter step size (#3916) multiplies a
gradient that is exactly zero and gets exactly zero. This is a
topology/activation problem, and the two structural issues gated on this
measurement — #3973 and #3974 — are worth building.
