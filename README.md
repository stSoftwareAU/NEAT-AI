# NEAT Neural Network for DenoJS

<p align="left">
  <img width="100" height="100" src="www/logo.png" align="right">
This project is a unique implementation of a neural network based on the NEAT (NeuroEvolution of Augmenting Topologies) algorithm, written in DenoJS using TypeScript. 
</p>

## Unique Features

1. **Extendable Observations**: The observations can be extended over time as the indexing is done via UUIDs, not numbers. This allows for a more flexible and dynamic neural network structure.

2. **Distributed Training**: Training and evolution can be run on multiple independent nodes. The best-of-breed creatures can later be combined on a centralized master node. This feature allows for distributed computing and potentially faster training times.

3. **Life Long Learning**: Unlike many pre-trained neural networks, this project is designed for continuous learning, making it adaptable and potentially more effective in changing environments.

4. **Efficient Model Utilization**: Once trained, the current best model can be utilized efficiently by calling the `activate` function.

5. **Unique Squash Functions**: The neural network supports unique squash functions such as IF, MEAN, MAX, MIN, and HYPOT. These functions provide more options for the activation function, which can lead to different network behaviours.

## Usage

This project is designed to be used in a DenoJS environment. Please refer to the DenoJS documentation for setup and usage instructions.

## Contributions

Contributions are welcome. Please submit a pull request or open an issue to discuss potential changes/additions.

[![Built with the Deno Standard Library](https://raw.githubusercontent.com/denoland/deno_std/main/badge.svg)](https://deno.land/std)