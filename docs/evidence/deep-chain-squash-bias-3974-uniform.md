# Depth-aware squash bias — matched baseline (Issue #3974)

- Creature: `test/data/grq-23-forests-constants.json`
- Serial run: 28 members from depth 34
- Draws: 2000 squash mutations × 4 creatures, focus `any`, seed 17
- Bias arm: `deepChainSquashBias: 1`, `deepChainMinLength: 4`
- Probe rows: 16
- Provenance: test/data/grq-23-forests-constants.json; SYNTHETIC seeded uniform
  [-1, 1) probe rows, seed 17 — not production data

## What the draws proposed

| Arm      | Squash mutations | Blocking | Share |
| -------- | ---------------: | -------: | ----: |
| baseline |             8000 |      503 |  6.3% |
| biased   |             8000 |      499 |  6.2% |
| ceiling  |                0 |        0 |  0.0% |

## Diversity, against the matched baseline

The `ceiling` arm takes no draws, so its population is one creature repeated:
its species count is 1 by construction and is not a diversity reading. Compare
`baseline` against `biased`.

| Arm      | Distinct squashes | Entropy (bits) | Species | Species diversity |
| -------- | ----------------: | -------------: | ------: | ----------------: |
| baseline |                36 |          4.701 |       4 |             1.000 |
| biased   |                36 |          4.703 |       4 |             1.000 |
| ceiling  |                33 |          4.444 |       1 |             0.250 |

## The run itself

| Arm      | Blocking members | Members | Run zero-gradient | Depths 1→entry |
| -------- | ---------------: | ------: | ----------------: | -------------: |
| baseline |               16 |      28 |             53.9% |          76.1% |
| biased   |               15 |      28 |             60.2% |          76.8% |
| ceiling  |                0 |      28 |             88.9% |          85.4% |

## What the probe blames the run's zero gradients on

| Cause              | baseline | biased | ceiling |
| ------------------ | -------: | -----: | ------: |
| downstream-zero    |      203 |    244 |     395 |
| if-condition       |       20 |     23 |       0 |
| unselected-min-max |       26 |     35 |       0 |
| untaken-if-branch  |       28 |     35 |       0 |
| zero-derivative    |       23 |     11 |     149 |

## Squash histogram

| Squash          | baseline | biased | ceiling | Blocking |
| --------------- | -------: | -----: | ------: | -------- |
| ABSOLUTE        |      427 |    427 |     640 | no       |
| ArcTan          |      318 |    321 |     204 | no       |
| BENT_IDENTITY   |      443 |    442 |     512 | no       |
| BIPOLAR         |       57 |     57 |     124 | yes      |
| BIPOLAR_SIGMOID |        8 |      8 |       0 | no       |
| COMPLEMENT      |       11 |     11 |       0 | no       |
| Cosine          |      249 |    251 |     172 | no       |
| Cube            |      266 |    263 |     260 | no       |
| ELU             |      441 |    441 |     220 | no       |
| Exponential     |       30 |     30 |      24 | no       |
| GAUSSIAN        |      163 |    164 |     156 | no       |
| GELU            |      484 |    480 |     444 | no       |
| HARD_TANH       |      365 |    361 |     280 | yes      |
| IDENTITY        |      580 |    581 |    1352 | no       |
| IF              |      321 |    322 |     712 | yes      |
| ISRU            |      175 |    178 |      76 | no       |
| LOGISTIC        |      383 |    383 |     288 | no       |
| LeakyReLU       |      447 |    446 |     116 | no       |
| LogSigmoid      |      191 |    193 |     148 | no       |
| MAXIMUM         |       22 |     21 |       4 | yes      |
| MINIMUM         |       37 |     37 |      12 | yes      |
| Mish            |      427 |    425 |     228 | no       |
| ReLU            |      217 |    217 |     412 | no       |
| ReLU6           |       70 |     71 |      92 | yes      |
| SELU            |      576 |    575 |     468 | no       |
| SINE            |      350 |    349 |     424 | no       |
| SOFTMAX         |        1 |      1 |       4 | no       |
| SOFTSIGN        |      311 |    312 |     152 | no       |
| SQRT            |       22 |     22 |      24 | no       |
| SQUARE          |       72 |     73 |     144 | no       |
| STEP            |      338 |    339 |     700 | yes      |
| Softplus        |      339 |    340 |     212 | no       |
| StdInverse      |        7 |      7 |       0 | no       |
| Swish           |      485 |    485 |     236 | no       |
| TAN             |       30 |     31 |      32 | no       |
| TANH            |      381 |    380 |     172 | no       |
