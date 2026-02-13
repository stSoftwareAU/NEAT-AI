## Summary

Conducted a comprehensive audit of the NEAT-AI codebase and created 14 targeted improvement issues covering backpropagation, test coverage, and performance. Closes #1434.

### Issues Created

#### Backpropagation Improvements (addressing underperformance vs memetic evolution)
- **#1436** — Reduce generational dampening that slows training convergence
- **#1437** — Add learning rate scheduling instead of random initialisation
- **#1438** — Add telemetry for safe-zone collapse and non-finite value detection
- **#1447** — Consider hybrid training approach combining backprop and memetic steps

#### Test Coverage (addressing coverage gaps in critical systems)
- **#1439** — Add behavioural tests for core NEAT algorithm (Neat.ts, Mutator.ts)
- **#1440** — Add behavioural tests for backpropagation training pipeline
- **#1441** — Add behavioural tests for breeding and mutation operators
- **#1446** — Remove timing-based assertions from unit tests
- **#1448** — Add unit tests for activation function safe-zone implementations

#### Performance Improvements
- **#1442** — Optimise max weight/bias recalculation in Score.ts
- **#1443** — Replace recursive DFS with iterative BFS in focus cache
- **#1444** — Consolidate duplicate breeding key generation in Father.ts
- **#1445** — Selective cache invalidation by mutation type in Creature.ts
- **#1449** — Use heap-based worker assignment in WorkerPool.ts

## Evidence

This is a documentation/issue-creation task with no code changes. All improvements are tracked as separate issues for independent implementation.

### Key Findings

**Backpropagation underperformance root causes identified:**
1. Generational dampening with high `config.generations` creates aggressive weight inertia
2. Default learning rate (`random()³`) is biased towards very small values (mean ~0.05)
3. Safe-zone collapse and non-finite values silently stall training
4. Unlike memetic evolution, backprop lacks momentum and adaptive step sizing

**Test coverage analysis:**
- ~65% of source files lack direct unit test coverage
- Core algorithms (NEAT, backpropagation, breeding) have no dedicated tests
- 2 test files contain timing-based assertions that are unreliable in parallel execution
- 31 activation functions have no tests for their safe-zone implementations

**Performance opportunities:**
- Score.ts max recalculation uses O(n) fallback scans
- Focus cache uses recursive DFS instead of iterative BFS
- Father.ts has duplicate key generation code paths
- Cache invalidation is overly aggressive for local mutations

## Test Plan

No tests modified or added — this PR creates issues only. Each created issue includes specific test suggestions as part of its description.
