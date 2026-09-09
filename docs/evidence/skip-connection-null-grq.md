## Skip-connection null comparison (Issue #3973)

- Creature: test/data/grq-23-forests-constants.json
- Longest serial run: 28 members, entry at depth 34
- Seed 3973, 64 probe samples, up to 4 synapses per arm (the null arm matched to what the skip arm added), weight scale 0.01, observation scale 1, profile only (no training arm)

| Arm | Added | Entry zero-gradient | Chain zero-gradient | Upstream zero-gradient | Error before → after | Added \|w\| birth → trained |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 0 | 100.0% | 85.0% | 89.4% | — | — |
| skip | 1 | 40.6% | 82.8% | 89.4% | — | — |
| random | 1 | 100.0% | 85.0% | 89.4% | — | — |

- **skip** added: 4395->5048
- **random** added: 26->4379
