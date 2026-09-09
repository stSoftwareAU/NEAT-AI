## Skip-connection null comparison (Issue #3973)

- Creature: synthetic tuned parent (8 wide, 12-member tail)
- Longest serial run: 13 members, entry at depth 2
- Seed 3973, 64 probe samples, up to 3 synapses per arm (the null arm matched to
  what the skip arm added), weight scale 0.01, observation scale 3

| Arm      | Added | Entry zero-gradient | Chain zero-gradient | Upstream zero-gradient | Error before → after | Added \|w\| birth → trained |
| -------- | ----: | ------------------: | ------------------: | ---------------------: | -------------------: | --------------------------: |
| baseline |     0 |                0.0% |                0.0% |                   0.0% |   0.03173 → 0.005735 |                           — |
| skip     |     1 |                0.0% |                0.0% |                   0.0% |  0.031633 → 0.016451 |         0.002037 → 0.015053 |
| random   |     1 |                0.0% |                0.0% |                   0.0% |   0.03181 → 0.018579 |         0.004465 → 0.003831 |

- **skip** added: 12->24
- **random** added: 0->18
