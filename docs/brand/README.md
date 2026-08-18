# 🎨 NEAT-AI brand

Shared visual identity for the NEAT-AI repository family. This directory is the
**canonical home** for the family's brand assets — they live in the hub
repository so every sibling repo pulls from one source instead of a copy.

Previously these files lived in
[NEAT-AI-Lamarck](https://github.com/stSoftwareAU/NEAT-AI-Lamarck) (the repo
that produced them); they moved here under NEAT-AI-Lamarck Issue #149.

## Social previews

**1280×640** previews live in [`social-previews/`](social-previews/). Each repo
keeps the same organic lockup (the signed-off neuron standing in for the first
**A**, teal/coral synapses wrapping the wordmark, capability pills) and adds a
subtitle, a one-line descriptor, and a small motif so siblings stay
recognisable as one family. The per-repo catalogue is in
[`social-previews/README.md`](social-previews/README.md).

Two variants of every preview ship (Issue #3764):

| Variant                        | Use                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social-previews/*.png`        | **Canonical.** Transparent background — README headers, docs, slides, and anything that follows the reader's light/dark mode.                            |
| `social-previews/opaque/*.png` | GitHub's **Settings → General → Social preview** upload slot, which composites uploads onto its own chrome. Same artwork, flattened onto the brand navy. |

The transparent set draws dark ink under a white halo, so the lockup reads on a
white page (the halo disappears) and on a dark one (the halo outlines the ink).
Uploading a preview into a repository's Social-preview slot is a manual step —
the API does not expose it.

## Transparent mark

[`neat-ai-social-organic-alt-transparent.png`](neat-ai-social-organic-alt-transparent.png)
is a transparent PNG of the organic hero, kept for compositing outside the
preview canvas.

## Regenerating the set

Every preview is generated — no hand-tweaked bitmaps:

```bash
deno run -A scripts/brand/render_social_previews.ts
```

- [`scripts/brand/preview_specs.ts`](../../scripts/brand/preview_specs.ts) — one
  row per PNG: subtitle, descriptor, motif.
- [`scripts/brand/preview_art.ts`](../../scripts/brand/preview_art.ts) — the
  shared neuron-A lockup and the two palettes.
- [`scripts/brand/preview_motifs.ts`](../../scripts/brand/preview_motifs.ts) —
  the per-repo motifs.
- [`docs/brand/templates/neuron-a.svg`](templates/neuron-a.svg) — the signed-off
  starting SVG; [`neuron-a-mark.png`](templates/neuron-a-mark.png) is the organic
  A embedded in every preview.

The renderer rasterises with `@resvg/resvg-js` (a developer tool pulled from npm
at run time, not a library dependency) and lays text out from measured glyph
extents, so re-render on a host with Helvetica or DejaVu Sans available.

## Adding or changing an asset

`test/docs/BrandAssets.ts` and `test/docs/BrandTransparency.ts` guard the set
behaviourally: the catalogue and the directory must list the same files, every
preview must be 1280×640, the canonical set must really be transparent, every
preview must have an opaque upload variant, and the links in these two documents
must resolve. Add the image **and** its catalogue row in the same change.
