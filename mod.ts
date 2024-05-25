/**
 * Helpers for working with the AI
 *
 * This module provides various utilities and classes to facilitate the development,
 * manipulation, and evolution of AI entities within the NEAT (NeuroEvolution of Augmenting Topologies) framework.
 *
 * @module
 */

/**
 * Creature Class
 *
 * This class represents an AI entity in the system. It encapsulates the neural network and its associated behaviors.
 *
 * @see {@link module:src/Creature}
 */
export { Creature } from "./src/Creature.ts";

/**
 * Creature Interfaces
 *
 * These types define the structure of data used for exporting and tracing Creature instances.
 *
 * @see {@link module:src/architecture/CreatureInterfaces}
 */
export type {
  CreatureExport,
  CreatureTrace,
} from "./src/architecture/CreatureInterfaces.ts";

/**
 * Creature Utilities
 *
 * This utility class provides additional functions and helpers for manipulating and working with Creature instances.
 *
 * @see {@link module:src/architecture/CreatureUtils}
 */
export { CreatureUtil } from "./src/architecture/CreatureUtils.ts";

/**
 * NEAT Options
 *
 * This type defines the configuration options available for setting up the NEAT algorithm.
 *
 * @see {@link module:src/config/NeatOptions}
 */
export type { NeatOptions } from "./src/config/NeatOptions.ts";

/**
 * Selection Class
 *
 * This class handles the selection process within the NEAT algorithm, responsible for selecting the fittest individuals for reproduction.
 *
 * @see {@link module:src/methods/Selection}
 */
export { Selection } from "./src/methods/Selection.ts";

/**
 * Mutation Class
 *
 * This class manages the mutation processes within the NEAT algorithm, allowing for genetic variations in the population.
 *
 * @see {@link module:src/methods/mutation}
 */
export { Mutation } from "./src/methods/mutation.ts";

/**
 * CRISPR Class
 *
 * This class provides methods for targeted genetic modifications, inspired by the CRISPR gene-editing technology.
 *
 * @see {@link module:src/reconstruct/CRISPR}
 */
export { CRISPR } from "./src/reconstruct/CRISPR.ts";

/**
 * Upgrade Class
 *
 * This class facilitates the process of upgrading and evolving AI entities, ensuring the continued improvement of the population.
 *
 * @see {@link module:src/reconstruct/Upgrade}
 */
export { Upgrade } from "./src/reconstruct/Upgrade.ts";
