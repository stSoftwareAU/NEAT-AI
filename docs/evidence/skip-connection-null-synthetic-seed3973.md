## Skip-connection null comparison (Issue #3973)

- Creature: synthetic tuned parent (8 wide, 12-member tail)
- Longest serial run: 13 members, entry at depth 2
- Seed 3973, 64 probe samples, up to 3 synapses per arm (the null arm matched to what the skip arm added), weight scale 0.01, observation scale 3, 300 training epochs

| Arm | Added | Entry zero-gradient | Chain zero-gradient | Upstream zero-gradient | Error before → after | Added \|w\| birth → trained |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 0 | 0.0% | 0.0% | 0.0% | 0.006884 → 0.004741 | — |
| skip | 1 | 0.0% | 0.0% | 0.0% | 0.006843 → 0.003478 | 0.002037 → 0.007213 |
| random | 1 | 0.0% | 0.0% | 0.0% | 0.006919 → 0.00478 | 0.004465 → 0.004147 |

- **skip** added: 12->24
- **random** added: 0->18
