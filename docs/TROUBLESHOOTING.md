# 🐛 Troubleshooting Guide

Quick FAQ-style index of [NEAT-AI](../AGENTS.md#-terminology) failure modes.
Each entry describes the symptom in one sentence and links to a detail doc under
[`troubleshooting/`](troubleshooting/) where the full diagnosis lives.

If you have arrived here by Googling an error message, jump straight to the
matching topic doc — each one is self-contained.

## 🗺️ Topic map

```mermaid
flowchart LR
    Idx[TROUBLESHOOTING.md<br/>FAQ index] --> WASM[troubleshooting/WASM.md]
    Idx --> Disc[troubleshooting/DISCOVERY.md]
    Idx --> Mem[troubleshooting/MEMORY.md]
    Idx --> Perf[troubleshooting/PERFORMANCE.md]
    Idx --> Train[troubleshooting/TRAINING.md]
    Idx --> CI[troubleshooting/CI.md]
    Idx --> Cfg[troubleshooting/CONFIGURATION.md]
    Idx --> ONNX[troubleshooting/ONNX.md]
```

## 🧭 First-response decision tree

Not sure which topic you need? Start here and follow the first branch that
matches your symptom.

```mermaid
flowchart TD
    Start{What went wrong?} --> Crash[Process crashed / killed]
    Start --> Err[Error message thrown]
    Start --> Slow[Run is too slow]
    Start --> Bad[Run finishes but results are poor]

    Crash --> OOM{Exit 143 / SIGTERM?}
    OOM -->|yes| Mem[troubleshooting/MEMORY.md]
    OOM -->|no| WASMc[troubleshooting/WASM.md]

    Err --> Val{ValidationError?}
    Val -->|yes| Cfg[troubleshooting/CONFIGURATION.md]
    Val -->|no| Ffi{FFI / discovery / GPU?}
    Ffi -->|yes| Disc[troubleshooting/DISCOVERY.md]
    Ffi -->|no| Onnx{ONNX export?}
    Onnx -->|yes| ONNXd[troubleshooting/ONNX.md]
    Onnx -->|no| WASMe[troubleshooting/WASM.md]

    Slow --> Perf[troubleshooting/PERFORMANCE.md]

    Bad --> Train[troubleshooting/TRAINING.md]
```

## ⚙️ WASM (WebAssembly) — init, load, and runtime panics

WASM activation is mandatory; there is no JavaScript fallback. See
[`troubleshooting/WASM.md`](troubleshooting/WASM.md) for full diagnostics.

- **`WASM activation: pkg not found at the canonical package location.`** — the
  `wasm_activation/pkg/` directory is missing or Deno lacks `--allow-read` /
  `--allow-net`. →
  [WASM module not found](troubleshooting/WASM.md#-wasm-module-not-found-or-failed-to-compile).
- **`WASM module not initialised`** — activation methods called before WASM
  finished loading, usually in a custom worker. →
  [WASM module not initialised](troubleshooting/WASM.md#-wasm-module-not-initialised).
- **`Worker WASM activation payload missing`** / `Worker init timed out` —
  parent did not pre-fetch the WASM payload, or `NEAT_AI_WORKER_INIT_TIMEOUT_MS`
  is too low. →
  [WASM in Deno Workers vs Main Thread](troubleshooting/WASM.md#-wasm-in-deno-workers-vs-main-thread).
- **`NotCapable: Requires net access to "jsr.io:443"` inside a worker** — your
  app spawned a Deno Worker against the JSR (JavaScript Registry) build of
  NEAT-AI; pre-fetch the payload in the parent and forward it. →
  [JSR-hosted NEAT-AI in your own workers (Issue #2545)](troubleshooting/WASM.md#-jsr-hosted-neat-ai-in-your-own-workers-issue-2545).
- **`RuntimeError: unreachable` in long runs** — WASM heap exhaustion from too
  many cached compiled networks. →
  [RuntimeError: unreachable](troubleshooting/WASM.md#-runtimeerror-unreachable).
- **WASM panic during fitness evaluation** — handled gracefully since Issues
  #2207 / #2212; root cause is usually numerical overflow. →
  [WASM panic recovery](troubleshooting/WASM.md#-wasm-panic-recovery).
- **`[Offspring/breed] dropping offspring from step=… that fails WASM compile`**
  or **`[Mutator] reverting mutation from step=… that fails WASM compile`** —
  the producer gate trapped on a bred or mutated topology and wrote a
  replay-ready dump under `.diagnostics/` (Issue #2672). →
  [Producer-gate WASM compile rejects](troubleshooting/WASM.md#-producer-gate-wasm-compile-rejects-issue-2672).

## 🦀 Discovery / Rust FFI — build, load, and GPU backend selection

The Rust FFI (Foreign Function Interface) extension is optional; discovery is
skipped when the library is unavailable. See
[`troubleshooting/DISCOVERY.md`](troubleshooting/DISCOVERY.md) for full
diagnostics.

- **`FFI permission denied for discovery library`** — run with `--allow-ffi`. →
  [FFI permission denied](troubleshooting/DISCOVERY.md#-ffi-permission-denied).
- **Segfault / "Killed: 9" loading the library** — `arm64` vs `x86_64` (or
  `glibc` vs `musl`) mismatch; rebuild on the target machine. →
  [Architecture mismatch errors](troubleshooting/DISCOVERY.md#-architecture-mismatch-errors-arm64-vs-x86).
- **`ℹ️  No GPU detected — discovery will use CPU fallback`** — no compatible
  `wgpu` adapter (Metal / Vulkan / DirectX 12). This is **non-fatal**: the GPU
  probe is informational only and does not gate discovery, which continues on
  CPU. → [No GPU detected](troubleshooting/DISCOVERY.md#-no-gpu-detected).
- **Library cannot be found at the default locations** — set
  `NEAT_AI_DISCOVERY_LIB_PATH` to an absolute path. →
  [Setting NEAT_AI_DISCOVERY_LIB_PATH](troubleshooting/DISCOVERY.md#-setting-neat_ai_discovery_lib_path).
- **Discovery runs but proposes no useful candidates** — diagnose timeouts,
  `costOfGrowth`, minimum-candidate counts, and dataset coverage. →
  [Discovery not finding improvements](troubleshooting/DISCOVERY.md#-discovery-not-finding-improvements).

## 💾 Memory pressure / OOM during evolution

See [`troubleshooting/MEMORY.md`](troubleshooting/MEMORY.md) for the full
decision tree.

- **`deno test exited with 143 (SIGTERM)` or process killed mid-run** — OOM
  (out-of-memory) kill; lower `--max-old-space-size`, disable `--parallel`, or
  shrink the population. →
  [Exit code 143](troubleshooting/MEMORY.md#-exit-code-143-sigterm--oom-kill).
- **Performance degrades over long runs** — caches are not evicting; tune the
  `MemoryMonitor` thresholds and the WASM cache size. →
  [Memory issues during training](troubleshooting/MEMORY.md#-memory-issues-during-training).
- **Tuning V8 heap, leak-detection tests, or discovery memory knobs** — see the
  corresponding sections in
  [`troubleshooting/MEMORY.md`](troubleshooting/MEMORY.md).

## 🐢 Performance unexpectedly slow

See [`troubleshooting/PERFORMANCE.md`](troubleshooting/PERFORMANCE.md) for the
full decision tree.

- **Each generation takes far too long** — confirm WASM is initialised, check
  worker thread count, scale dataset / population, and bound discovery overhead.
  → [Training is slow](troubleshooting/PERFORMANCE.md#training-is-slow).

## 📉 Training divergence — plateau, NaN / infinity, fuzzing, hyperparameters

See [`troubleshooting/TRAINING.md`](troubleshooting/TRAINING.md) for the full
decision trees.

- **Fitness plateau — best creature's error stays flat** — enable plateau
  detection, check mutation rate / diversity / `costOfGrowth`. →
  [Fitness plateau](troubleshooting/TRAINING.md#-fitness-plateau).
- **Activations producing `NaN` or `Infinity`** — input normalisation,
  activation choice, weight / bias bounds, stability adaptation. →
  [Creatures producing NaN or Infinity](troubleshooting/TRAINING.md#-creatures-producing-nan-or-infinity).
- **Noise injection / cross-validation tuning** — see
  [Data fuzzing and regularisation](troubleshooting/TRAINING.md#-data-fuzzing-and-regularisation).
- **Evolved hyperparameters cluster at extremes** — see
  [Hyperparameter evolution](troubleshooting/TRAINING.md#-hyperparameter-evolution).

## 🔄 CI / quality.sh failures

See [`troubleshooting/CI.md`](troubleshooting/CI.md) for full details.

- **`coverage.yaml` fails first attempt with exit 143** — workflow auto-retries
  with halved memory and parallel disabled. →
  [Understanding coverage.yaml](troubleshooting/CI.md#-understanding-coveragesyaml).
- **`quality.sh` fails on a specific step** — see the per-step list in
  [quality.sh failures](troubleshooting/CI.md#-quality-sh-failures).

## ⚙️ Configuration — invalid options and `ValidationError`

See [`troubleshooting/CONFIGURATION.md`](troubleshooting/CONFIGURATION.md) for
the full surface.

- **`Feedback Loop, Disable Random Samples must be set together`** — set both. →
  [Feedback loop](troubleshooting/CONFIGURATION.md#feedback-loop-without-disabling-random-samples).
- **Adaptive mutation / plateau threshold ordering errors** — see
  [Common invalid option combinations](troubleshooting/CONFIGURATION.md#-common-invalid-option-combinations).
- **Unexpected `RECURSIVE_SYNAPSE` or `SELF_CONNECTION` `ValidationError`** —
  forward-only mode disallows both; switch to `feedbackLoop: true` if you need
  recurrence. →
  [Forward-only vs recurrent mode constraints](troubleshooting/CONFIGURATION.md#-forward-only-vs-recurrent-mode-constraints).

## 📤 ONNX export issues

See [`troubleshooting/ONNX.md`](troubleshooting/ONNX.md) for full details.

- **`checkOnnxCompatibility` reports unsupported squashes** — IF, MINIMUM,
  MAXIMUM, HYPOT, HYPOTv2, MEAN are not exportable. →
  [Unsupported squashes](troubleshooting/ONNX.md#checkonnxcompatibility-reports-unsupported-squashes).
- **Exported ONNX model produces different outputs** — small differences (<
  1e-10) are expected; larger differences usually indicate recurrent
  connections. →
  [Different outputs](troubleshooting/ONNX.md#exported-onnx-model-produces-different-outputs).

## 🌐 Environment variables reference

| Variable                          | Default        | Purpose                                                                |
| --------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `NEAT_AI_DISCOVERY_LIB_PATH`      | _(none)_       | Override discovery library location                                    |
| `NEAT_AI_WORKER_INIT_TIMEOUT_MS`  | `60000`        | Worker initialisation timeout (ms); ignored below `1000`               |
| `NEAT_AI_DISCOVERY_VERBOSE`       | _(none)_       | Enable verbose discovery logging in workers (`1`)                      |
| `NEAT_AI_DISCOVERY_DETERMINISTIC` | _(none)_       | Force deterministic discovery for testing (`1` / `true`)               |
| `NEAT_AI_RUST_SCORER_ENABLED`     | `false`        | Route fitness scoring through the external Rust scorer process         |
| `NEAT_AI_RUST_SCORER_BINARY_PATH` | `rust_scorer`  | Path to the Rust scorer binary                                         |
| `NEAT_AI_RUST_SCORER_BATCH`       | `true`         | Directory/batch scoring mode; set `false` for per-creature invocations |
| `NEAT_AI_RUST_SCORER_TIMEOUT_MS`  | `0` (no limit) | Per-invocation timeout for the Rust scorer (ms)                        |
| `NEAT_AI_RUST_SCORER_TMP_DIR`     | _(data dir)_   | Working directory for Rust scorer batch I/O                            |
| `NEAT_AI_RUST_SCORER_ENV`         | _(none)_       | JSON object of extra env vars passed to the Rust scorer child process  |
| `NEAT_AI_TRACE_PREDICTION`        | _(none)_       | Log detailed discovery failure-cache prediction traces (`1`)           |

## 🆘 Getting help

If your symptom is not listed above:

1. Search [open issues](https://github.com/stSoftwareAU/NEAT-AI/issues) for
   similar problems.
2. Open a new issue with reproduction steps and error output.
3. For development questions, see [`../AGENTS.md`](../AGENTS.md) for coding
   conventions and architecture details.

---

**Up to:** [`README.md`](../README.md) (entry point) ·
[`docs/README.md`](README.md) (topic index).
