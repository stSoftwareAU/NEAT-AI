/**
 * Alternative squash (activation) functions for Intelligent Design neuron substitution.
 *
 * These functions are categorised by their typical success rate when substituting
 * existing squash functions in hidden neurons during squash improvement scans.
 *
 * @module
 */

/**
 * List of alternative squash functions to try during Intelligent Design.
 *
 * Tier 1 - Core workhorses with high success rate
 * Tier 2 - Complementary functions providing useful variety
 * Tier 3 - Specialised or edge cases that may help in isolation
 */
export const alternativeSquashes = [
  // Tier 1 – Core Workhorses (High Success Rate)
  "GELU", // Best overall performer when precision matters
  "Swish", // Also excellent; slightly less sharp than GELU
  "LeakyReLU", // Strong default fallback, especially early in training
  "Mish", // Sometimes outperforms Swish, especially in noise-tolerant tasks
  "SELU", // Adds normalisation without additional layers
  "ELU", // Similar to SELU, slightly less aggressive
  "TANH", // Reliable and bounded — good for stability

  // Tier 2 – Complementary Functions (Useful Variety)
  "LOGISTIC", // Classic sigmoid, good in moderation
  "Softplus", // Smooth ReLU, useful for stable growth
  "ArcTan", // Centred and bounded
  "SOFTSIGN", // Smooth alternative to Tanh, lighter saturation
  "HARD_TANH", // Bounded and fast, approximates Tanh
  "BENT_IDENTITY", // Mostly identity, gently nonlinear

  // Tier 3 – Specialised / Edge Cases (May Help in Isolation)
  "SINE", // Oscillatory — useful for encoding periodicity
  "Cosine", // Slightly offset phase vs SINE — allows coordination
  "ABSOLUTE", // Sharp boundaries, useful in niche detection cases
  "Cube", // Extreme gradient amplifier, mostly useful in last-layer neurons
  "ISRU", // Variant of Tanh with parameterised curve
  "LogSigmoid", // Flatter version of Logistic — helps avoid early saturation
  "GAUSSIAN", // Local activator — works like a localised attention gate
];

/**
 * Squashes that are generally not recommended for substitution.
 *
 * These are commented out from the main list but documented here
 * for reference:
 * - ReLU: Redundant with LeakyReLU and not differentiable at zero
 * - BIPOLAR: Rarely beneficial, often erratic behaviour
 * - BIPOLAR_SIGMOID: Rarely beneficial, often erratic behaviour
 * - MINIMUM: Non-differentiable, not useful in neuron isolation
 * - ReLU6: Meant for mobile efficiency; little gain over better alternatives
 * - Exponential: Exploding outputs, unstable learning
 * - STEP: Non-differentiable, makes gradient-based evolution brittle
 * - TAN: Unbounded with periodic discontinuities, high instability
 * - COMPLEMENT: Rarely helpful unless specifically needed for binary logic
 * - StdInverse: Obscure, niche application — generally unstable
 * - IDENTITY: Neutral; generally wastes a neuron slot in NEAT-style evolution
 * - IF: Non-differentiable, discrete logic unsuitable for smooth fitness landscape
 * - HYPOT/HYPOTv2: Deprecated
 * - MAXIMUM: Non-differentiable, not useful in neuron isolation
 */
