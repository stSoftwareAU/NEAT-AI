/**
 * Issue #3764 / #3781 — the NEAT-AI family social previews, drawn as SVG.
 *
 * The family look lives here once: a friendly round smiley-neuron standing in
 * for the "A" of NEAT-AI, dendrite trunks growing out of that cell body, the
 * teal/coral dendrite tree, the sub-project subtitle, and the shared capability
 * pills. Every sibling preview is the same lockup with its own subtitle,
 * descriptor, and motif, so the ten images stay recognisably one family instead
 * of ten hand-tweaked drawings.
 *
 * Two palettes render the same artwork:
 *
 * - `transparent` — the canonical committed set. No background; dark ink with
 *   a white halo so the lockup reads on both light and dark pages.
 * - `opaque` — flattened onto the brand navy for GitHub's Social preview slot,
 *   which composites uploads onto its own dark chrome.
 */

import { motifSvg } from "./preview_motifs.ts";
import type { PreviewSpec } from "./preview_specs.ts";

/** GitHub's social preview canvas. */
export const PREVIEW_WIDTH = 1280;
export const PREVIEW_HEIGHT = 640;

/** Measured extent of a text run, in user units. */
export interface TextExtent {
  width: number;
  height: number;
}

/** Measures a text run rendered with the family font stack. */
export type TextMeasure = (
  text: string,
  fontSize: number,
  fontWeight: number,
) => TextExtent;

export type ThemeName = "transparent" | "opaque";

export interface Palette {
  /** Full-canvas background, or null to leave the canvas transparent. */
  background: string | null;
  /** Wordmark and descriptor fill. */
  ink: string;
  /** Outline drawn under ink and artwork so both read against any page. */
  halo: string;
  teal: string;
  tealDeep: string;
  coral: string;
  subtitle: string;
}

const PALETTES: Record<ThemeName, Palette> = {
  transparent: {
    background: null,
    ink: "#0F172A",
    halo: "#FFFFFF",
    teal: "#14B8A6",
    tealDeep: "#0D9488",
    coral: "#F2705F",
    subtitle: "#0D9488",
  },
  opaque: {
    background: "#0B1220",
    ink: "#F8FAFC",
    halo: "#0B1220",
    teal: "#2DD4BF",
    tealDeep: "#14B8A6",
    coral: "#F2705F",
    subtitle: "#2DD4BF",
  },
};

export function paletteFor(theme: ThemeName): Palette {
  return PALETTES[theme];
}

/** Font stack shared by every text run — measured and drawn identically. */
export const FONT_STACK =
  "'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', 'Liberation Sans', sans-serif";

/** Eyes and smile stay dark on the teal soma in both palettes. */
const SOMA_DETAIL = "#0B1220";
/** Pill labels stay white in both palettes — pill fills are always opaque. */
const PILL_LABEL = "#FFFFFF";

const WORDMARK_SIZE = 146;
const WORDMARK_WEIGHT = 800;
const SUBTITLE_SIZE = 64;
const DESCRIPTOR_SIZE = 26;
const PILL_LABEL_SIZE = 26;

const SOMA_CENTRE_Y = 244;
const SUBTITLE_BASELINE = 448;
const DESCRIPTOR_BASELINE = 494;
const PILL_ROW_CENTRE_Y = 564;

/**
 * The band the dendrite tree may occupy: inside the canvas, and clear of the
 * subtitle below. The tree is scaled to fit rather than clipped, so tuning a
 * branch longer can never push a tip off the canvas.
 */
const TREE_BOX = { left: 44, right: 1236, top: 46, bottom: 396 };

/** Round to two decimals — smaller files, byte-identical re-renders. */
function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/** Escape the five XML entities so labels cannot break the document. */
export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Deterministic PRNG, so a given preview always renders the same tree. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TextOptions {
  size: number;
  weight: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  haloWidth?: number;
}

/** A text run drawn twice: halo stroke underneath, fill on top. */
function textRun(
  x: number,
  y: number,
  content: string,
  palette: Palette,
  options: TextOptions,
): string {
  const anchor = options.anchor ?? "start";
  const common = `x="${n(x)}" y="${n(y)}" font-family="${FONT_STACK}" ` +
    `font-size="${options.size}" font-weight="${options.weight}" ` +
    `text-anchor="${anchor}"`;
  const escaped = xmlEscape(content);
  const halo = options.haloWidth ?? 0;
  const haloRun = halo > 0
    ? `<text ${common} fill="${palette.halo}" stroke="${palette.halo}" ` +
      `stroke-width="${halo}" stroke-linejoin="round">${escaped}</text>`
    : "";
  return `${haloRun}<text ${common} fill="${options.fill}">${escaped}</text>`;
}

interface Segment {
  d: string;
  colour: string;
  width: number;
}

interface Dot {
  x: number;
  y: number;
  r: number;
  colour: string;
}

interface Primary {
  angle: number;
  length: number;
  depth: number;
  coral: boolean;
}

/**
 * Primary dendrites, in SVG degrees (0 = right, 90 = down). The upward fan
 * sits above the wordmark; the two lateral pairs sweep out below it, the way
 * the original organic hero does.
 */
const PRIMARIES: Primary[] = [
  { angle: -172, length: 190, depth: 2, coral: false },
  { angle: -148, length: 160, depth: 2, coral: false },
  { angle: -119, length: 95, depth: 1, coral: false },
  { angle: -95, length: 100, depth: 1, coral: false },
  { angle: -71, length: 95, depth: 1, coral: true },
  { angle: -36, length: 160, depth: 2, coral: true },
  { angle: -8, length: 190, depth: 2, coral: true },
  { angle: 166, length: 250, depth: 2, coral: false },
  { angle: 140, length: 100, depth: 1, coral: false },
  { angle: 14, length: 250, depth: 2, coral: true },
  { angle: 40, length: 100, depth: 1, coral: true },
];

/**
 * Cap how steeply a branch may point downward. Below the wordmark sits the
 * subtitle, so the tree fans sideways there instead of diving into the text.
 */
function clampDownward(angle: number): number {
  const wrapped = ((angle % 360) + 540) % 360 - 180;
  if (wrapped > 30 && wrapped <= 90) return 30;
  if (wrapped > 90 && wrapped < 150) return 150;
  return wrapped;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function widen(bounds: Bounds, x: number, y: number, pad = 0): void {
  bounds.minX = Math.min(bounds.minX, x - pad);
  bounds.maxX = Math.max(bounds.maxX, x + pad);
  bounds.minY = Math.min(bounds.minY, y - pad);
  bounds.maxY = Math.max(bounds.maxY, y + pad);
}

/** Grow one branch, recursing into a fork at its tip. */
function grow(
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
  curve: number,
  colour: string,
  random: () => number,
  segments: Segment[],
  dots: Dot[],
  bounds: Bounds,
): void {
  const radians = (angle * Math.PI) / 180;
  const endX = x + Math.cos(radians) * length;
  const endY = y + Math.sin(radians) * length;
  const midX = (x + endX) / 2;
  const midY = (y + endY) / 2;
  const bend = curve * length;
  const controlX = midX - Math.sin(radians) * bend;
  const controlY = midY + Math.cos(radians) * bend;
  segments.push({
    d: `M${n(x)} ${n(y)}Q${n(controlX)} ${n(controlY)} ${n(endX)} ${n(endY)}`,
    colour,
    width,
  });
  widen(bounds, controlX, controlY, width);

  if (depth <= 0) {
    const tip = { x: endX, y: endY, r: Math.max(6, width * 1.9), colour };
    dots.push(tip);
    widen(bounds, tip.x, tip.y, tip.r + 4);
    return;
  }
  const fork = { x: endX, y: endY, r: Math.max(4, width * 1.1), colour };
  dots.push(fork);
  widen(bounds, fork.x, fork.y, fork.r + 4);
  const spread = 24 + random() * 18;
  const nextWidth = width * 0.72;
  grow(
    endX,
    endY,
    clampDownward(angle - spread),
    length * (0.58 + random() * 0.1),
    nextWidth,
    depth - 1,
    -curve * 0.9,
    colour,
    random,
    segments,
    dots,
    bounds,
  );
  grow(
    endX,
    endY,
    clampDownward(angle + spread),
    length * (0.5 + random() * 0.12),
    nextWidth,
    depth - 1,
    curve * 0.9,
    colour,
    random,
    segments,
    dots,
    bounds,
  );
}

/**
 * Uniform scale about (cx, cy) that pulls `bounds` inside {@link TREE_BOX}.
 * Never scales up — a tree that already fits is left alone.
 */
function fitScale(bounds: Bounds, cx: number, cy: number): number {
  const limits = [
    { reach: cx - bounds.minX, room: cx - TREE_BOX.left },
    { reach: bounds.maxX - cx, room: TREE_BOX.right - cx },
    { reach: cy - bounds.minY, room: cy - TREE_BOX.top },
    { reach: bounds.maxY - cy, room: TREE_BOX.bottom - cy },
  ];
  return limits.reduce(
    (scale, limit) =>
      limit.reach > limit.room && limit.reach > 0
        ? Math.min(scale, limit.room / limit.reach)
        : scale,
    1,
  );
}

/** The dendrite tree radiating from the soma at (cx, cy). */
function dendrites(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  palette: Palette,
): string {
  const random = mulberry32(seed);
  const segments: Segment[] = [];
  const dots: Dot[] = [];
  const bounds: Bounds = { minX: cx, maxX: cx, minY: cy, maxY: cy };
  for (const primary of PRIMARIES) {
    const angle = primary.angle + (random() - 0.5) * 12;
    const radians = (angle * Math.PI) / 180;
    // Issue #3781: start under the round soma so the first segment reads as a
    // dendrite trunk leaving the cell, not a tree floating behind it.
    const startR = radius * 0.55;
    grow(
      cx + Math.cos(radians) * startR,
      cy + Math.sin(radians) * startR,
      angle,
      primary.length * (0.9 + random() * 0.2),
      13,
      primary.depth,
      (random() - 0.5) * 0.5,
      primary.coral ? palette.coral : palette.teal,
      random,
      segments,
      dots,
      bounds,
    );
  }
  const scale = fitScale(bounds, cx, cy);
  const fit = scale < 1
    ? `transform="translate(${n(cx * (1 - scale))} ${
      n(cy * (1 - scale))
    }) scale(${n(scale)})"`
    : "";

  const halo = segments
    .map((s) =>
      `<path d="${s.d}" stroke="${palette.halo}" stroke-width="${
        n(s.width + 7)
      }" fill="none" stroke-linecap="round"/>`
    )
    .join("") +
    dots
      .map((d) =>
        `<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${
          n(d.r + 3.5)
        }" fill="${palette.halo}"/>`
      )
      .join("");
  const art = segments
    .map((s) =>
      `<path d="${s.d}" stroke="${s.colour}" stroke-width="${
        n(s.width)
      }" fill="none" stroke-linecap="round"/>`
    )
    .join("") +
    dots
      .map((d) =>
        `<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${
          n(d.r)
        }" fill="${d.colour}"/>`
      )
      .join("");
  return `<g ${fit}><g>${halo}</g><g>${art}</g></g>`;
}

/**
 * The smiley soma that stands in for the "A" of NEAT-AI (Issue #3781).
 *
 * A round, friendly cell body — the neuron look comes from dendrite trunks
 * leaving this disc, not from an irregular lumpy silhouette.
 */
function soma(cx: number, cy: number, r: number, palette: Palette): string {
  const eyeR = r * 0.115;
  const eyeY = cy - r * 0.18;
  return [
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${palette.teal}" `,
    `stroke="${palette.halo}" stroke-width="7"/>`,
    `<circle cx="${n(cx - r * 0.32)}" cy="${n(eyeY)}" r="${
      n(eyeR)
    }" fill="${SOMA_DETAIL}"/>`,
    `<circle cx="${n(cx + r * 0.32)}" cy="${n(eyeY)}" r="${
      n(eyeR)
    }" fill="${SOMA_DETAIL}"/>`,
    `<path d="M${n(cx - r * 0.42)} ${n(cy + r * 0.14)}Q${n(cx)} ${
      n(cy + r * 0.66)
    } ${n(cx + r * 0.42)} ${n(cy + r * 0.14)}" fill="none" `,
    `stroke="${SOMA_DETAIL}" stroke-width="${
      n(r * 0.11)
    }" stroke-linecap="round"/>`,
  ].join("");
}

interface PillSpec {
  label: string;
  icon: string;
  tone: "teal" | "tealDeep" | "coral";
}

/** The five capability pills every family member carries. */
const PILLS: PillSpec[] = [
  { label: "Discover", icon: "compass", tone: "teal" },
  { label: "Evolve", icon: "trend", tone: "coral" },
  { label: "Score", icon: "bars", tone: "tealDeep" },
  { label: "Inherit", icon: "tree", tone: "coral" },
  { label: "Explore", icon: "peak", tone: "teal" },
];

/** A 26x26 white pill glyph, drawn from (0, 0) at its top-left. */
function pillIcon(icon: string): string {
  const stroke =
    `fill="none" stroke="${PILL_LABEL}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  switch (icon) {
    case "compass":
      return `<circle cx="13" cy="13" r="11" ${stroke}/>` +
        `<path d="M18 8 L11 11 L8 18 L15 15 Z" fill="${PILL_LABEL}"/>`;
    case "trend":
      return `<path d="M2 21 L10 12 L14.5 16.5 L23 6" ${stroke}/>` +
        `<path d="M16 5 H24 V13" ${stroke}/>`;
    case "bars":
      return `<rect x="3" y="15" width="5" height="8" rx="1.6" fill="${PILL_LABEL}"/>` +
        `<rect x="10.5" y="9" width="5" height="14" rx="1.6" fill="${PILL_LABEL}"/>` +
        `<rect x="18" y="4" width="5" height="19" rx="1.6" fill="${PILL_LABEL}"/>`;
    case "tree":
      return `<path d="M13 8 V13 M6 20 V16 H20 V20" ${stroke}/>` +
        `<circle cx="13" cy="5" r="3.4" fill="${PILL_LABEL}"/>` +
        `<circle cx="6" cy="21.5" r="3.2" fill="${PILL_LABEL}"/>` +
        `<circle cx="20" cy="21.5" r="3.2" fill="${PILL_LABEL}"/>`;
    case "peak":
      return `<path d="M2 21 L10 7 L15 15 L18 11 L24 21 Z" fill="${PILL_LABEL}"/>`;
    default:
      throw new Error(`unknown pill icon: ${icon}`);
  }
}

/** The centred pill row, sized from the measured labels. */
function pillRow(measure: TextMeasure, palette: Palette): string {
  const iconWidth = 26;
  const iconGap = 11;
  const padding = 22;
  const gap = 18;
  const height = 56;
  const widths = PILLS.map((pill) =>
    padding * 2 + iconWidth + iconGap +
    measure(pill.label, PILL_LABEL_SIZE, 700).width
  );
  const total = widths.reduce((sum, w) => sum + w, 0) +
    gap * (PILLS.length - 1);
  let x = (PREVIEW_WIDTH - total) / 2;
  const top = PILL_ROW_CENTRE_Y - height / 2;

  const parts: string[] = [];
  PILLS.forEach((pill, index) => {
    const width = widths[index];
    const fill = palette[pill.tone];
    parts.push(
      `<rect x="${n(x)}" y="${n(top)}" width="${
        n(width)
      }" height="${height}" ` +
        `rx="${height / 2}" fill="${fill}"/>`,
      `<g transform="translate(${n(x + padding)} ${
        n(top + (height - 26) / 2)
      })">${pillIcon(pill.icon)}</g>`,
      textRun(
        x + padding + iconWidth + iconGap,
        PILL_ROW_CENTRE_Y + PILL_LABEL_SIZE * 0.35,
        pill.label,
        palette,
        { size: PILL_LABEL_SIZE, weight: 700, fill: PILL_LABEL },
      ),
    );
    x += width + gap;
  });
  return parts.join("");
}

/**
 * Build the complete 1280x640 preview for `spec` in the given palette.
 *
 * `measure` supplies the rendered width of a text run so the wordmark, the
 * soma, and the pills can be laid out to fit whichever font the rasteriser
 * resolves from {@link FONT_STACK}.
 */
export function buildPreviewSvg(
  spec: PreviewSpec,
  palette: Palette,
  measure: TextMeasure,
): string {
  const left = measure("NE", WORDMARK_SIZE, WORDMARK_WEIGHT);
  const right = measure("T-AI", WORDMARK_SIZE, WORDMARK_WEIGHT);
  const capHeight = left.height;
  const somaRadius = capHeight * 0.72;
  const overlap = somaRadius * 0.22;
  const lockupWidth = left.width + right.width + somaRadius * 2 - overlap * 2;
  const startX = (PREVIEW_WIDTH - lockupWidth) / 2;
  const somaX = startX + left.width + somaRadius - overlap;
  const baseline = SOMA_CENTRE_Y + capHeight / 2;

  const background = palette.background
    ? `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="${palette.background}"/>`
    : "";

  const motif = spec.motif ? motifSvg(spec.motif, palette, SOMA_DETAIL) : "";

  const body = [
    background,
    dendrites(somaX, SOMA_CENTRE_Y, somaRadius, spec.seed, palette),
    motif,
    textRun(startX, baseline, "NE", palette, {
      size: WORDMARK_SIZE,
      weight: WORDMARK_WEIGHT,
      fill: palette.ink,
      haloWidth: 12,
    }),
    textRun(somaX + somaRadius - overlap, baseline, "T-AI", palette, {
      size: WORDMARK_SIZE,
      weight: WORDMARK_WEIGHT,
      fill: palette.ink,
      haloWidth: 12,
    }),
    soma(somaX, SOMA_CENTRE_Y, somaRadius, palette),
    textRun(PREVIEW_WIDTH / 2, SUBTITLE_BASELINE, spec.subtitle, palette, {
      size: SUBTITLE_SIZE,
      weight: 800,
      fill: palette.subtitle,
      anchor: "middle",
      haloWidth: 10,
    }),
    textRun(PREVIEW_WIDTH / 2, DESCRIPTOR_BASELINE, spec.descriptor, palette, {
      size: DESCRIPTOR_SIZE,
      weight: 600,
      fill: palette.ink,
      anchor: "middle",
      haloWidth: 5,
    }),
    pillRow(measure, palette),
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" ` +
    `height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">` +
    `${body}</svg>`;
}
