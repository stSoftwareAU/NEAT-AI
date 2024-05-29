# NEAT Neural Network for DenoJS

<p align="left">
  <img width="100" height="100" src="docs/logo.png" align="right">
This project is a unique implementation of a neural network based on the NEAT (NeuroEvolution of Augmenting Topologies) algorithm, written in DenoJS using TypeScript.
</p>

## Feature Highlights

1. **Extendable Observations**: The observations can be extended over time as the indexing is done via UUIDs, not numbers. This prevents the need to restart the evolution process as new observations are added, providing flexibility and scalability.

2. **Distributed Training**: Training and evolution can be run on multiple independent nodes. The best-of-breed creatures can later be combined on a centralized controller node. This feature allows for distributed computing and potentially faster training times, enhancing the efficiency of the learning process.

3. **Life Long Learning**: Unlike many pre-trained neural networks, this project is designed for continuous learning, making it adaptable and potentially more effective in changing environments. This feature ensures the model remains relevant and accurate over time.

4. **Efficient Model Utilization**: Once trained, the current best model can be utilized efficiently by calling the `activate` function. This allows for quick and easy deployment of the trained model.

5. **Unique Squash Functions**: The neural network supports unique squash functions such as IF, MEAN, MAX, MIN, and HYPOT. These functions provide more options for the activation function, which can lead to different network behaviours, offering a wider range of potential solutions. More about [Activation Functions](https://en.wikipedia.org/wiki/Activation_function).

6. **Neuron Pruning**: Neurons whose activations don't vary during training are removed, and the biases in the associated neurons are adjusted. This feature optimizes the network by reducing redundancy and computational load. More about [Pruning (Neural Networks)](https://en.wikipedia.org/wiki/Pruning_(neural_networks)).

7. **CRISPR**: Allows injection of genes into a population of creatures during evolution. This feature can introduce new traits and potentially improve the performance of the population. More about [CRISPR](https://en.wikipedia.org/wiki/CRISPR).

8. **[Visualization](https://stsoftwareau.github.io/NEAT-AI/visualize.html)**

## Usage

This project is designed to be used in a DenoJS environment. Please refer to the [DenoJS documentation](https://deno.land/manual) for setup and usage instructions.

## Contributions

Contributions are welcome. Please submit a pull request or open an issue to discuss potential changes/additions.

## License

This project is licensed under the terms of the Apache License 2.0. For the full license text, please see [LICENSE](./LICENSE).

[![Built with the Deno Standard Library](https://raw.githubusercontent.com/denoland/deno_std/main/badge.svg)](https://deno.land/std)
