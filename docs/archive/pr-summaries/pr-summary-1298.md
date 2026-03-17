## Summary

Implements adaptive discovery timeout based on creature complexity (#1298).

Previously, the discovery recording phase used a fixed timeout (or the remaining
training time), regardless of how simple or complex the creature was. Simple
creatures with few neurons and synapses had to wait the full duration before a
stuck discovery was detected, wasting resources.

This change introduces `calculateDiscoveryTimeout()` which computes a
complexity-aware timeout that scales logarithmically with the creature's neuron
and synapse counts:

- **Simple creatures** (few neurons/synapses) get shorter timeouts (~30
  seconds), enabling faster stuck-discovery recovery.
- **Complex creatures** (many neurons/synapses) are allowed longer timeouts (up
  to 10 minutes) so they have enough time to complete.

The adaptive timeout is applied as a ceiling in `scheduleDiscovery()` — the
effective timeout is `min(remainingTrainingTime, adaptiveTimeout)`.

### Files Changed

- **New: `src/discovery/DiscoveryTimeout.ts`** — Pure function
  `calculateDiscoveryTimeout()` with configurable bounds and logarithmic scaling
- **Modified: `src/NEAT/Neat.ts`** — Integrated adaptive timeout in
  `scheduleDiscovery()` to cap the recording-phase timeout based on creature
  complexity
- **New: `test/discovery/DiscoveryTimeout.ts`** — 10 unit tests covering minimum
  bounds, maximum bounds, logarithmic scaling, custom bounds, edge cases
- **New: `bench/AdaptiveDiscoveryTimeout.ts`** — Benchmark confirming negligible
  overhead (~4ns per calculation)

## Evidence

This is a performance change (no UI). Benchmark results on Apple M4 Pro:

```
| benchmark                                      | time/iter (avg) |        iter/s |
| ---------------------------------------------- | --------------- | ------------- |
| minimal creature (3 neurons, 2 synapses)       |          4.1 ns |   242,500,000 |
| small creature (10 neurons, 20 synapses)       |          4.0 ns |   251,800,000 |
| medium creature (100 neurons, 500 synapses)    |          4.2 ns |   239,900,000 |
| large creature (1000 neurons, 10000 synapses)  |          4.1 ns |   243,600,000 |
| very large creature (10000 neurons, 100000 sy) |          4.1 ns |   244,200,000 |
```

The adaptive timeout calculation adds ~4 nanoseconds of overhead per discovery
scheduling — effectively zero cost. The real performance benefit comes from
faster stuck-discovery recovery for simple creatures (30-second timeout instead
of minutes).

## Test Plan

- `test/discovery/DiscoveryTimeout.ts` — 10 new tests:
  - Minimal creature returns near-minimum timeout
  - Complex creature returns higher timeout
  - Very complex creature capped at maximum
  - Zero neurons/synapses returns minimum
  - Logarithmic scaling verified (diminishing returns)
  - Custom bounds respected
  - More synapses increases timeout
  - More neurons increases timeout
  - Default bounds are sensible
  - Negative inputs treated as zero
- All 2183 existing tests continue to pass
