## Summary

Add orphaned discovery temporary directory cleanup to prevent disk space
accumulation from crashed or killed discovery processes. Closes #1702.

When a discovery process crashes or is killed unexpectedly, its temporary
directory (`.discovery/{creature-uuid}/`) may be left behind. This PR adds:

- **Lock file mechanism**: Each discovery temp directory now contains a
  `.discovery.lock` file recording the owning process PID and start time.
  This allows cleanup logic to distinguish between active and orphaned
  directories.

- **Automatic startup cleanup**: On each discovery initialisation, the base
  directory is scanned for orphaned directories older than 24 hours (default
  configurable threshold) and they are removed.

- **Manual cleanup utility**: `forceCleanAllDiscoveryDirs()` removes all
  subdirectories regardless of lock files or age, useful for emergency disk
  space recovery.

- **Public API exports**: Both `cleanOrphanedDiscoveryDirs` and
  `forceCleanAllDiscoveryDirs` are exported from `mod.ts` for external use.

## Evidence

This is a backend/infrastructure change with no visual output. All
functionality is verified through unit tests. The full quality gate
(4540 tests) passes cleanly.

## Test Plan

Added 17 new tests in `test/discovery/DiscoveryCleanup.ts`:

- Lock file creation writes PID and timestamp
- Lock file removal works correctly
- Lock file removal is safe when file is missing
- Orphan detection: no lock file = orphaned
- Orphan detection: current PID lock = active (not orphaned)
- Orphan detection: dead PID lock = orphaned
- Orphan detection: malformed lock file = orphaned
- Cleanup removes old orphaned directories
- Cleanup preserves directories with active lock files
- Cleanup uses default 24-hour threshold
- Cleanup handles non-existent base directory gracefully
- Cleanup skips non-directory entries
- Force cleanup removes all subdirectories
- Force cleanup handles non-existent directory
- Force cleanup throws on empty path
- Custom age threshold is respected
- Very high threshold removes nothing
