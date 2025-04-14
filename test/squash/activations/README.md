# Activation Function Optimization

This directory contains tools and templates for optimizing the performance of
activation functions in the NEAT-AI project.

## Overview

The NEAT-AI project uses various activation functions for neural networks.
During backpropagation, we use `unSquash` functions to calculate the target raw
values for neurons. These functions are critical for performance, especially
during training.

Many activation functions use the Newton-Raphson method to approximate the
inverse of the activation function. This can be computationally expensive,
especially when done repeatedly during training.

## Optimization Strategy

1. **Identify Performance Bottlenecks**: Use benchmarks to identify which
   activation functions are slowest.
2. **Optimize Each Function**: Implement early exit strategies and better
   handling of corner cases.
3. **Convert to Rust**: For functions that remain slow after optimization,
   consider converting them to Rust.

## Directory Structure

- `types/`: Contains the activation function implementations
- `tests/`: Contains test files for each activation function
- `benchmarks/`: Contains benchmark files for each activation function
- `templates/`: Contains templates for creating test and benchmark files

## Running Tests

To run tests for all activation functions:

```bash
deno test src/methods/activations/tests/
```

To run tests for a specific activation function:

```bash
deno test src/methods/activations/tests/GELUTest.ts
```

## Running Benchmarks

To run benchmarks for all activation functions:

```bash
deno bench src/methods/activations/benchmarks/
```

To run benchmarks for a specific activation function:

```bash
deno bench src/methods/activations/benchmarks/GELUBenchmark.ts
```

## Optimization Techniques

### Early Exit Strategies

For Newton-Raphson based `unSquash` functions:

1. **Use a less strict tolerance for early exit**: If the error is small enough,
   we can exit early.
2. **Check if the hint is already close enough**: If a hint is provided and it's
   close to the expected value, we can return it immediately.
3. **Handle special cases**: For common values like 0 or very large values, we
   can return immediately without iteration.
4. **Avoid division by zero**: Check if the derivative is very small before
   dividing.
5. **Check for convergence**: If the new value is very close to the current
   value, we can exit early.

### Rust Conversion

For functions that remain slow after optimization, consider converting them to
Rust:

1. Create a Rust implementation of the function
2. Use Deno's FFI to call the Rust function from TypeScript
3. Benchmark the Rust implementation against the TypeScript implementation

## Adding New Activation Functions

To add a new activation function:

1. Create a new file in `types/` with the activation function implementation
2. Run the optimization script to create test and benchmark files:

```bash
deno run --allow-read --allow-write src/methods/activations/optimize_activations.ts
```

3. Update the test and benchmark files with the expected values for the new
   activation function
4. Run tests and benchmarks to ensure the new function works correctly and
   performs well
