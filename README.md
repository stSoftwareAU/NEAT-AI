# NEAT Neural Network for DenoJS

<p align="left">
  <img width="100" height="100" src="docs/logo.png" align="right">
This project is a practical implementation of a neural network based on the NEAT (NeuroEvolution of Augmenting Topologies) algorithm, written in DenoJS using TypeScript, with additional features such as error-guided discovery, memetic evolution, and distributed workflows.
</p>

For project terminology, coding conventions, and development guidelines, see
[AGENTS.md](./AGENTS.md).

## Feature Highlights

1. **Extendable Observations**: Input and output features are identified by
   stable UUIDs in the exported representation, rather than only by positional
   indices. This prevents the need to restart the evolution process as new
   observations are added, and makes it practical to evolve creatures on
   multiple machines and then recombine them, much like NEAT's historical
   marking for genes
   [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf).

2. **Distributed Training**: Training and evolution can be run on multiple
   independent nodes. The best-of-breed creatures can later be combined on a
   centralised controller node, mirroring the
   [island model](https://en.wikipedia.org/wiki/Island_model) used in
   evolutionary algorithms.

3. **Life Long Learning**: Designed for continuous learning in changing
   environments. The same population can keep training and adapting as new data
   arrives over weeks or months, supporting
   [continual learning](https://en.wikipedia.org/wiki/Continual_learning) while
   still relying on your training data to keep past knowledge represented.

4. **Efficient Model Utilisation**: Once trained, the current best model can be
   utilised efficiently by calling the `activate` function. This runs a single
   forward pass that maps inputs to outputs.

   **Activation uses WASM (required).** The library initialises the WASM backend
   automatically; callers do not need to call any init function or set
   environment variables.

5. **Unique Squash Functions**: Supports unique squash functions such as IF, MAX
   and MIN, offering a wider range of potential solutions. More about
   [Activation Functions](https://en.wikipedia.org/wiki/Activation_function).

6. **Neuron Pruning**: Neurons whose activations don't vary during training are
   removed, and the biases in associated neurons are adjusted. More about
   [Pruning (Neural Networks)](https://en.wikipedia.org/wiki/Pruning_(neural_networks)).

7. **CRISPR**: Allows injection of genes into a population of creatures during
   evolution. More about [CRISPR](https://en.wikipedia.org/wiki/CRISPR).

8. **Grafting**: If parents aren't "genetically compatible", the grafting
   algorithm enables cross-island interbreeding, preserving diversity in the
   same spirit as
   [island-model evolution](https://en.wikipedia.org/wiki/Island_model).

9. **Memetic Evolution**: Records and utilises the biases and weights of the
   fittest creatures to fine-tune future generations. Learn more about
   [Memetic Algorithms](https://en.wikipedia.org/wiki/Memetic_algorithm).

10. **Error-Guided Structural Evolution**: Dynamically identifies and creates
    new synapses by analysing neuron activations and errors. A dedicated Rust
    module performs GPU-accelerated analysis and proposes structural candidates.
    Discovery runs typically find improvements of 0.5-3% per run that accumulate
    over many iterations.

    **Note**: Relies entirely on the
    [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) Rust
    extension library. If the library is not available, the discovery phase is
    skipped; there is no TypeScript fallback.

11. **[Visualisation](https://stsoftwareau.github.io/NEAT-AI/index.html)**

12. **Adaptive Mutation Rate**: Automatically adjusts mutation strategy based on
    creature size - large creatures focus on weight/bias modification rather
    than topology expansion.

13. **Adaptive Mutation Rate Based on Fitness Progress**: Mutation rate is
    automatically adjusted based on whether evolution is improving, stagnating,
    or stable, helping balance exploration and exploitation.

14. **Continuous Incremental Discovery**: For distributed, multi-machine
    discovery workflows that accumulate small improvements over time, see the
    [Discovery Guide](./docs/DISCOVERY_GUIDE.md).

## Quick Start

```typescript
// Single discovery iteration
const result = await creature.discoveryDir(dataDir, {
  discoveryRecordTimeOutMinutes: 1,
  discoveryAnalysisTimeoutMinutes: 10,
});

if (result.improvement) {
  console.log(`Found ${result.improvement.changeType} improvement!`);
  // Use improved creature for next iteration
}
```

## Usage

This project is designed to be used in a DenoJS environment. Please refer to the
[DenoJS documentation](https://deno.land/manual) for setup and usage
instructions.

## Documentation

For detailed documentation, see the [docs/](./docs/) directory:

- **[AGENTS.md](./AGENTS.md)**: Coding conventions, terminology, and development
  guidelines
- **[COMPARISON.md](./COMPARISON.md)**: How NEAT compares to traditional neural
  networks, CNNs, RNNs, and modern LLMs
- **[Discovery Guide](./docs/DISCOVERY_GUIDE.md)**: Complete guide to
  distributed, multi-machine discovery workflows, including failure/success
  caches, replay, candidate category limits, focus overrides, and the
  cost-of-growth gate
- **[DiscoveryDir API](./docs/DiscoveryDir.md)**: Technical API reference for
  `Creature.discoveryDir()` and data preparation
- **[Elastic back propagation](./docs/BACKPROP_ELASTICITY.md)**: Why we prefer
  minimum-change weight updates and avoid pushing saturated squashes further
  into saturation
- **[GPU Acceleration](./docs/GPU_ACCELERATION.md)**: GPU acceleration for
  discovery on macOS using Metal
- **[Intelligent Design](./docs/INTELLIGENT_DESIGN.md)**: Systematic squash
  function optimisation for hidden neurons
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)**: Common issues and solutions
  for WASM, discovery, memory, CI, and configuration

## Contributions

Contributions are welcome. Please submit a pull request or open an issue to
discuss potential changes/additions.

## License

This project is licensed under the terms of the Apache License 2.0. For the full
license text, please see [LICENSE](./LICENSE)

[![Built with the Deno Standard Library](https://raw.githubusercontent.com/denoland/deno_std/main/badge.svg)](https://deno.land/std)

[![codecov](https://codecov.io/github/stSoftwareAU/NEAT-AI/graph/badge.svg?token=DZ3R9KJGKB)](https://codecov.io/github/stSoftwareAU/NEAT-AI)
