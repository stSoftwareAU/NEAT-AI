## Summary

Add disk space monitoring and warnings for the discovery process. Before starting
discovery recording, the system now checks available disk space against configurable
thresholds and either warns (warning threshold) or aborts gracefully (critical threshold)
instead of failing with opaque I/O errors when disk fills up. Disk usage of discovery
directories is logged at key milestones (start, after recording, before cleanup).

Closes #1703.

## Changes

- **`src/config/DiskSpaceConfig.ts`** — New config type with `minFreeDiskMB` (default 500),
  `criticalFreeDiskMB` (default 100), and `enabled` (default true) fields
- **`src/discovery/DiskSpaceMonitor.ts`** — Cross-platform disk space utilities:
  `getAvailableDiskSpaceMB()` (uses POSIX `df`), `checkDiskSpace()`, `preFlightDiskSpaceCheck()`,
  `estimateRequiredDiskSpaceMB()`, `measureDirectorySize()`, `logDiscoveryDiskUsage()`
- **Config wiring** — Added `discoveryDiskSpace` to `NeatArguments`, `NeatOptions`,
  `NeatOptionsInput`, `NeatConfig`, `NeatConfigParsers`, and `NeatConfigValidation`
  (cross-field validation: critical <= warning threshold)
- **`src/discovery/DiscoveryRunner.ts`** — Pre-flight disk space check before discovery starts;
  throws `DiscoveryError` with `DISK_SPACE_CRITICAL` reason when space is critically low
- **`src/architecture/.../DiscoverStructureBase.ts`** — Disk usage logging at discovery start
  and before cleanup
- **`src/architecture/.../DiscoverStructureRecording.ts`** — Runtime disk space check before
  each chunk flush; disk usage logging after recording phase
- **`src/errors/DiscoveryError.ts`** — Added `DISK_SPACE_CRITICAL` error reason
- **`mod.ts`** — Public exports for all new types and functions

## Evidence

This is a backend/CLI enhancement with no web interface. Evidence is provided by the
test output showing disk space monitoring working correctly:

- 28 new tests covering all disk space monitoring functions and config behaviour
- Integration visible in existing discovery tests via log output:
  `[DiskSpace] Discovery directory usage at before cleanup: 0.05 MB across 3 files`
- All 4568 tests pass with `./quality.sh --skip-discovery --skip-wasm`

## Test Plan

- `test/discovery/DiskSpaceMonitor.ts` — 18 tests:
  - `getAvailableDiskSpaceMB` returns positive values and handles non-existent paths
  - `checkDiskSpace` passes/fails based on thresholds
  - `estimateRequiredDiskSpaceMB` calculates correctly with default and custom multipliers
  - `measureDirectorySize` measures files, recurses subdirectories, handles missing dirs
  - `preFlightDiskSpaceCheck` honours warning/critical thresholds
  - `logDiscoveryDiskUsage` handles both existing and non-existent directories
- `test/config/DiskSpaceConfig.ts` — 10 tests:
  - Default values applied correctly
  - Custom overrides and CLI string coercion work
  - Cross-field validation rejects `criticalFreeDiskMB > minFreeDiskMB`
  - Parser applies defaults and merges partial overrides
  - Disabling monitoring via `enabled: false`
