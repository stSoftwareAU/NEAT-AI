# Contributing to NEAT-AI

Thank you for your interest in contributing to NEAT-AI! This guide covers
everything you need to get started — from setting up your development
environment to submitting a pull request.

For coding conventions, terminology, and architecture details, see
[AGENTS.md](./AGENTS.md).

## Quick Start

### Prerequisites

- **Deno 2.x** — Install from [deno.land](https://deno.land/) or via:

  ```bash
  curl -fsSL https://deno.land/install.sh | sh
  ```

  Verify your installation:

  ```bash
  deno --version   # Must be 2.x or later
  ```

- **Rust toolchain** (optional) — Only needed if you want to build the
  [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) FFI
  extension locally. Install via [rustup](https://rustup.rs/).

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/stSoftwareAU/NEAT-AI.git
   cd NEAT-AI
   ```

2. **Verify your setup** by running the full quality gate:

   ```bash
   ./quality.sh
   ```

   This script formats, lints, type-checks, and runs all 2000+ tests. If it
   passes, you are ready to contribute.

3. **Run individual tests** during development:

   ```bash
   deno test test/path/to/test.ts
   ```

### WASM Activation Module

The WASM activation backend is **required** and ships pre-built in
`wasm_activation/pkg/`. The library initialises it automatically — no manual
init or environment variables needed.

To rebuild WASM from source (requires
[wasm-pack](https://rustwasm.github.io/wasm-pack/)):

```bash
cd wasm_activation
wasm-pack build --target deno
```

### Rust Discovery Library (Optional)

The Rust FFI extension provides GPU-accelerated structural analysis. It is
optional — tests and the core library work without it.

1. Clone and build alongside NEAT-AI:

   ```bash
   git clone https://github.com/stSoftwareAU/NEAT-AI-Discovery.git ../NEAT-AI-Discovery
   ../NEAT-AI-Discovery/scripts/runlib.sh
   ```

2. Or point to an existing build:

   ```bash
   export NEAT_AI_DISCOVERY_LIB_PATH="/absolute/path/to/libneat_ai_discovery.dylib"
   ```

3. Validate:

   ```bash
   deno run --allow-env --allow-ffi --allow-read scripts/check_discovery.ts
   ```

## Development Workflow

### 1. Create a Branch

Branch from `Develop` (the main branch):

```bash
git checkout Develop
git pull origin Develop
git checkout -b your-branch-name
```

### 2. Write Failing Tests First (TDD)

Follow test-driven development:

1. Write a test that defines the expected behaviour.
2. Run it and confirm it fails.
3. Implement the change to make the test pass.
4. Refactor if needed, keeping all tests green.

### 3. Implement the Change

- Follow the conventions in [AGENTS.md](./AGENTS.md).
- Use **Australian English** spelling (colour, behaviour, organisation, favour,
  optimise, normalise, analyse, centre, metre).
- Run `deno fmt` and `deno lint --fix` regularly.

### 4. Run the Quality Gate

```bash
./quality.sh
```

The quality gate runs:

1. Dependency updates (`deno outdated --update --latest`)
2. Code formatting (`deno fmt`)
3. Linting with auto-fix (`deno lint --fix`)
4. Bash script syntax checks
5. Type checking (`deno check`)
6. Discovery library build (if `../NEAT-AI-Discovery` exists)
7. All tests in parallel with leak detection

Keep running `./quality.sh` until it passes cleanly.

### 5. Submit a Pull Request

- Target the `Develop` branch.
- Use the PR title format: `Topic: Description (#issue)`
- Include a clear summary and test plan in the PR body.

## Testing

### Conventions

- Tests use `Deno.test()` with `@std/assert` imports.
- Test files live under `test/` and mirror the `src/` directory structure.
- All 2000+ tests run **in parallel** — never rely on timing or execution order.

### What to Test

Write **"what" tests** that exercise real code and assert on outcomes:

```typescript
import { assertEquals } from "@std/assert";

Deno.test("squash produces expected output", () => {
  const result = mySquash(0.5);
  assertEquals(result, 0.6224593312018546);
});
```

Avoid **"how" tests** that check implementation details:

- Do not assert that a specific internal method was called.
- Do not grep source files for patterns or keywords.
- Do not check function bodies, line counts, or documentation content.

### Unit Tests vs Benchmarks

- **Unit tests** (`test/`) verify correctness. Never use timing APIs
  (`performance.now()`, `Date.now()`, etc.) in tests.
- **Benchmarks** (`bench/`) measure performance. Use `Deno.bench()` or
  `performance.now()` here.

## Adding Configuration

When adding a new configuration option, follow the established pattern:

### Step 1: Create the Config File

Create `src/config/FooConfig.ts`:

```typescript
/**
 * Configuration for foo behaviour.
 *
 * Issue #XXXX: Brief description.
 */
export interface FooConfig {
  /**
   * Description of the field.
   * Default: 42
   */
  bar?: number;

  /**
   * Description of the field.
   * Default: true
   */
  baz?: boolean;
}

/**
 * Required version of FooConfig with all fields populated.
 * Used internally after defaults are applied.
 */
export type RequiredFooConfig = Required<FooConfig>;

/**
 * Default values for foo configuration.
 */
export const DEFAULT_FOO_CONFIG: RequiredFooConfig = {
  bar: 42,
  baz: true,
};
```

### Step 2: Add to NeatArguments

In `src/config/NeatArguments.ts`, add a `RequiredFooConfig` field:

```typescript
fooConfig: RequiredFooConfig;
```

### Step 3: Add to NeatOptions

In `src/config/NeatOptions.ts`:

1. Add the partial override to both `NeatOptions` and `NeatOptionsInput` types.
2. For CLI-compatible options, wrap numeric fields with `CoerceNumeric<>`.
3. Add the config name to both `Omit` lists.

### Step 4: Parse in NeatConfig

In `src/config/NeatConfig.ts`, parse numeric values using the IIFE pattern:

```typescript
const fooConfig: RequiredFooConfig = (() => {
  const result: RequiredFooConfig = {
    ...DEFAULT_FOO_CONFIG,
    ...options.fooConfig,
  };

  if (options.fooConfig?.bar !== undefined) {
    result.bar = parseNumber(options.fooConfig.bar, "fooConfig.bar");
  }

  return result;
})();
```

### Step 5: Validate

Add cross-field validation after the config object is created, before
`validate()` is called.

### Step 6: Add Tests

Create `test/config/FooConfig.ts` with tests for default values, custom
overrides, and validation errors.

## Adding Activation Functions

Activation functions (called "squash" functions in NEAT-AI) follow a strategy
pattern. See `src/methods/activations/README.md` for the full reference.

### Step 1: Create the Implementation

Create a new file in `src/methods/activations/` implementing the
`ActivationInterface`:

- **`getName()`** — Returns the unique squash name.
- **`squash(x)`** — The forward activation function.
- **`unSquash(x)`** — The inverse (if invertible).
- **`range()`** — Returns `{ low, high }` output bounds.

### Step 2: Add Tests

Create tests under `test/` that verify:

- `squash()` produces correct output for known inputs.
- `unSquash(squash(x)) ≈ x` round-trips correctly (if invertible).
- Edge cases (zero, negative, large values).
- The function integrates correctly with the activation system.

### Step 3: Register the Activation

Register the new activation in the activation system so it is available for
mutation selection. Set an appropriate priority weight (1–10) based on the
function's practical usefulness.

### Step 4: Update Documentation

Add an entry to `src/methods/activations/README.md` following the existing
format — include priority, invertibility, and backpropagation strategy.

## Code Style

### Australian English

All code, comments, and documentation use Australian English spelling:

| Use            | Not          |
| -------------- | ------------ |
| colour         | color        |
| behaviour      | behavior     |
| organisation   | organization |
| favour         | favor        |
| optimise       | optimize     |
| normalise      | normalize    |
| analyse        | analyze      |
| centre         | center       |
| licence (noun) | license      |
| license (verb) | license      |

### Key Lint Rules

The project enforces these lint rules (configured in `deno.json`):

- **`default-param-last`** — Default parameters (`foo = val`) cannot precede
  optional parameters (`bar?: type`). Make defaults optional and apply them in
  the function body instead:

  ```typescript
  // Wrong
  function fn(foo = 10, bar?: string) { ... }

  // Right
  function fn(bar?: string, foo?: number) {
    const effectiveFoo = foo ?? 10;
  }
  ```

- **`camelCase`** — Use `camelCase` for variables and functions.
- **`eqeqeq`** — Use `===` and `!==` instead of `==` and `!=`.
- **`no-throw-literal`** — Throw `Error` objects, not strings or other values.
- **`ban-untagged-todo`** — TODOs must include an issue reference:
  `// TODO(#1234): description`.

For the complete set of conventions, see [AGENTS.md](./AGENTS.md).

## Project Structure

```
src/                    # Source code
  architecture/         # Core neural network architecture
  config/               # Configuration and options
  costs/                # Cost/fitness functions
  discovery/            # Discovery integration (Rust FFI bridge)
  errors/               # Error types
  methods/              # Activation functions (squash implementations)
  mutate/               # Mutation operators
  NEAT/                 # Core NEAT algorithm
  propagate/            # Backpropagation
test/                   # Tests (mirrors src/ structure)
bench/                  # Benchmarks
docs/                   # Extended documentation
wasm_activation/        # WASM activation module (Rust source + pkg)
scripts/                # Utility scripts
```

## Getting Help

- Open an [issue](https://github.com/stSoftwareAU/NEAT-AI/issues) for bugs or
  feature requests.
- Check [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) for common issues.
- See [AGENTS.md](./AGENTS.md) for detailed coding conventions and architecture.
