## Summary

The docs understated the size of the live production creature. Several spots
claimed "~500 hidden neurons", but the production genome
([GRQ-cluster/network.json](https://github.com/stSoftwareAU/GRQ-cluster/blob/main/network.json))
is far larger. This PR refreshes those statistics to match the actual deployed
creature. Closes #3018.

Measured directly from the production `network.json` (semantic version 4.0.0,
forward-only):

| Metric         | Old docs claim | Actual production value |
| -------------- | -------------- | ----------------------- |
| Hidden neurons | ~500           | 1,669 (~1,700)          |
| Synapses       | ~16,000        | 21,689 (~22,000)        |
| Inputs         | not stated     | 2,461                   |
| Outputs        | —              | 1                       |
| Total neurons  | —              | 1,673                   |

Files updated:

- `COMPARISON.md` — scalability row now reads "~1,700 hidden neurons in prod".
- `docs/comparison/PROS_AND_CONS.md` — the "limited scalability" con now states
  the real figures (~1,700 hidden neurons, 2,461 inputs, ~22,000 synapses) with
  a link to the source genome, rather than "max out around 500 hidden neurons
  and 16,000 synapses".
- `docs/PERFORMANCE_TUNING.md` — production-scale synthetic-synapse note updated
  from "~1,000 neurons" to "~1,700 neurons".

Numbers are rounded for readability; historical benchmark/results snapshots
under `bench/results/` and `docs/*-results.md` record specific past runs and
were left unchanged.

## Evidence

This is a documentation-only change (no TypeScript modified), so there is no UI
to screenshot and no runtime behaviour to benchmark. Verification:

- Production statistics derived by parsing the live `network.json` fetched from
  `stSoftwareAU/GRQ-cluster`:
  `input: 2461, output: 1, neurons: 1673 (1669 hidden, 3 constant, 1 output), synapses: 21689`.
- `./quality.sh --lint-only` passes cleanly (formatting, linting, bash check).
- `markdownlint-cli2` reports 0 errors.

## Test Plan

No unit tests apply — only prose statistics in Markdown changed, and the project
guidelines forbid tests that grep source/doc text for patterns. Validation was
done via the documentation quality gate:

- `./quality.sh --lint-only` — passed.
- `deno fmt` on the changed files — no formatting changes needed after edit.
- `markdownlint-cli2` — 0 errors.
