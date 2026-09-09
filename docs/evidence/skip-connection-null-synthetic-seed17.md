## Skip-connection null comparison (Issue #3973)

- Creature: synthetic tuned parent (8 wide, 12-member tail)
- Longest serial run: 13 members, entry at depth 2
- Seed 17, 64 probe samples, up to 3 synapses per arm (the null arm matched to
  what the skip arm added), weight scale 0.01, observation scale 3, 300 training
  epochs

| Arm      | Added | Entry zero-gradient | Chain zero-gradient | Upstream zero-gradient | Error before → after | Added \|w\| birth → trained |
| -------- | ----: | ------------------: | ------------------: | ---------------------: | -------------------: | --------------------------: |
| baseline |     0 |                0.0% |                0.0% |                   0.0% |  0.034557 → 0.021469 |                           — |
| skip     |     1 |                0.0% |                0.0% |                   0.0% |  0.034346 → 0.019734 |         0.003564 → 0.020314 |
| random   |     1 |                0.0% |                0.0% |                   0.0% |   0.03455 → 0.018296 |         0.001024 → 0.004858 |

- **skip** added: 12->24
- **random** added: 17->21
