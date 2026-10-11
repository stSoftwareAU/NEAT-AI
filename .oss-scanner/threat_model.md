# Threat model

Disclosure policy and the in-repo security automation are in
[SECURITY.md](../SECURITY.md). The trust-boundary lens, and which `src/`
directories have already been swept, are in
[docs/SECURITY_SWEEP_COVERAGE.md](../docs/SECURITY_SWEEP_COVERAGE.md). This file
is the short brief for the scanner.

## What this project does and where untrusted input enters

NEAT-AI is a Deno/TypeScript library (`@stsoftware/neat-ai` on JSR) that evolves
neural networks ("creatures"); activation and scoring run in a vendored WASM
bundle built from NEAT-AI-core. In production, many machines evolve populations
and exchange creatures through a shared GitHub repository, so treat as
untrusted:

- creature JSON loaded via `Creature.fromJSON` / `loadFrom` (and checkpoints via
  `importCheckpoint`): neuron `uuid`, `squash`, `bias`, synapse `weight`,
  `type`, counts and tags can be anything;
- binary `.bin` dataset files read by `evolveDir`
  (`src/architecture/DatasetIO.ts`, `src/architecture/training/`);
- discovery success/failure cache JSON and diagnostics on disk
  (`src/discovery/`), and replay inputs;
- the WASM bundle fetched from jsr.io for remote imports
  (`src/wasm/WasmBundleCache.ts`, pinned by `WasmBundleSha256.ts`) and the
  release tarball `build.sh` downloads (pinned by `neatCore.assetSha256`).

## Components that matter most / least

Most important:

- the creature load path (`src/creature/CreatureSerialization.ts`,
  `src/architecture/Neuron.ts`) and anything downstream that builds
  `new Function()` source from creature values (`src/neuron/`,
  `src/methods/activations/`): a crafted creature must never execute code;
- filesystem paths built from creature or dataset values (for example
  `src/intelligentDesign/`, `src/discovery/`, `src/cache/`);
- allocations or loop bounds taken from parsed counts before
  `assertValidCreatureShape` runs;
- WASM bundle integrity checks (`src/wasm/WasmModuleLoader.ts`,
  `WasmBinaryValidator.ts`, `WasmBundleCache.ts`, `build.sh`);
- worker `import()` of caller-supplied specifiers
  (`src/utils/ModuleSpecifierGuard.ts`).

Lower priority: FFI to the optional Rust Discovery and native core libraries
(`Deno.dlopen` of a library the operator installs), the optional `rust_scorer`
subprocess, ONNX export, and `src/deprecated/`. `bench/`, `test/`, `scripts/`
and `docs/` do not ship to consumers.

## How to exercise it

From `/src`: `deno test -A --preload test/_preload.ts --config ./deno.json` runs
the suite (about 1,400 files under `test/`); pass files to run a subset.
`test/security/CreatureJsonInjection.ts` is a good starting harness for crafted
creature JSON. `deno check` type-checks everything; `mod.ts` is the public API.

## How you rate severity

- Critical: code execution in the host process from a crafted creature,
  checkpoint or dataset file, or a substituted WASM bundle accepted despite its
  SHA-256 pin.
- High: path traversal or arbitrary file write from creature or dataset values;
  a crafted creature that silently corrupts others through breeding (for example
  by forging neuron UUIDs).
- Medium: unbounded memory, CPU or recursion from a small crafted input, and log
  injection where logs are machine-parsed.
- Low: issues that need the operator's own configuration or code to be hostile.

## Anything to leave alone

- Developer-supplied in-process values (options, custom cost function paths,
  `NEAT_AI_*` environment variables, library search paths) are trusted.
- Discovery being GPU-only, and WASM-only operations failing fast without a TS
  fallback, are by design.
