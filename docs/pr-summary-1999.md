## Summary

Created issues in NEAT-AI-Discovery for each ignored discovery scenario test, and updated the test files to reference the correct new issue numbers. Closes #1999.

The 6 ignored discovery scenario tests previously referenced stale or incorrect NEAT-AI-Discovery issue numbers (#5, #6, #907, #908) — some were about unrelated features (README, GPU support) and others were already closed. New, dedicated issues have been created in NEAT-AI-Discovery to track end-to-end verification of each scenario:

| Scenario | Test File | New Issue |
|----------|-----------|-----------|
| Add synapse between hidden neurons | `DiscoveryScenarioAddSynapseBetweenHidden.ts` | stSoftwareAU/NEAT-AI-Discovery#925 |
| Add neuron between hidden neurons | `DiscoveryScenarioAddNeuronBetweenHidden.ts` | stSoftwareAU/NEAT-AI-Discovery#926 |
| Remove harmful synapse | `DiscoveryScenarioRemoveHarmfulSynapse.ts` | stSoftwareAU/NEAT-AI-Discovery#927 |
| Fan-in synapse patterns | `DiscoveryScenarioFanInSynapsePatterns.ts` | stSoftwareAU/NEAT-AI-Discovery#928 |
| Coordinated structural changes | `DiscoveryScenarioCoordinatedStructural.ts` | stSoftwareAU/NEAT-AI-Discovery#929 |
| Change squash function | `DiscoveryScenarioChangeSquash.ts` | stSoftwareAU/NEAT-AI-Discovery#930 |

Once each Discovery issue is implemented, the corresponding ignored test in NEAT-AI should be enabled (remove `ignore: true`) and verified to pass end-to-end.

## Evidence

- All 6 issues created in stSoftwareAU/NEAT-AI-Discovery with detailed scenario descriptions, expected discovery results, and acceptance criteria
- Test file `discoverySkipReason()` calls updated to reference the correct new issue numbers
- Quality checks pass: 4967 passed, 0 failed, 6 ignored

## Test Plan

- No new tests added — this change updates issue references in existing ignored tests
- Verified all existing tests continue to pass via `./quality.sh`
- The 6 ignored tests will be enabled as each corresponding NEAT-AI-Discovery issue is completed
