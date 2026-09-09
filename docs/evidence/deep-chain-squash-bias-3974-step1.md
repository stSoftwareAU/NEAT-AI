# Step 1 — what `SquashEffectivenessTracker` can see of the deep run (Issue #3974)

- Creature: `test/data/grq-23-forests-constants.json`
- Roles are the tracker's own `layer bucket × fan-in bucket`, computed with
  `SquashEffectivenessTracker.computeRole`.

| Role                  | Mutable neurons | In the run | Run share |
| --------------------- | --------------: | ---------: | --------: |
| mid\|medium           |             599 |          5 |      0.8% |
| mid\|low              |             368 |         12 |      3.3% |
| mid\|high             |             262 |          9 |      3.4% |
| output-adjacent\|low  |               1 |          1 |    100.0% |
| output-adjacent\|high |               1 |          1 |    100.0% |
