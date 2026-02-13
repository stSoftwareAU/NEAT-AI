# Troubleshooting Guide

This guide covers common issues encountered when using or contributing to
NEAT-AI. Each section describes the symptoms, likely causes, and solutions.

## Table of Contents

- [WASM Issues](#wasm-issues)
- [Discovery Library](#discovery-library)
- [Memory Management](#memory-management)
- [CI Failures](#ci-failures)
- [Configuration](#configuration)

---

## WASM Issues

WASM activation is **mandatory** in NEAT-AI. There is no JavaScript fallback.
The library initialises the WASM backend automatically; callers do not need to
call any init function or set environment variables.

### WASM module not found or failed to compile

**Symptoms:**

- `WASM activation: pkg not found at the canonical package location.`
- `WASM activation could not be loaded. Ensure the NEAT-AI package is installed
  correctly. WASM activation is required.`

**Causes:**

1. The `wasm_activation/pkg/` directory is missing or incomplete.
2. Network connectivity issues when loading from JSR (for `https://` URLs).
3. Insufficient Deno permissions.

**Solutions:**

- Verify the NEAT-AI package includes `wasm_activation/pkg/` with at least:
  - `wasm_activation.js`
  - `wasm_activation_bg.wasm`
- Ensure Deno has `--allow-read` (for local files) and `--allow-net` (for JSR).
- If building from source, run:
  ```bash
  cd wasm_activation && ./build.sh
  ```

### WASM module not initialised

**Symptoms:**

- `WASM module not initialised`

**Causes:**

- Calling activation methods before the WASM module has finished loading. This
  can happen in custom worker setups that bypass the standard initialisation.

**Solutions:**

- Use the standard `Creature.activate()` API which handles initialisation
  transparently.
- In custom worker setups, ensure `initWasmActivationSync()` is called with the
  correct JS bindings and WASM binary payload before activating creatures.

### WASM in Deno Workers vs Main Thread

**Main thread:** WASM auto-initialises at module evaluation time. No action
required.

**NEAT-AI worker system:** The parent thread pre-loads the WASM payload and
sends it to workers during initialisation. Workers call
`initWasmActivationSync()` with the received payload.

**Independent Deno Workers:** If your Deno Worker imports NEAT-AI directly,
auto-initialisation runs at module load. Ensure the worker has `--allow-read`
and/or `--allow-net` permissions.

**Common worker issues:**

- `Worker WASM activation payload missing` — The parent thread did not send the
  WASM payload. Call `fetchWasmForWorkers()` before spawning workers.
- `Worker WASM activation init failed` — Synchronous init returned false. Check
  for re-entrancy issues or payload corruption.
- `Worker init timed out after Ns` — Increase the timeout by setting
  `NEAT_AI_WORKER_INIT_TIMEOUT_MS` (default: 60,000 ms, minimum: 1,000 ms).

### RuntimeError: unreachable

**Symptoms:**

- `RuntimeError: unreachable` during activation in long-running workloads.

**Cause:** WASM heap exhaustion from too many cached `CompiledNetwork` instances
(Issue #1338).

**Solutions:**

- The LRU cache automatically evicts old entries (default: 512 cached
  instances). Reduce the limit if memory is tight:
  ```typescript
  import { setMaxCachedWasmCreatureActivations } from "neat-ai/wasm";
  setMaxCachedWasmCreatureActivations(256);
  ```
- Reduce parallel creature count or population size.

---

## Discovery Library

The [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) Rust
FFI extension provides GPU-accelerated structural analysis. It is **optional** —
if unavailable, the discovery phase is skipped.

### Building NEAT-AI-Discovery locally

```bash
# Clone into a sibling directory
git clone https://github.com/stSoftwareAU/NEAT-AI-Discovery.git ../NEAT-AI-Discovery
cd ../NEAT-AI-Discovery

# Build and install
cargo build --release
./scripts/runlib.sh
```

The build script installs the library to `~/.cargo/lib/`.

### Setting NEAT_AI_DISCOVERY_LIB_PATH

If the library is not in a standard location, set the environment variable:

```bash
export NEAT_AI_DISCOVERY_LIB_PATH="/absolute/path/to/libneat_ai_discovery.dylib"
```

This can point to either the library file or a directory containing it.

**Resolution order** (the first match wins):

1. `NEAT_AI_DISCOVERY_LIB_PATH` environment variable
2. `~/.cargo/lib/`
3. `./target/release/`
4. `../NEAT-AI-Discovery/target/release/`

**Library names by platform:**

| Platform | Library Name                 |
| -------- | ---------------------------- |
| macOS    | `libneat_ai_discovery.dylib` |
| Linux    | `libneat_ai_discovery.so`    |
| Windows  | `libneat_ai_discovery.dll`   |

### Architecture mismatch errors (arm64 vs x86)

**Symptoms:**

- Segmentation fault ("Killed: 9") when loading the library.
- Library file exists but cannot be loaded.
- Silent initialisation failure.

**Diagnosis:**

```bash
# macOS: check architecture and dependencies
file ~/.cargo/lib/libneat_ai_discovery.dylib
otool -L ~/.cargo/lib/libneat_ai_discovery.dylib

# Linux: check architecture and dependencies
file /path/to/libneat_ai_discovery.so
ldd /path/to/libneat_ai_discovery.so
```

**Solutions:**

- Rebuild the library on the target machine:
  ```bash
  cd ../NEAT-AI-Discovery && cargo build --release
  ```
- Ensure `rustup` targets match your system architecture.
- Use the verification script:
  ```bash
  deno run --allow-ffi scripts/check_discovery_safe.ts
  ```

### NEAT_RUST_DISCOVERY_OPTIONAL for graceful degradation

In environments where discovery is not required (e.g. CI without GPU):

```bash
export NEAT_RUST_DISCOVERY_OPTIONAL=true
```

Values `"1"`, `"true"`, or `"yes"` (case-insensitive) cause discovery tests to
skip gracefully rather than fail.

### FFI permission denied

**Symptom:** `FFI permission denied for discovery library`

**Solution:** Run with the `--allow-ffi` flag:

```bash
deno run --allow-ffi --allow-read --allow-env your_script.ts
```

### No GPU detected

**Symptom:** `Discovery disabled: Rust library loaded but GPU probe failed`

This is a **non-fatal** condition. The library loaded but no usable GPU was
found. Discovery simply will not run. On macOS, ensure Metal is available.

---

## Memory Management

### V8 heap size configuration

For large populations or long training runs, increase the V8 heap:

```bash
deno test --v8-flags=--max-old-space-size=8192 ...
```

The `quality.sh` script uses 8,192 MB (8 GB) by default.

### Test parallelism and memory pressure

Running tests with `--parallel` uses more memory. If you encounter OOM kills:

1. **Reduce heap allocation:**
   ```bash
   deno test --v8-flags=--max-old-space-size=4096 ...
   ```
2. **Disable parallelism:**
   ```bash
   deno test ...  # omit --parallel flag
   ```
3. **Use `--expose-gc`** for explicit garbage collection hints (used by
   `quality.sh`).

### Exit code 143 (SIGTERM / OOM kill)

**Symptoms:**

- `deno test exited with 143 (SIGTERM)`
- Test process killed by the operating system or container orchestrator.

**Cause:** Memory usage exceeded system limits. Common when running all 2,000+
tests in parallel with a large heap.

**Solutions:**

- Reduce `--max-old-space-size` to leave headroom for the OS.
- Run tests without `--parallel`.
- In CI, the `coverage.yaml` workflow automatically retries with 50% memory and
  no parallelism if the first attempt exits with code 143.

### Discovery memory tuning

For discovery workloads, tune these options to control peak memory:

| Option                        | Default | Effect                             |
| ----------------------------- | ------- | ---------------------------------- |
| `discoveryRustFlushRecords`   | 4,096   | Samples buffered before Rust flush |
| `discoveryRustFlushBytes`     | ~50 MiB | Byte threshold before flush        |
| `discoveryDrainEveryNBatches` | 10      | Drain frequency for promise chains |

Lower values reduce peak memory at the cost of more I/O.

---

## CI Failures

### Understanding coverage.yaml

The CI workflow (`coverage.yaml`) uses a two-stage strategy:

1. **First attempt:** Detects available CPU cores and memory, then allocates
   resources dynamically:
   - 8+ cores and 8+ GB RAM: 70% memory, parallel enabled
   - 4+ cores and 4+ GB RAM: 60% memory, parallel enabled
   - Under 4 cores or 4 GB: 50% memory, no parallelism

2. **Retry on SIGTERM:** If exit code 143 (OOM kill), retries with:
   - 50% of original memory allocation (minimum 512 MB)
   - Parallelism disabled
   - Minimum 1 GB floor

**Exit code meanings:**

| Exit Code | Meaning            | CI Action               |
| --------- | ------------------ | ----------------------- |
| 0         | All tests passed   | Proceed to coverage     |
| 1         | Test failures      | Report failure          |
| 143       | SIGTERM (OOM kill) | Retry with lower memory |
| Other     | Unexpected error   | Fail the job            |

### quality.sh failures

The `quality.sh` script runs these steps in order:

1. `deno outdated --update --latest` — Update dependencies
2. `deno fmt` — Format code
3. `deno lint --fix` — Lint with auto-fix
4. Bash syntax check — Validates `.sh` files
5. Discovery library check — Validates Rust library availability
6. `deno check` — Type-check
7. `deno test` — Run all tests with leak detection

If discovery checks fail with exit codes 137 or 9 (segfault), the script
provides diagnostic guidance. See the
[Architecture mismatch](#architecture-mismatch-errors-arm64-vs-x86) section.

---

## Configuration

### Common invalid option combinations

#### Feedback loop without disabling random samples

```
Error: "Feedback Loop, Disable Random Samples must be set together"
```

When enabling `feedbackLoop: true`, you must also set
`disableRandomSamples: true`:

```typescript
createNeatConfig({
  feedbackLoop: true,
  disableRandomSamples: true, // Required when feedbackLoop is true
});
```

#### Adaptive mutation threshold ordering

```
Error: "Adaptive mutation large threshold must be greater than medium threshold"
```

The `large` threshold must exceed the `medium` threshold:

```typescript
createNeatConfig({
  adaptiveMutationThresholds: {
    medium: 6, // Must be less than large
    large: 12,
  },
});
```

#### Plateau detection rate ordering

```
Error: "Plateau detection rapidImprovementRate must be greater than
minImprovementRate"
```

The `rapidImprovementRate` must exceed `minImprovementRate`:

```typescript
createNeatConfig({
  plateauDetection: {
    minImprovementRate: 0.001, // Must be less
    rapidImprovementRate: 0.02, // Must be greater
  },
});
```

### Understanding ValidationError messages

NEAT-AI uses typed `ValidationError` exceptions with a `name` property
indicating the category:

| Error Name               | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `NO_OUTWARD_CONNECTIONS` | A hidden or constant neuron has no outward connections                   |
| `NO_INWARD_CONNECTIONS`  | A hidden neuron has no inward connections                                |
| `IF_CONDITIONS`          | An IF neuron is missing required condition/positive/negative connections |
| `RECURSIVE_SYNAPSE`      | A backward connection in forward-only mode                               |
| `SELF_CONNECTION`        | A self-loop in forward-only mode                                         |
| `MEMETIC`                | Issues with memetic (learned weight) structures                          |
| `OTHER`                  | General validation errors                                                |

Example of catching and inspecting a validation error:

```typescript
try {
  creatureValidate(creature, { feedbackLoop: false });
} catch (error) {
  if (error.name === "RECURSIVE_SYNAPSE") {
    // Handle forward-only violation
  }
}
```

### Forward-only vs recurrent mode constraints

**Forward-only** (default) rejects:

- **Self-connections** (neuron connected to itself). Checked when
  `forwardOnly: true` is passed to `creatureValidate()`.
- **Recursive synapses** (connection from a higher-indexed neuron to a
  lower-indexed one). Checked when `feedbackLoop: false`.

**Recurrent** mode (enabled with `feedbackLoop: true`) allows both self-loops
and backward connections, which is useful for time-series behaviours.

If you see unexpected `RECURSIVE_SYNAPSE` or `SELF_CONNECTION` errors, check
whether your creature topology matches the configured mode.

---

## Environment Variables Reference

| Variable                          | Default  | Purpose                                             |
| --------------------------------- | -------- | --------------------------------------------------- |
| `NEAT_AI_DISCOVERY_LIB_PATH`      | _(none)_ | Override discovery library location                 |
| `NEAT_RUST_DISCOVERY_OPTIONAL`    | `false`  | Skip discovery tests gracefully when library absent |
| `NEAT_AI_WORKER_INIT_TIMEOUT_MS`  | `60000`  | Worker initialisation timeout (ms)                  |
| `NEAT_AI_DISCOVERY_VERBOSE`       | _(none)_ | Enable verbose discovery logging in workers         |
| `NEAT_AI_DISCOVERY_DETERMINISTIC` | _(none)_ | Force deterministic discovery (testing)             |

---

## Getting Help

If your issue is not covered here:

1. Search [open issues](https://github.com/stSoftwareAU/NEAT-AI/issues) for
   similar problems.
2. Open a new issue with reproduction steps and error output.
3. For development questions, see [AGENTS.md](../AGENTS.md) for coding
   conventions and architecture details.
