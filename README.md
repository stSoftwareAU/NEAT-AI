# NEAT Neural Network for DenoJS

<p align="left">
  <img width="100" height="100" src="docs/logo.png" align="right">
This project is a unique implementation of a neural network based on the NEAT (NeuroEvolution of Augmenting Topologies) algorithm, written in DenoJS using TypeScript.
</p>

## Feature Highlights

1. **Extendable Observations**: The observations can be extended over time as
   the indexing is done via UUIDs, not numbers. This prevents the need to
   restart the evolution process as new observations are added, providing
   flexibility and scalability.

2. **Distributed Training**: Training and evolution can be run on multiple
   independent nodes. The best-of-breed creatures can later be combined on a
   centralized controller node. This feature allows for distributed computing
   and potentially faster training times, enhancing the efficiency of the
   learning process.

3. **Life Long Learning**: Unlike many pre-trained neural networks, this project
   is designed for continuous learning, making it adaptable and potentially more
   effective in changing environments. This feature ensures the model remains
   relevant and accurate over time.

4. **Efficient Model Utilization**: Once trained, the current best model can be
   utilized efficiently by calling the `activate` function. This allows for
   quick and easy deployment of the trained model.

5. **Unique Squash Functions**: The neural network supports unique squash
   functions such as IF, MAX and MIN. These functions provide more options for
   the activation function, which can lead to different network behaviours,
   offering a wider range of potential solutions. More about
   [Activation Functions](https://en.wikipedia.org/wiki/Activation_function).

6. **Neuron Pruning**: Neurons whose activations don't vary during training are
   removed, and the biases in the associated neurons are adjusted. This feature
   optimizes the network by reducing redundancy and computational load. More
   about
   [Pruning (Neural Networks)](https://en.wikipedia.org/wiki/Pruning_(neural_networks)).

7. **CRISPR**: Allows injection of genes into a population of creatures during
   evolution. This feature can introduce new traits and potentially improve the
   performance of the population. More about
   [CRISPR](https://en.wikipedia.org/wiki/CRISPR).

8. **Grafting**: If parents aren't "genetically compatible", then the "grafting"
   algorithm from one parent to another parent onto the child will be used. This
   allows for species from islands to interbreed.

9. **Memetic Evolution**: The algorithm can now record and utilize the biases
   and weights of the fittest creatures to fine-tune future generations. This
   process, inspired by the concept of memes, allows the system to "remember"
   and build upon successful traits, enhancing the evolutionary process. Learn
   more about
   [Memetic Algorithms](https://en.wikipedia.org/wiki/Memetic_algorithm).

10. **Error-Guided Structural Evolution**: Dynamically identifies and creates
    new synapses by analyzing neuron activations and errors. This targeted
    structural adaptation improves performance by explicitly reducing
    neuron-level errors, blending evolutionary topology adjustments with
    error-driven learning. The Rust discovery engine can currently reconstruct
    hidden neurons using standard squashes including ReLU, GELU, ELU, SELU,
    Softplus, LOGISTIC (sigmoid), and TANH.

    **Note**: Error-Guided Structural Evolution now relies entirely on the
    [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) Rust
    extension library. If the library is not available, the discovery phase is
    skipped wholesale; there is no TypeScript fallback.

11. **[Visualization](https://stsoftwareau.github.io/NEAT-AI/index.html)**
12. **Discovery Integration Guide**: Step-by-step instructions for running
    discovery via `Creature.discoveryDir()` are available in the
    [DiscoveryDir guide](./docs/DiscoveryDir.md).

## Comparison with Other AI Approaches

Want to understand how NEAT compares to traditional neural networks, CNNs, RNNs,
and modern LLMs? See our comprehensive [COMPARISON.md](./COMPARISON.md) document
which explains:

- What we've implemented and how it works
- Pros and cons of our NEAT approach vs traditional methods
- Our unique innovations (memetic evolution, error-guided discovery, etc.)
- Shortcomings and future work opportunities with references

This comparison helps you understand when to use NEAT vs other approaches and
identifies areas for future development.

## Usage

This project is designed to be used in a DenoJS environment. Please refer to the
[DenoJS documentation](https://deno.land/manual) for setup and usage
instructions.

## Discovery Integration

Discovery is now documented in detail in
[`docs/DiscoveryDir.md`](./docs/DiscoveryDir.md). The guide covers data
preparation, orchestration patterns, and safe-write practices for
`Creature.discoveryDir()`.

### Forced Focus Overrides

The discovery recorder now honours an optional `discoveryFocusNeuronUUIDs`
override. When supplied, the recorder prioritises those hidden/output neuron
UUIDs instead of sampling by error, giving you deterministic reproduction of a
known gap. Each entry must match a neuron in the crippled creature.

To see the override in action, run the sibling
[`NEAT-AI-Examples`](../NEAT-AI-Examples) repository. The
`discovery/discover_missing_neuron.ts` script generates a wide, long synthetic
dataset, removes a known neuron, and invokes `Creature.discoveryDir()` with a
forced focus list so you can reproduce production time-outs safely:

```bash
deno run --allow-read --allow-write --allow-env --allow-ffi \
  ../NEAT-AI-Examples/discovery/discover_missing_neuron.ts
```

The example writes synthetic assets to a hidden `.synthetic-discovery/`
directory (ignored by git) and logs extended diagnostics whenever the Rust
recorder flushes or hits the time-out path. Use it as the starting point for
debugging “Invalid string length” failures without touching live workloads.

## Enabling the Rust Discovery Module

The Rust FFI extension shipped via
[NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) provides
the accelerated structural hints used by `discoveryDir()`. To enable it:

1. Clone the repository alongside this project and build the library:
   ```bash
   git clone https://github.com/stSoftwareAU/NEAT-AI-Discovery.git
   cd NEAT-AI-Discovery
   cargo build --release
   ```
2. Expose the compiled artefact to Deno by either copying it into `~/.cargo/lib`
   or exporting an explicit path:
   ```bash
   export NEAT_AI_DISCOVERY_LIB_PATH="/absolute/path/to/NEAT-AI-Discovery/target/release/libneat_ai_discovery.$(uname | tr '[:upper:]' '[:lower:]' | sed 's/darwin/dylib/;s/linux/so/;s/windows/dll/')"
   ```
3. Grant FFI permissions and validate the installation:
   ```bash
   deno run --allow-env --allow-ffi --allow-read scripts/check_discovery.ts
   ```
4. In your application, guard discovery calls with `isRustDiscoveryEnabled()` so
   that controllers fail fast when the module is unavailable.

When the library cannot be resolved, set `NEAT_RUST_DISCOVERY_OPTIONAL=true` in
environments where skipping discovery should not abort the worker. Otherwise,
treat a missing module as a deployment error and halt the job.

## Deployment Checklist

Before committing code changes, ensure you complete the following steps:

1. **Run quality checks in both repositories:**
   ```bash
   # In NEAT-AI-Discovery
   cd ../NEAT-AI-Discovery
   ./quality.sh

   # In NEAT-AI
   cd ../NEAT-AI
   ./quality.sh
   ```

2. **Increment version numbers:**
   - **NEAT-AI**: Update `deno.json` version field (e.g., `0.204.1` → `0.204.2`)
   - **NEAT-AI-Discovery**: Update `Cargo.toml` version field (e.g., `0.1.41` →
     `0.1.42`)

3. **Verify all tests pass** in both repositories before committing.

These steps ensure code quality, proper versioning, and that all tests pass
before deployment.

## Contributions

Contributions are welcome. Please submit a pull request or open an issue to
discuss potential changes/additions.

## License

This project is licensed under the terms of the Apache License 2.0. For the full
license text, please see [LICENSE](./LICENSE)

[![Built with the Deno Standard Library](https://raw.githubusercontent.com/denoland/deno_std/main/badge.svg)](https://deno.land/std)

[![codecov](https://codecov.io/github/stSoftwareAU/NEAT-AI/graph/badge.svg?token=DZ3R9KJGKB)](https://codecov.io/github/stSoftwareAU/NEAT-AI)
