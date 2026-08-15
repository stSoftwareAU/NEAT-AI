# 🎨 NEAT-AI brand

Shared visual identity for the NEAT-AI repository family. This directory is the
**canonical home** for the family's brand assets — they live in the hub
repository so every sibling repo pulls from one source instead of a copy.

Previously these files lived in
[NEAT-AI-Lamarck](https://github.com/stSoftwareAU/NEAT-AI-Lamarck) (the repo
that produced them); they moved here under NEAT-AI-Lamarck Issue #149.

## Social previews

Opaque **1280×640** GitHub Social preview images live in
[`social-previews/`](social-previews/). Each repo keeps the same organic lockup
(smiley-neuron **A**, teal/coral topology, family pills) and adds a small motif
plus subtitle so siblings stay recognisable as one family. The per-repo
catalogue is in [`social-previews/README.md`](social-previews/README.md).

Upload via **Settings → General → Social preview** on each repository.

## Transparent mark

[`neat-ai-social-organic-alt-transparent.png`](neat-ai-social-organic-alt-transparent.png)
is a transparent PNG of the organic hero for light/dark compositing outside
GitHub's social preview (README headers, slides, and the like). Prefer the
opaque previews for GitHub Social — transparent dark text disappears on the dark
preview chrome.

## Adding or changing an asset

`test/docs/BrandAssets.ts` guards the set behaviourally: the catalogue and the
directory must list the same files, every social preview must be 1280×640, and
the links in these two documents must resolve. Add the image **and** its
catalogue row in the same change.
