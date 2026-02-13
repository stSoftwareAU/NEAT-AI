/**
 * Global type declarations for NEAT-AI.
 *
 * These augment the global scope so that custom globals can be accessed
 * without unsafe `as any` or `as unknown` casts.
 *
 * @module
 */

declare global {
  var __NEAT_AI_SKIP_WASM_AUTO_INIT: boolean | undefined;

  var DEBUG: boolean | undefined;
}

// Required to make this a module augmentation rather than a script.
export {};
