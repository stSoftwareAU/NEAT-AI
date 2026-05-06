# 📚 NEAT-AI Documentation Index

Welcome to the NEAT-AI documentation. This page is the topic-by-topic table of
contents — every long-form guide in the repository has a home here.

If you have not used NEAT-AI before, follow the **Where to start** reading path
below; it walks from a zero-knowledge introduction through to the topic guides
you are most likely to need next.

## 🧭 Where to start

A new reader should follow the docs in this order:

1. **[../README.md](../README.md)** — zero-knowledge entry point. Explains what
   NEAT-AI is, the major features, and gives a working example.
2. **[../AGENTS.md](../AGENTS.md)** — terminology and coding conventions. Read
   this if any of the playful names (Creature, Discovery, CRISPR, Grafting,
   MCMC) are unfamiliar.
3. **[../CONTRIBUTING.md](../CONTRIBUTING.md)** — development setup, how to run
   the quality gate, and how to bump the pinned NEAT-AI-core dependency.
4. **This page (`docs/README.md`)** — pick a topic guide below for the feature
   you want to use.
5. **A topic guide** — each guide assumes the basics from steps 1–3 and focuses
   on a single subsystem.

## 🗺️ Reading map

```mermaid
flowchart LR
    R[../README.md<br/>zero-knowledge entry] --> I[docs/README.md<br/>topic index]
    I --> Compute[Compute / WASM]
    I --> Discovery[Discovery / FFI]
    I --> Perf[Performance]
    I --> Ref[Reference]
    I --> Spec[Specialised]
    I --> Gov[Governance]
```

## ⚡ Compute / WebAssembly (WASM)

Activation, gradient flow, and the GPU/WASM compute layer.

- **[ACTIVATION_FUNCTIONS.md](ACTIVATION_FUNCTIONS.md)** — selection guide for
  the 30+ built-in squash functions, with notes on when each is a good fit.
- **[BACKPROP_ELASTICITY.md](BACKPROP_ELASTICITY.md)** — why NEAT-AI prefers
  minimum-change weight updates and how it avoids pushing saturated activations
  further into saturation.
- **[GPU_ACCELERATION.md](GPU_ACCELERATION.md)** — Metal/Vulkan/DX12
  acceleration via `wgpu`, with a CPU fallback.
- **[WASM_RESIDENT_TOPOLOGY.md](WASM_RESIDENT_TOPOLOGY.md)** — feasibility
  analysis for keeping the entire creature topology resident inside the WASM
  module.

## 🧬 Discovery / FFI (Foreign Function Interface)

Error-guided structural evolution backed by the Rust extension.

- **[DISCOVERY_GUIDE.md](DISCOVERY_GUIDE.md)** — end-to-end walkthrough of
  distributed, multi-machine discovery: caches, replay, candidate category
  limits, focus overrides, and the cost-of-growth gate.
- **[DISCOVERY_DIR.md](DISCOVERY_DIR.md)** — technical API reference for
  `Creature.discoveryDir()` and the shape of the data directory it consumes.
- **[DISCOVERY_ARCHITECTURE.md](DISCOVERY_ARCHITECTURE.md)** — internal
  architecture of the discovery pipeline: pulse generation, candidate proposals,
  success/failure caches, and the FFI handshake.

## 🚀 Performance

Tuning guides and benchmark research.

- **[PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md)** — operational tuning: WASM
  caches, thread pools, memory management, and scaling for large-scale training.
- **[PERFORMANCE_RESEARCH.md](PERFORMANCE_RESEARCH.md)** — research notes and
  migration learnings from the WASM transition.
- **[PREDICTIVE_CODING_BENCHMARKS.md](PREDICTIVE_CODING_BENCHMARKS.md)** —
  benchmark results for the predictive-coding training mode.

## 📖 Reference

Drop-in API and configuration material.

- **[API_REFERENCE.md](API_REFERENCE.md)** — comprehensive public API
  documentation.
- **[CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md)** — topic index for the
  configuration surface. The detail docs under [`config/`](config/) cover
  presets, core evolution, training, discovery, mutation adaptation,
  regularisation, population sizing, workers, logging, and recipes.
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — FAQ-style index of common
  problems. The detail docs under [`troubleshooting/`](troubleshooting/) cover
  WASM, discovery / FFI, memory, performance, training divergence, CI /
  quality.sh, configuration, and ONNX export.

## 🧪 Specialised topics

Subsystems that only some users need.

- **[CRISPR_GUIDE.md](CRISPR_GUIDE.md)** — CRISPR (Clustered Regularly
  Interspaced Short Palindromic Repeats) gene-edit conventions, the
  append+demote pattern, and validation rules.
- **[INTELLIGENT_DESIGN.md](INTELLIGENT_DESIGN.md)** — systematic per-neuron
  squash optimisation.
- **[PREDICTIVE_CODING.md](PREDICTIVE_CODING.md)** — neuroscience-inspired
  predictive-coding training mode.
- **[dna-sharing-bake-off-results.md](dna-sharing-bake-off-results.md)** —
  bake-off comparison of inter-island DNA-sharing primitives (Issue #2496).

## 🏛️ Governance and core dependency

Project-level policies, audits, and release plumbing.

- **[../AGENTS.md](../AGENTS.md)** — coding guidelines for human and AI
  contributors (terminology, invariants, testing rules).
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** — first-time contributor guide.
- **[../SECURITY.md](../SECURITY.md)** — security disclosure policy.
- **[../CHANGELOG.md](../CHANGELOG.md)** — release notes.
- **[EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md)** — 🧭 cluster overview
  for the NEAT-AI-core dependency. Day-to-day workflow for bumping the pinned
  revision, plus links to every detail doc below.
- **[CORE_DEPENDENCY_POLICY.md](CORE_DEPENDENCY_POLICY.md)** — how NEAT-AI pins
  and consumes [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) via
  `deno.json` + `build.sh` (rev pinning, semver, approval tiers).
- **[CI_EXTERNAL_NEAT_AI_CORE.md](CI_EXTERNAL_NEAT_AI_CORE.md)** — CI plumbing
  for `build.sh`-driven artefact sync.
- **[PARITY_GATE.md](PARITY_GATE.md)** — release checklist run after every repin
  to verify TypeScript ↔ WASM parity.
- **[PARITY_AUDITS.md](PARITY_AUDITS.md)** — archived parity audits (Issues
  #2367, #2368, #2369) consolidated into a single page. Replaces three former
  stubs.
- **[TS_RUST_MIGRATION.md](TS_RUST_MIGRATION.md)** — TypeScript → Rust migration
  milestone roadmap.

## 🔍 Comparison with other approaches

- **[../COMPARISON.md](../COMPARISON.md)** — how NEAT compares to traditional
  neural networks, CNNs (Convolutional Neural Networks), RNNs (Recurrent Neural
  Networks), and modern LLMs (Large Language Models). Owned by Issue #2563 and
  excluded from the index refresh.

## 🚫 Out of scope for this index

The following artefacts live under `docs/` but intentionally are **not** indexed
above:

- **`pr-summary-*.md`** — per-PR summary files. They are write-once release
  notes for a single change, not topic documentation. Browse them via `git log`
  or the merged PR.
- **`archive/`** — historical material kept for context (e.g. archived PR
  summaries). Read on demand, not as part of the topic flow.
- **`evidence/`** — captured artefacts referenced by individual PR summaries
  (logs, screenshots, repro scripts).
- **`research/`** — experimental research notes (e.g. DeepSeek applicability
  surveys) that pre-date or sit outside the production roadmap.
- **`models/`** — sample exported creature JSON used by the visualisation app.
- **`visualize/`, `index.html`, `index.js`, `server.ts`,
  `snapshot-schema.json`** — assets for the GitHub Pages visualisation app, not
  prose documentation.
- **`issue-*-*.md`** — per-issue investigation notes (e.g.
  `issue-2418-training-bin-stream-investigation.md`). They record a closed line
  of work and graduate into a topic doc only if the work becomes a long-lived
  feature.
- **`logo.png`, `cspell.json`** — brand asset and spell-check dictionary.
