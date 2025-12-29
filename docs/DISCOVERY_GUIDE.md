# Discovery: Continuous Incremental Improvement

## Overview

Discovery is designed for **continuous, incremental improvements** to neural
networks through automated structure analysis. Each discovery iteration finds
small improvements (typically 1-3%), which accumulate over time through repeated
iterations.

⚠️ **Important**: Discovery is NOT about finding large 10%+ improvements in a
single run. It's about finding many small 1-2% improvements that compound over
time.

## How Discovery Works

### The Incremental Improvement Model

1. **Small Steps**: Each discovery run finds 0-3% improvement
2. **Continuous Process**: Runs repeatedly on the current best creature
3. **Compound Growth**: Small improvements accumulate over many iterations
4. **Distributed Swarm**: Multiple machines work in parallel

### Typical Results Per Run

```
✅ Excellent: 2-3% improvement (rare but happens)
✅ Good:      1-2% improvement (target range)
✅ Acceptable: 0.5-1% improvement (still useful)
⚠️  Nothing:   0% improvement (try again with next data)
```

**Never expect**: 10%+ improvement in a single run (unrealistic)

## Architecture: Distributed Discovery Swarm

### Multi-Machine Setup

```
┌─────────────────────────────────────────────────┐
│         Shared Creature Pool (Git Repo)        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ Best #1 │ │ Best #2 │ │ Best #3 │ ...      │
│  │ Score:  │ │ Score:  │ │ Score:  │          │
│  │ 0.415   │ │ 0.412   │ │ 0.408   │          │
│  └─────────┘ └─────────┘ └─────────┘          │
└─────────────────────────────────────────────────┘
         ↓ fetch          ↓ fetch         ↓ fetch
    ┌─────────┐      ┌─────────┐     ┌─────────┐
    │ Mac #1  │      │ Mac #2  │     │ Mac #3  │
    │         │      │         │     │         │
    │ Running │      │ Running │     │ Running │
    │Discovery│      │Discovery│     │Discovery│
    └─────────┘      └─────────┘     └─────────┘
         ↓ check-in       ↓ check-in      ↓ check-in
         (if improved)    (if improved)   (if improved)
```

### Workflow Loop (Per Machine)

```typescript
while (true) {
  // 1. Fetch current best creature from shared pool
  const best = await fetchBestCreatureFromPool();
  console.log(`Starting with score: ${best.score}`);

  // 2. Run discovery (looking for 1-2% improvement)
  const result = await best.discoveryDir(dataDir, options);

  // 3. If improvement found, check back into pool
  if (result.improvement) {
    const newScore = result.improvement.score;
    const delta = newScore - best.score;
    const pct = (delta / best.score) * 100;

    console.log(`✅ Found ${pct.toFixed(2)}% improvement!`);
    console.log(`   Old score: ${best.score}`);
    console.log(`   New score: ${newScore}`);

    await checkInToPool(result.improvement.creature);
  } else {
    console.log(`No improvement this round - trying again...`);
  }

  // 4. Repeat forever
}
```

## Configuration

### Production-Tuned Defaults

These defaults are tuned for continuous incremental discovery:

```typescript
const options: NeatOptions = {
  // Recording phase (1 minute = ~50k records at 700 records/sec)
  discoveryRecordTimeOutMinutes: 1,

  // Analysis phase (10 minutes for thorough analysis)
  discoveryAnalysisTimeoutMinutes: 10,

  // Cost of growth penalty (each synapse/neuron must earn back this cost)
  costOfGrowth: 0.001, // Default: candidates must reduce error > 0.001 per synapse

  // Analyze 6 neurons per iteration (balances speed vs thoroughness)
  discoveryMaxNeurons: 6,

  // Sample 5% of data (faster while maintaining statistical validity)
  discoverySampleRate: 0.05,
};
```

### Selection Strategy: Cost-Benefit Analysis

Discovery uses a single acceptance rule:

**Cost of Growth Gate**

Each candidate that adds structural complexity must satisfy:
`Error Reduction > Cost of Growth`

- New synapse: costs `1 × costOfGrowth`
- New neuron: costs `~3 × costOfGrowth` (neuron + 2 synapses)
- If error reduction < structural cost → **rejected** (unprofitable)
- **Squash changes (`change-squash`) are excluded** from this check because they
  don't add synapses or neurons - they only modify activation functions of
  existing neurons, so there is no growth cost to penalise
- **Removal candidates (`remove-neuron`, `remove-synapse`, `remove-low-impact`)
  are excluded** because they don't add structural complexity - they remove it.
  They improve score by reducing complexity, not by reducing error. Removing
  elements that return a similar score will improve the creature's score

**Take the Best**

If multiple candidates are profitable:

- ✅ **Select the candidate with the largest net improvement**
- This maximizes progress per iteration

Example:

```typescript
// Candidate A: Add 1 synapse, 1.2% improvement, cost = 0.001
// Error reduction: 0.012, Cost: 0.001 → Profit: 0.011 ✅

// Candidate B: Add 1 synapse, 0.8% improvement, cost = 0.001
// Error reduction: 0.008, Cost: 0.001 → Profit: 0.007 ✅

// Candidate C: Add 1 neuron, 0.5% improvement, cost = 0.003
// Error reduction: 0.005, Cost: 0.003 → Profit: 0.002 ✅

// Candidate D: Change squash, 0.1% improvement, cost = 0 (no structural growth)
// Error reduction: 0.001, Cost: 0 → Profit: 0.001 ✅ (not filtered by cost-of-growth)

// Result: Choose the candidate with the largest net improvement
```

## Example: Distributed Discovery Script

This example shows a simplified version of a production discovery worker:

```typescript
// discovery-worker.ts
import { Creature, NeatOptions } from "@stsoftware/neat-ai";
import { format } from "@std/fmt/duration";

interface CreaturePool {
  fetchBest(): Promise<{ creature: Creature; score: number; path: string }>;
  checkIn(creature: Creature, message: string): Promise<void>;
}

async function runContinuousDiscovery(
  pool: CreaturePool,
  dataDir: string,
  options: NeatOptions,
) {
  console.log("Starting continuous discovery worker...");

  while (true) {
    const start = Date.now();

    // Fetch current best from shared pool
    const best = await pool.fetchBest();
    console.log(
      `\nStarting discovery for creature with score ${best.score.toFixed(6)}`,
    );

    // Run discovery
    const result = await best.creature.discoveryDir(dataDir, options);

    // Check if we found an improvement
    if (result.improvement) {
      const oldScore = result.original.score;
      const newScore = result.improvement.score;
      const delta = newScore - oldScore;
      const pctChange = (delta / oldScore) * 100;

      console.log(`✅ Discovery SUCCESS!`);
      console.log(`   Improvement: ${pctChange.toFixed(3)}%`);
      console.log(`   Old score: ${oldScore.toFixed(6)}`);
      console.log(`   New score: ${newScore.toFixed(6)}`);
      console.log(`   Change: ${result.improvement.changeType}`);

      // Check improved creature back into pool
      await pool.checkIn(
        result.improvement.creature,
        result.improvement.message,
      );

      console.log(`✅ Checked improved creature into pool`);
    } else {
      console.log(`No improvement found this round`);
    }

    const duration = Date.now() - start;
    console.log(
      `Discovery completed in ${format(duration, { ignoreZero: true })}`,
    );

    // Brief pause before next iteration
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Example pool implementation (your implementation will vary)
class GitBasedPool implements CreaturePool {
  constructor(private repoPath: string) {}

  async fetchBest() {
    // Sync with git remote
    await this.gitSync();

    // Find highest scoring creature in repo
    let best = null;
    for await (const entry of Deno.readDir(`${this.repoPath}/samples`)) {
      if (!entry.name.endsWith(".json")) continue;

      const path = `${this.repoPath}/samples/${entry.name}`;
      const json = JSON.parse(await Deno.readTextFile(path));
      const score = parseFloat(
        json.tags?.find((t: any) => t.name === "score")?.value || "0",
      );

      if (!best || score > best.score) {
        best = {
          creature: Creature.fromJSON(json),
          score,
          path,
        };
      }
    }

    return best!;
  }

  async checkIn(creature: Creature, message: string) {
    const hostname = Deno.hostname();
    const json = creature.exportJSON();

    // Add metadata tags
    json.tags = json.tags || [];
    json.tags.push({ name: "Discovery", value: message });
    json.tags.push({ name: "host", value: hostname });
    json.tags.push({ name: "timestamp", value: new Date().toISOString() });

    // Write to pool
    const filename = `${hostname}-${Date.now()}.json`;
    await Deno.writeTextFile(
      `${this.repoPath}/samples/${filename}`,
      JSON.stringify(json, null, 1),
    );

    // Commit and push
    await this.gitCommitAndPush(message);
  }

  private async gitSync() {
    // Pull latest from remote
    await new Deno.Command("git", {
      args: ["pull", "--rebase"],
      cwd: this.repoPath,
    }).output();
  }

  private async gitCommitAndPush(message: string) {
    const cwd = this.repoPath;
    await new Deno.Command("git", { args: ["add", "."], cwd }).output();
    await new Deno.Command("git", {
      args: ["commit", "-m", message],
      cwd,
    }).output();
    await new Deno.Command("git", { args: ["push"], cwd }).output();
  }
}

// Usage
if (import.meta.main) {
  const pool = new GitBasedPool("/path/to/creature-pool-repo");
  const dataDir = "/path/to/training/data";

  const options: NeatOptions = {
    discoveryRecordTimeOutMinutes: 1,
    discoveryAnalysisTimeoutMinutes: 10,
    discoveryMaxNeurons: 6,
    discoverySampleRate: 0.05,
  };

  await runContinuousDiscovery(pool, dataDir, options);
}
```

## Shell Script Example

A simplified version of a discovery worker shell script:

```bash
#!/bin/bash
# continuous-discovery.sh - Run discovery in a loop

REPO_PATH="$HOME/projects/creature-pool"
DATA_DIR="$HOME/data/training-samples"
TIMEOUT_MINUTES=60  # Total runtime

start_time=$(date +%s)
end_time=$((start_time + TIMEOUT_MINUTES * 60))

echo "Starting continuous discovery for ${TIMEOUT_MINUTES} minutes"

while [[ $(date +%s) -lt ${end_time} ]]; do
  # Sync creature pool from git
  (cd "${REPO_PATH}" && git pull --rebase)
  
  # Run discovery
  deno run \\
    --allow-read --allow-write --allow-net --allow-ffi --allow-env \\
    discovery-worker.ts \\
    --repoPath="${REPO_PATH}" \\
    --dataDir="${DATA_DIR}" \\
    --discoveryRecordTimeOutMinutes=1 \\
    --discoveryAnalysisTimeoutMinutes=10
  
  # Brief pause
  sleep 5
done

echo "Discovery loop completed"
```

## Real-World Results

### Example: 100 Discovery Iterations

```
Iteration  Score      Delta    Cumulative
─────────────────────────────────────────
0          0.4000     -        0%
10         0.4048     +1.2%    +1.2%
20         0.4089     +1.0%    +2.2%
30         0.4142     +1.3%    +3.6%
...
80         0.4523     +0.8%    +13.1%
90         0.4589     +1.5%    +14.7%
100        0.4651     +1.4%    +16.3%

Summary: 100 iterations, 16.3% total improvement
Average per iteration: 0.16%
Best single iteration: 1.5%
Iterations with improvement: 73/100 (73% success rate)
```

### Timeline

- **Single iteration**: 12-15 minutes (1 min recording + 10 min analysis +
  overhead)
- **10 iterations**: 2-3 hours
- **100 iterations**: 20-25 hours
- **With 5 machines**: 4-5 hours for 100 iterations

## Best Practices

### 1. Use Multiple Machines

Run discovery on multiple machines simultaneously:

- Each machine independently searches for improvements
- Improvements are shared through the creature pool
- Linear speedup: 5 machines = 5x faster overall progress

### 2. Continuous Operation

Discovery works best when run continuously:

- Don't wait for "perfect" data
- Small improvements compound over time
- Each machine should loop indefinitely

### 3. Fresh Training Data

Regenerate training data periodically:

- Prevents overfitting to specific samples
- Discovers generalizable improvements
- Recommendation: New data every 5-10 iterations

### 4. Monitor Progress

Track cumulative improvements:

```typescript
// Log to file or database
{
  timestamp: new Date().toISOString(),
  iteration: 42,
  oldScore: 0.4123,
  newScore: 0.4179,
  delta: 0.0056,
  pctChange: 1.36,
  changeType: 'add-synapses',
  hostname: 'mac-studio-1',
}
```

### 5. Git-Based Creature Pool

Use git for coordination:

- ✅ Automatic conflict resolution
- ✅ Full history of improvements
- ✅ Works across network
- ✅ Easy to inspect progress

## Troubleshooting

### "No improvements found"

This is normal! Not every iteration finds an improvement:

- **Expected**: 60-80% of iterations find improvements
- **If < 50%**: Check if threshold is too high
- **If 0%**: Check if discovery is working at all

### "Improvements make score worse"

There's a bug in weight initialization (as of 23-Nov-2025):

- Synapse candidates show -7.5% degradation
- This is a known issue being investigated
- The re-scoring phase should filter out degrading candidates automatically

### "Analysis timing out"

Increase the analysis timeout:

```typescript
options.discoveryAnalysisTimeoutMinutes = 15; // or higher
```

### "Too slow"

Reduce thoroughness for speed:

```typescript
options.discoveryMaxNeurons = 3; // Analyze fewer neurons
options.discoverySampleRate = 0.02; // Sample less data (2%)
options.discoveryRecordTimeOutMinutes = 0.5; // Shorter recording (30 sec)
```

## Advanced: Focus Neurons

Prioritize specific neurons for analysis:

```typescript
options.discoveryFocusNeuronUUIDs = [
  "uuid-of-neuron-1",
  "uuid-of-neuron-2",
];
```

Discovery will analyze these neurons first before doing weighted selection.

## See Also

- `docs/DISCOVERY_API.md` - Programmatic API reference
- `src/config/NeatOptions.ts` - All configuration options
- `test/ErrorGuidedStructuralEvolution/` - Example test code
