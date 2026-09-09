## Skip-connection null comparison (Issue #3973)

- Creature: synthetic tuned parent (8 wide, 12-member tail)
- Longest serial run: 13 members, entry at depth 2
- Seed 17, 64 probe samples, up to 3 synapses per arm (the null arm matched to
  what the skip arm added), weight scale 0.01, observation scale 3

| Arm      | Added | Entry zero-gradient | Chain zero-gradient | Upstream zero-gradient | Error before → after | Added \|w\| birth → trained |
| -------- | ----: | ------------------: | ------------------: | ---------------------: | -------------------: | --------------------------: |
| baseline |     0 |                0.0% |                0.0% |                   0.0% |  0.112765 → 0.094651 |                           — |
| skip     |     1 |                0.0% |                0.0% |                   0.0% |   0.112623 → 0.01735 |         0.003564 → 0.080191 |
| random   |     1 |                0.0% |                0.0% |                   0.0% |  0.112762 → 0.093891 |         0.001024 → 0.004027 |

- **skip** added: 12->24
- **random** added: 17->21
