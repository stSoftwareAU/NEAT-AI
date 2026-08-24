# NEAT-AI family social previews

1280×640 previews with **transparent** backgrounds, so the artwork works in
light and dark modes alike. Same organic neuron-A family lockup; each repo adds
its own subtitle, one-line descriptor, and motif.

Hand-authored masters that are larger than the GitHub canvas live in
[`source/`](source/). They stay at native resolution. Fit them onto 1280×640
(contain, centred, transparent pad), rebuild the opaque twins, and write
[`github/`](github/) JPEGs under 1 MB with:

```bash
deno run -A scripts/brand/scale_social_previews.ts
```

After changing only the fitted opaque PNGs, rebuild the GitHub set without
touching `source/`:

```bash
deno run -A scripts/brand/scale_social_previews.ts --github-only
```

| File                          | Repo                                                                               | Subtitle        | Motif                   |
| ----------------------------- | ---------------------------------------------------------------------------------- | --------------- | ----------------------- |
| `neat-ai.png`                 | [NEAT-AI](https://github.com/stSoftwareAU/NEAT-AI)                                 | NeuroEvolution  | Hub — neuron A          |
| `neat-ai-core.png`            | [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core)                       | core            | Gear                    |
| `neat-ai-discovery.png`       | [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)             | Discovery       | Magnifier on a new node |
| `neat-ai-scorer.png`          | [NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer)                   | scorer          | Bar chart with a tick   |
| `neat-ai-backpropagation.png` | [NEAT-AI-Backpropagation](https://github.com/stSoftwareAU/NEAT-AI-Backpropagation) | Backpropagation | Reverse gradient arrows |
| `neat-ai-lamarck.png`         | [NEAT-AI-Lamarck](https://github.com/stSoftwareAU/NEAT-AI-Lamarck)                 | Lamarck         | Giraffe eating a leaf   |
| `neat-ai-explore.png`         | [NEAT-AI-Explore](https://github.com/stSoftwareAU/NEAT-AI-Explore)                 | Explore         | Telescope               |
| `neat-ai-snapshot.png`        | [NEAT-AI-Snapshot](https://github.com/stSoftwareAU/NEAT-AI-Snapshot)               | Snapshot        | Camera                  |
| `neat-ai-examples.png`        | [NEAT-AI-Examples](https://github.com/stSoftwareAU/NEAT-AI-Examples)               | Examples        | Notebook                |
| `neat-ai-forests.png`         | [NEAT-AI-Forests](https://github.com/stSoftwareAU/NEAT-AI-Forests)                 | Forests         | Decision-tree forest    |
| `neat-ai-ockham.png`          | [NEAT-AI-Ockham](https://github.com/stSoftwareAU/NEAT-AI-Ockham)                   | Ockham          | Pruning shears          |

`opaque/` holds the same eleven images flattened onto the brand navy. `github/`
holds the same eleven as 1280×640 JPEGs, each smaller than 1 MB. Upload
**those** via each repo → Settings → General → Social preview; GitHub composites
the upload onto its own chrome and rejects files of 1 MB or larger.

See the [brand overview](../README.md) for the palettes, the regeneration
command, and the rules for adding an asset.
