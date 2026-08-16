/**
 * Issue #3764 — the catalogue the family social previews are rendered from.
 *
 * One row per committed PNG in `docs/brand/social-previews/`. The file name,
 * the subtitle, and the one-line descriptor are the only things that differ
 * between siblings; everything else comes from the shared lockup.
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
  /** Seed for the dendrite tree — same seed, same tree, every render. */
  seed: number;
}

export const PREVIEW_SPECS: PreviewSpec[] = [
  {
    file: "neat-ai.png",
    subtitle: "NeuroEvolution",
    descriptor: "Evolving neural networks in Deno and TypeScript",
    motif: null,
    seed: 3764,
  },
  {
    file: "neat-ai-organic-approved.png",
    subtitle: "NeuroEvolution",
    descriptor: "Organic hero lockup — alternate hub mark",
    motif: null,
    seed: 149,
  },
  {
    file: "neat-ai-core.png",
    subtitle: "core",
    descriptor: "Shared Rust compute crate, vendored as WASM",
    motif: "gear",
    seed: 21,
  },
  {
    file: "neat-ai-discovery.png",
    subtitle: "Discovery",
    descriptor: "Rust FFI extension for structural analysis",
    motif: "magnifier",
    seed: 34,
  },
  {
    file: "neat-ai-scorer.png",
    subtitle: "scorer",
    descriptor: "Rust scoring application for creature fitness",
    motif: "bars",
    seed: 55,
  },
  {
    file: "neat-ai-backpropagation.png",
    subtitle: "Backpropagation",
    descriptor: "Gradient training for evolved topologies",
    motif: "arrows",
    seed: 89,
  },
  {
    file: "neat-ai-lamarck.png",
    subtitle: "Lamarck",
    descriptor: "Learned traits passed to the next generation",
    motif: "giraffe",
    seed: 144,
  },
  {
    file: "neat-ai-explore.png",
    subtitle: "Explore",
    descriptor: "Visualise creature topology and behaviour",
    motif: "telescope",
    seed: 233,
  },
  {
    file: "neat-ai-snapshot.png",
    subtitle: "Snapshot",
    descriptor: "Portable snapshots shared between machines",
    motif: "camera",
    seed: 377,
  },
  {
    file: "neat-ai-examples.png",
    subtitle: "Examples",
    descriptor: "Worked TypeScript projects you can run today",
    motif: "notebook",
    seed: 610,
  },
];
