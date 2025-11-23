# Safe By Default - Discovery Library v0.212.0

## The Problem

The discovery library was crashing with SIGKILL when GPU initialization failed,
requiring users to set environment variables to work around the issue.

## The Solution

**GPU check is now DISABLED by default** - the library works out of the box on
all systems.

## Key Changes

### Before (v0.211.0 and earlier)

```typescript
// GPU check was ALWAYS attempted
isRustDiscoveryEnabled() {
  if (!isRustLibraryAvailable()) return false;
  return isRustGpuAvailable();  // ❌ Could crash here!
}

// Users had to set environment variable to avoid crash:
Deno.env.set("NEAT_RUST_DISCOVERY_SKIP_GPU_CHECK", "1");
```

### After (v0.212.0)

```typescript
// GPU check is DISABLED by default
isRustDiscoveryEnabled() {
  if (!isRustLibraryAvailable()) return false;
  
  // Only check GPU if explicitly requested
  const requireGpu = Deno.env.get("NEAT_RUST_DISCOVERY_REQUIRE_GPU");
  if (requireGpu === "1" || requireGpu === "true") {
    return isRustGpuAvailable();  // Only called if user wants it
  }
  
  return true;  // ✅ Safe by default
}

// No environment variables needed!
```

## Test Results

### ✅ Without FFI permissions:

```bash
$ deno run --allow-read --allow-env scripts/check_discovery_safe.ts
✅ Discovery library file found
ℹ️  FFI permission not granted, skipping library load test
```

### ✅ With FFI, no GPU (never crashes):

```bash
$ deno run --allow-read --allow-env --allow-ffi scripts/check_discovery_safe.ts
✅ Discovery library file found
🔌 FFI permission granted, attempting to load library...
✅ Discovery library loaded successfully
```

### ✅ Original check (also safe):

```bash
$ deno run --allow-read --allow-env --allow-ffi scripts/check_discovery.ts
✅ Original check passed (no crash)
```

## Usage

### No Configuration Needed

```typescript
// Just use it - it works!
import { Creature } from "@stsoftware/neat-ai";

const creature = new Creature(/* ... */);
// Discovery features work without any setup
```

### Optional: Enable GPU Check

Only if you explicitly need GPU verification (not recommended):

```bash
export NEAT_RUST_DISCOVERY_REQUIRE_GPU=1
```

## Comparison

| Scenario           | v0.211.0   | v0.212.0 |
| ------------------ | ---------- | -------- |
| No FFI permissions | ✅ Works   | ✅ Works |
| FFI but no GPU     | ❌ Crashes | ✅ Works |
| FFI with GPU       | ✅ Works*  | ✅ Works |
| Requires config?   | ❌ Yes     | ✅ No    |

\* Only if GPU check succeeds

## Benefits

1. **Works everywhere** - No crashes on systems without GPU
2. **No configuration** - Works out of the box
3. **Graceful degradation** - Handles all scenarios
4. **Developer friendly** - No environment variables to remember
5. **CI/CD friendly** - Works in all environments

## Philosophy

**Libraries should be safe by default.** Users shouldn't need to set flags to
prevent crashes. The GPU check is now opt-in rather than requiring an opt-out
flag to avoid crashes.

## Related Documents

- `GPU_CHECK_CRASH_FIX.md` - Technical details on the GPU crash
- `DISCOVERY_ERROR_HANDLING_IMPROVEMENTS.md` - Complete implementation guide
- `SUMMARY_v0.212.0.md` - Release notes
