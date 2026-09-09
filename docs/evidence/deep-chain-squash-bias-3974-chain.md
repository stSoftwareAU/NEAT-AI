# Depth-aware squash bias — matched baseline (Issue #3974)

- Creature: `test/data/grq-23-forests-constants.json`
- Serial run: 28 members from depth 34
- Draws: 100 squash mutations × 4 creatures, focus `chain`, seed 3974
- Bias arm: `deepChainSquashBias: 1`, `deepChainMinLength: 4`
- Probe rows: 16
- Provenance: test/data/grq-23-forests-constants.json; SYNTHETIC seeded uniform
  [-1, 1) probe rows, seed 3974 — not production data

## What the draws proposed

| Arm      | Squash mutations | Blocking | Share |
| -------- | ---------------: | -------: | ----: |
| baseline |              400 |       23 |  5.8% |
| biased   |              400 |        5 |  1.3% |
| ceiling  |                0 |        0 |  0.0% |

## Diversity, against the matched baseline

The `ceiling` arm takes no draws, so its population is one creature repeated:
its species count is 1 by construction and is not a diversity reading. Compare
`baseline` against `biased`.

| Arm      | Distinct squashes | Entropy (bits) | Species | Species diversity |
| -------- | ----------------: | -------------: | ------: | ----------------: |
| baseline |                33 |          4.432 |       1 |             0.250 |
| biased   |                33 |          4.432 |       1 |             0.250 |
| ceiling  |                33 |          4.398 |       1 |             0.250 |

## The run itself

| Arm      | Blocking members | Members | Run zero-gradient | Depths 1→entry |
| -------- | ---------------: | ------: | ----------------: | -------------: |
| baseline |                2 |      28 |             64.4% |          86.0% |
| biased   |                1 |      28 |             66.0% |          88.6% |
| ceiling  |                0 |      28 |              0.0% |          14.2% |

## What the probe blames the run's zero gradients on

| Cause             | baseline | biased | ceiling |
| ----------------- | -------: | -----: | ------: |
| cancellation      |        0 |      3 |       0 |
| downstream-zero   |      299 |    297 |       0 |
| untaken-if-branch |       14 |     13 |       0 |
| zero-derivative   |       64 |     73 |       0 |

## Squash histogram

| Squash        | baseline | biased | ceiling | Blocking |
| ------------- | -------: | -----: | ------: | -------- |
| ABSOLUTE      |      642 |    642 |     640 | no       |
| ArcTan        |      207 |    207 |     204 | no       |
| BENT_IDENTITY |      518 |    518 |     512 | no       |
| BIPOLAR       |      124 |    124 |     124 | yes      |
| Cosine        |      174 |    174 |     172 | no       |
| Cube          |      263 |    263 |     260 | no       |
| ELU           |      226 |    228 |     220 | no       |
| Exponential   |       26 |     26 |      24 | no       |
| GAUSSIAN      |      158 |    158 |     156 | no       |
| GELU          |      451 |    452 |     444 | no       |
| HARD_TANH     |      285 |    281 |     280 | yes      |
| IDENTITY      |     1353 |   1353 |    1464 | no       |
| IF            |      715 |    714 |     712 | yes      |
| ISRU          |       79 |     79 |      76 | no       |
| LOGISTIC      |      295 |    295 |     288 | no       |
| LeakyReLU     |      121 |    121 |     116 | no       |
| LogSigmoid    |      155 |    155 |     148 | no       |
| MAXIMUM       |        6 |      6 |       4 | yes      |
| MINIMUM       |       12 |     12 |      12 | yes      |
| Mish          |      234 |    236 |     228 | no       |
| ReLU          |      413 |    413 |     412 | no       |
| ReLU6         |       92 |     92 |      92 | yes      |
| SELU          |      478 |    477 |     468 | no       |
| SINE          |      426 |    426 |     424 | no       |
| SOFTMAX       |        4 |      4 |       4 | no       |
| SOFTSIGN      |      154 |    154 |     152 | no       |
| SQRT          |       25 |     25 |      24 | no       |
| SQUARE        |      144 |    144 |     144 | no       |
| STEP          |      700 |    700 |     700 | yes      |
| Softplus      |      220 |    220 |     212 | no       |
| Swish         |      246 |    246 |     236 | no       |
| TAN           |       32 |     32 |      32 | no       |
| TANH          |       66 |     67 |      60 | no       |
