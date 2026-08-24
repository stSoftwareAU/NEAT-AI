/**
 * The catalogue the family social previews are rendered from.
 *
 * One row per committed PNG in `docs/brand/social-previews/`. The file name,
 * the subtitle, and the one-line descriptor are the only things that differ
 * between siblings; everything else comes from the shared neuron-A lockup.
 */

import type { MotifId } from "./preview_motifs.ts";

export interface PreviewSpec {
  /** File name under `docs/brand/social-previews/`. */
  file: string;
  /** Sub-project name, set large under the wordmark. */
  subtitle: string;
  /** One line saying what the sub-project does. */
  descriptor: string;
  /** Motif hinting at the sub-project's role, or null for the hub marks. */
  motif: MotifId | null;
}

export const PREVIEW_SPECS: PreviewSpec[] = [
  {
    file: "neat-ai.png",
    subtitle: "NeuroEvolution",
    descriptor: "Evolving neural networks in Deno and TypeScript",
    motif: null,
  },
  {
    file: "neat-ai-core.png",
    subtitle: "core",
    descriptor: "Shared Rust compute crate, vendored as WASM",
    motif: "gear",
  },
  {
    file: "neat-ai-discovery.png",
    subtitle: "Discovery",
    descriptor: "Rust FFI extension for structural analysis",
    motif: "magnifier",
  },
  {
    file: "neat-ai-scorer.png",
    subtitle: "scorer",
    descriptor: "Rust scoring application for creature fitness",
    motif: "bars",
  },
  {
    file: "neat-ai-backpropagation.png",
    subtitle: "Backpropagation",
    descriptor: "Gradient training for evolved topologies",
    motif: "arrows",
  },
  {
    file: "neat-ai-lamarck.png",
    subtitle: "Lamarck",
    descriptor: "Learned traits passed to the next generation",
    motif: "giraffe",
  },
  {
    file: "neat-ai-explore.png",
    subtitle: "Explore",
    descriptor: "Visualise creature topology and behaviour",
    motif: "telescope",
  },
  {
    file: "neat-ai-snapshot.png",
    subtitle: "Snapshot",
    descriptor: "Portable snapshots shared between machines",
    motif: "camera",
  },
  {
    file: "neat-ai-examples.png",
    subtitle: "Examples",
    descriptor: "Worked TypeScript projects you can run today",
    motif: "notebook",
  },
  {
    file: "neat-ai-forests.png",
    subtitle: "Forests",
    descriptor: "Decision-tree tricks for faster evolutionary discovery",
    motif: null,
  },
  {
    file: "neat-ai-ockham.png",
    subtitle: "Ockham",
    descriptor: "Prune structure that no longer earns its keep",
    motif: null,
  },
];
