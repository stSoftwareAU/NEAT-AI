# 🔬 Discovery API

Programmatic entry points for error-pattern-driven structural growth via the
NEAT-AI-Discovery FFI (Foreign Function Interface) extension.

> **Acronyms:** API (Application Programming Interface), FFI (Foreign Function
> Interface), GPU (Graphics Processing Unit), MB (Megabyte), JSON (JavaScript
> Object Notation).

Discovery uses the Rust FFI extension
([NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)) for
GPU-accelerated structural analysis. It analyses error patterns and suggests
neurons/synapses to add.

## 📦 Exports documented here

- `formatErrorDelta`, `formatPercentWithSignificantDigits`
- `DiscoveryEvaluationSummary`
- `cleanOrphanedDiscoveryDirs`, `forceCleanAllDiscoveryDirs`
- `checkDiskSpace`, `estimateRequiredDiskSpaceMB`, `getAvailableDiskSpaceMB`,
  `logDiscoveryDiskUsage`, `measureDirectorySize`, `preFlightDiskSpaceCheck`
- `DirectorySizeResult`, `DiskSpaceCheckResult`
- `DiskSpaceConfig`, `RequiredDiskSpaceConfig`, `DEFAULT_DISK_SPACE_CONFIG`

```typescript
import {
  cleanOrphanedDiscoveryDirs,
  formatErrorDelta,
  formatPercentWithSignificantDigits,
  preFlightDiskSpaceCheck,
} from "@stsoftware/neat-ai";
import type { DiscoveryEvaluationSummary } from "@stsoftware/neat-ai";
```

## 🔍 How discovery works

1. The creature records expected vs actual outputs during evaluation.
2. Error data is streamed to the Rust discovery library via FFI.
3. The Rust module (using GPU compute shaders via Metal/wgpu) analyses error
   patterns and proposes structural changes.
4. Proposed candidates are evaluated and the best improvement is kept.

## ⚙️ Configuration

Discovery is configured via `NeatOptions` fields (full definitions in the
[Configuration reference](CONFIGURATION.md#-discovery-fields)):

> [!NOTE]
> The Discovery API requires the optional
> [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) Rust
> FFI extension. Without it, the discovery phase is skipped gracefully and
> evolution continues normally.

- `discoverySampleRate` (default `0.2`) — fraction of training data used.
- `discoveryRecordTimeOutMinutes` (default `5`) — recording phase timeout.
- `discoveryAnalysisTimeoutMinutes` (default `10`) — analysis phase timeout.
- `discoveryBatchSize` (default `128`) — samples per batch.
- `discoveryMaxNeurons` (default `6`) — max neurons per iteration.

## 📊 DiscoveryEvaluationSummary

```typescript
interface DiscoveryEvaluationSummary {
  kind: "original" | "candidate";
  changeType?: string;
  description?: string;
  score: number;
  error: number;
  scoreDelta?: number;
  improved: boolean;
  archivePath?: string;
  errorDelta?: number;
  errorDeltaPct?: number;
}
```

## 🛠️ Formatting utilities

```typescript
// Format an error delta for display
const text = formatErrorDelta(0.0523);

// Format a percentage with significant digits
const pct = formatPercentWithSignificantDigits(0.0523);
```

These utilities format discovery evaluation summaries consistently. Use them
when logging evaluation results yourself after disabling the library's internal
logging with `discoveryDisableEvaluationSummaryLogging: true`.

## 🧹 Discovery cleanup

Issue #1702: Detect and clean up orphaned discovery temp directories left behind
by crashed or killed processes.

```typescript
import {
  cleanOrphanedDiscoveryDirs,
  forceCleanAllDiscoveryDirs,
} from "@stsoftware/neat-ai";

// Conservative: remove only directories whose pid is no longer alive.
await cleanOrphanedDiscoveryDirs();

// Aggressive: remove every discovery temp directory regardless of pid.
await forceCleanAllDiscoveryDirs();
```

## 💽 Disk space monitoring

Issue #1703: Pre-flight and in-flight disk-space checks during discovery.

```typescript
import {
  checkDiskSpace,
  estimateRequiredDiskSpaceMB,
  getAvailableDiskSpaceMB,
  logDiscoveryDiskUsage,
  measureDirectorySize,
  preFlightDiskSpaceCheck,
} from "@stsoftware/neat-ai";

import type {
  DirectorySizeResult,
  DiskSpaceCheckResult,
  DiskSpaceConfig,
  RequiredDiskSpaceConfig,
} from "@stsoftware/neat-ai";

import { DEFAULT_DISK_SPACE_CONFIG } from "@stsoftware/neat-ai";
```

| Function                               | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `checkDiskSpace(dir, config)`          | Returns `DiskSpaceCheckResult` with available/required MB and flags. |
| `estimateRequiredDiskSpaceMB(opts)`    | Estimate required space for a discovery run before it starts.        |
| `getAvailableDiskSpaceMB(dir)`         | Plain query for free space on the filesystem hosting `dir`.          |
| `logDiscoveryDiskUsage(dir, logger)`   | Logs current discovery directory usage at the configured log level.  |
| `measureDirectorySize(dir)`            | Recursive size measurement, returns `DirectorySizeResult`.           |
| `preFlightDiskSpaceCheck(dir, config)` | Runs the gate that aborts evolution when free space is insufficient. |

`DiskSpaceConfig` controls warning and critical thresholds; defaults are exposed
as `DEFAULT_DISK_SPACE_CONFIG`.

For a full guide, see [`docs/DISCOVERY_GUIDE.md`](../DISCOVERY_GUIDE.md) and
[`docs/GPU_ACCELERATION.md`](../GPU_ACCELERATION.md).

---

## 🔗 Related topics

- [Configuration reference](CONFIGURATION.md) — discovery fields and `diskSpace`
  sub-config.
- [Compute / multithreading](COMPUTE.md) — WASM (WebAssembly) cache controls
  referenced when discovery proposes new topology.
- [Errors](ERRORS.md) — discovery operations may surface `BreedExhaustionError`.
- [`docs/DISCOVERY_GUIDE.md`](../DISCOVERY_GUIDE.md) — operator workflow.
- [`docs/DISCOVERY_DIR.md`](../DISCOVERY_DIR.md) — `Creature.discoveryDir()`
  contract and on-disk layout.
- [`docs/DISCOVERY_ARCHITECTURE.md`](../DISCOVERY_ARCHITECTURE.md) — internals.
