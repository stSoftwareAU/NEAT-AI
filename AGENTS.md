# AGENTS.md - Coding Guidelines for NEAT-AI

This file is the single source of truth for coding conventions, project
terminology, and development workflows in the NEAT-AI repository. All
contributors (human and AI) should follow these guidelines.

## Terminology

We keep the tone playful, but every nickname maps to a mainstream
machine-learning idea:

- **Creatures** are individual neural networks/genomes inside a NEAT population,
  as described in the original NEAT paper by
  [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf).
- **Memetic evolution** refers to the well-studied combination of evolutionary
  search plus local gradient descent, also called a
  [memetic algorithm](https://en.wikipedia.org/wiki/Memetic_algorithm).
- **CRISPR injections** describe targeted gene edits inspired by the real-world
  [CRISPR gene editing technique](https://www.nature.com/scitable/topicpage/crispr-cas9-a-precise-tool-for-33169884/);
  in practice we add hand-crafted synapses/neurons.
- **Grafting** is crossover between incompatibly shaped genomes, similar to the
  [island-model speciation strategies](https://en.wikipedia.org/wiki/Island_model)
  used in evolutionary algorithms.
- **Squash** is our term for activation functions applied to neurons.
- **Discovery** is the error-guided structural evolution process that uses the
  Rust FFI extension to propose structural improvements.
- **Intelligent Design** is a technique for systematically testing different
  squash functions for each hidden neuron.

If you spot another fun label, expect it to be backed by a reference to the
standard term the first time it appears.

## Project Architecture

### Technology Stack

- **TypeScript** on **Deno 2.x** for the core library
- **WASM** (required) for activation/scoring - initialised automatically, no
  manual init needed
- **Rust** FFI extension
  ([NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)) for
  GPU-accelerated structural analysis
- **Metal** (macOS) for GPU compute shaders via `wgpu`

### Directory Structure

```
src/                    # Source code
  architecture/         # Core neural network architecture (Creature, Neuron, Synapse)
  blackbox/             # Black-box evaluation utilities
  breed/                # Crossover and breeding algorithms
  compact/              # Network compaction and optimisation
  config/               # Configuration and options (NeatOptions, NeatConfig)
  costs/                # Cost/fitness functions
  discovery/            # Discovery integration (Rust FFI bridge)
  errors/               # Error types
  intelligentDesign/    # Intelligent Design squash optimisation
  methods/              # Activation functions (squash implementations)
  multithreading/       # Worker thread utilities
  mutate/               # Mutation operators
  NEAT/                 # Core NEAT algorithm (selection, speciation)
  optimize/             # Optimisation passes
  propagate/            # Backpropagation (elastic distribution)
  reconstruct/          # Network reconstruction utilities
  upgrade/              # Version migration
  utils/                # Shared utilities
  wasm/                 # WASM activation bridge
test/                   # Tests (mirrors src/ structure)
bench/                  # Benchmarks
docs/                   # Extended documentation
wasm_activation/        # WASM activation module (Rust source + pkg)
scripts/                # Utility scripts
```

### Key Files

- `mod.ts` - Public API entry point
- `deno.json` - Deno configuration, dependencies, lint rules
- `quality.sh` - Pre-commit quality gate (lint, format, type-check, test)

## Coding Conventions

### Language

Use **Australian English** spelling throughout code, comments, and
documentation:

- colour, behaviour, organisation, favour, metre, centre
- optimise, normalise, analyse, summarise
- licence (noun), license (verb)

### Style

- Follow the Deno lint rules configured in `deno.json` (recommended + jsr tags)
- Use `deno fmt` for formatting
- Prefer `camelCase` for variables and functions
- Prefer explicit types where they aid readability
- Follow KISS, DRY, and the Boy Scout Rule
- Prefer smaller, focused files over large monolithic ones (Single
  Responsibility Principle)

### Testing

#### Unit Tests vs Benchmarks

- **Unit tests** (`test/`) verify **what** the code does — correct outputs,
  correct errors, correct state changes. They must never measure timing or
  performance.
- **Benchmarks** (`bench/`) measure **how fast** the code runs. Use
  `Deno.bench()` or `performance.now()` here, never in unit tests.
- Tests run in parallel; timing in unit tests is inherently unreliable. Do not
  use `performance.now()`, `performance.mark()`, `Date.now()`, or any timing API
  in test files.
- Do not reduce iteration counts to make "performance tests" faster — move them
  to `bench/` instead.

#### "What" Tests (Good) vs "How" Tests (Bad)

Every test should be a **"what" test**: it exercises real code with test data
and asserts on the **outcome** (return values, side effects, error conditions).

A **"how" test** checks implementation details rather than outcomes. Examples of
"how" tests to avoid:

- Asserting that a specific internal method was called
- Checking that a particular algorithm or data structure is used
- Grepping source files for patterns, keywords, or headings
- Inspecting function bodies, line counts, or documentation content
- Verifying that one function calls another

"How" tests break when implementation changes even though behaviour is
identical. For example, switching from quicksort to mergesort should not break
any unit test — the result is the same. If you need to verify performance
characteristics (e.g., that a cache makes things faster), write a benchmark.

#### Conventions

- Tests use `Deno.test()` with `@std/assert` imports
- Test files live under `test/` and are included via `deno.json`
- Name test files after the functionality they verify, not after performance
  characteristics (avoid "Benchmark" or "Performance" in test file names)

### Error Handling

- Use typed errors from `src/errors/`
- Fail fast on configuration errors
- Use `ValidationError` for structural validation

## Quality Gate

Before committing, run:

```bash
./quality.sh
```

This script runs the following steps by default:

1. Updates dependencies (`deno outdated --update --latest`)
2. Formats code (`deno fmt`)
3. Lints and auto-fixes (`deno lint --fix`)
4. Checks bash script syntax
5. Type-checks (`deno check`)
6. Builds the Rust discovery library (if `../NEAT-AI-Discovery` exists)
7. Runs all tests in parallel with leak detection

### Optional Flags

```bash
./quality.sh --help            # Show usage and step descriptions
./quality.sh --skip-tests      # Skip test execution
./quality.sh --skip-discovery  # Skip discovery library build and verification
./quality.sh --lint-only       # Only run formatting + linting (includes bash check)
./quality.sh --check-only      # Only run type-checking (deno check)
./quality.sh --dry-run         # Show which steps would run without executing them
```

Flags can be combined, e.g. `./quality.sh --skip-tests --skip-discovery`.

### Deployment Checklist

1. Run `./quality.sh` in both NEAT-AI and NEAT-AI-Discovery repositories
2. Increment version in `deno.json` (NEAT-AI) or `Cargo.toml`
   (NEAT-AI-Discovery)
3. Verify all tests pass before committing

## Activation / WASM

Activation uses WASM (required). The library initialises the WASM backend
automatically; callers do not need to call any init function or set environment
variables. This works transparently in both the main thread and Deno Worker
contexts. If WASM cannot be loaded, activation/scoring fails fast with an
actionable error.

## Rust Discovery Module

The Rust FFI extension shipped via
[NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) provides
GPU-accelerated structural hints used by `discoveryDir()`.

### Setup

1. Clone and build:

   ```bash
   git clone https://github.com/stSoftwareAU/NEAT-AI-Discovery.git
   ../NEAT-AI-Discovery/scripts/runlib.sh
   ```

2. Or set an explicit path:

   ```bash
   export NEAT_AI_DISCOVERY_LIB_PATH="/absolute/path/to/libneat_ai_discovery.dylib"
   ```

3. Validate:

   ```bash
   deno run --allow-env --allow-ffi --allow-read scripts/check_discovery.ts
   ```

4. Guard discovery calls with `isRustDiscoveryEnabled()` so controllers fail
   fast when the module is unavailable.

When the library cannot be resolved, set `NEAT_RUST_DISCOVERY_OPTIONAL=true` in
environments where skipping discovery should not abort the worker.

## Feed-forward vs Recurrent Connections

NEAT-AI supports two topology styles:

- **Feed-forward (forward-only)**: No self-loops or backward connections. Each
  activation depends only on the current input and upstream neuron activations.
- **Recurrent (feedback-enabled)**: Self-loops and backward connections allowed,
  useful for time-series behaviours.

In our production workloads, the default is feed-forward/forward-only.

## Documentation Layout

- **README.md** - Human-readable project overview, features, and quick start
- **CONTRIBUTING.md** - First-time contributor guide with development setup and
  workflow
- **AGENTS.md** (this file) - Coding guidelines and development reference
- **COMPARISON.md** - Comparison with other AI approaches
- **docs/API_REFERENCE.md** - Comprehensive public API reference
- **docs/DISCOVERY_GUIDE.md** - Complete discovery workflow guide
- **docs/DiscoveryDir.md** - Technical API reference for `discoveryDir()`
- **docs/GPU_ACCELERATION.md** - GPU acceleration details
- **docs/CONFIGURATION_GUIDE.md** - Complete configuration options reference
- **docs/BACKPROP_ELASTICITY.md** - Elastic backpropagation explanation
- **docs/INTELLIGENT_DESIGN.md** - Intelligent Design squash optimisation guide
- **docs/TROUBLESHOOTING.md** - Common issues and solutions
- **src/methods/activations/README.md** - Activation function strategy reference
