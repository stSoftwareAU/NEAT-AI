/**
 * The NEAT-AI family social previews, drawn as SVG.
 *
 * The family look lives here once: the signed-off organic neuron standing in
 * for the first **A** of NEAT-AI, the measured wordmark around it, the
 * sub-project subtitle, and the shared capability pills. Every sibling preview
 * is the same lockup with its own subtitle, descriptor, and motif, so the ten
 * images stay recognisably one family instead of ten hand-tweaked drawings.
 *
 * Two palettes render the same artwork:
 *
 * - `transparent` — the canonical committed set. No background; dark ink with
 *   a white halo so the lockup reads on both light and dark pages.
 * - `opaque` — flattened onto the brand navy for GitHub's Social preview slot,
 *   which composites uploads onto its own dark chrome.
 */

import { dirname, fromFileUrl, resolve } from "@std/path";
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

/** Measures a text run rendered with a given font. */
export type TextMeasure = (
  text: string,
  fontSize: number,
  fontWeight: number,
  fontFamily?: string,
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

/** Font stack shared by subtitle, descriptor, and pills. */
export const FONT_STACK =
  "'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', 'Liberation Sans', sans-serif";

/** Heavy wordmark that matches the signed-off neuron-A SVG. */
const WORDMARK_FONT =
  "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Pill labels stay white in both palettes — pill fills are always opaque. */
const PILL_LABEL = "#FFFFFF";

const WORDMARK_SIZE = 190;
const WORDMARK_WEIGHT = 900;
const SUBTITLE_SIZE = 64;
const DESCRIPTOR_SIZE = 26;
const PILL_LABEL_SIZE = 26;

const SUBTITLE_BASELINE = 448;
const DESCRIPTOR_BASELINE = 494;
const PILL_ROW_CENTRE_Y = 564;

/** The attached lockup is 1024×512; previews are 1280×640. */
const MARK_SCALE = PREVIEW_WIDTH / 1024;

const MARK_PATH = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../../docs/brand/templates/neuron-a-mark.png",
);

let cachedMarkUri: string | undefined;

/** Round to two decimals — smaller files, byte-identical re-renders. */
function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function neuronMarkImage(): string {
  if (!cachedMarkUri) {
    cachedMarkUri = `data:image/png;base64,${
      bytesToBase64(Deno.readFileSync(MARK_PATH))
    }`;
  }
  return `<image href="${cachedMarkUri}" x="0" y="0" width="${PREVIEW_WIDTH}" ` +
    `height="${PREVIEW_HEIGHT}" preserveAspectRatio="none"/>`;
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

interface TextOptions {
  size: number;
  weight: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  haloWidth?: number;
  fontFamily?: string;
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
  const fontFamily = options.fontFamily ?? FONT_STACK;
  const common = `x="${n(x)}" y="${n(y)}" font-family="${fontFamily}" ` +
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

interface PillSpec {
  label: string;
  icon: string;
  tone: "teal" | "tealDeep" | "coral";
}

/** The five capability pills every family member carries. */
const PILLS: PillSpec[] = [
  { label: "Discover", icon: "compass", tone: "teal" },
  { label: "Evolve", icon: "dna", tone: "coral" },
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
    case "dna":
      return `<path d="M8 3 C14 8 12 18 18 23" ${stroke}/>` +
        `<path d="M18 3 C12 8 14 18 8 23" ${stroke}/>` +
        `<path d="M10 8 H16 M9.5 13 H16.5 M10 18 H16" ${stroke}/>`;
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
 * `measure` supplies the rendered width of a text run so the hyphen and the
 * pills can be laid out to fit whichever font the rasteriser resolves.
 */
export function buildPreviewSvg(
  spec: PreviewSpec,
  palette: Palette,
  measure: TextMeasure,
): string {
  const s = MARK_SCALE;
  const baseline = 276 * s;
  const haloWidth = palette.background ? 0 : 12;
  const subtitleHalo = palette.background ? 0 : 10;
  const glyph = (x: number, ch: string) =>
    textRun(x, baseline, ch, palette, {
      size: WORDMARK_SIZE,
      weight: WORDMARK_WEIGHT,
      fill: palette.ink,
      haloWidth,
      fontFamily: WORDMARK_FONT,
    });
  const tX = 529 * s;
  const aX = 766 * s;
  const tWidth = measure("T", WORDMARK_SIZE, WORDMARK_WEIGHT, WORDMARK_FONT)
    .width;
  const hyphenWidth =
    measure("-", WORDMARK_SIZE, WORDMARK_WEIGHT, WORDMARK_FONT)
      .width;
  const hyphenX = (tX + tWidth + aX) / 2 - hyphenWidth / 2;
  const letters = glyph(108 * s, "N") + glyph(271 * s, "E") + glyph(tX, "T") +
    glyph(hyphenX, "-") + glyph(aX, "A") + glyph(891 * s, "I");

  const background = palette.background
    ? `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="${palette.background}"/>`
    : "";

  const motif = spec.motif ? motifSvg(spec.motif, palette, "#0B1220") : "";

  const body = [
    background,
    neuronMarkImage(),
    letters,
    motif,
    textRun(PREVIEW_WIDTH / 2, SUBTITLE_BASELINE, spec.subtitle, palette, {
      size: SUBTITLE_SIZE,
      weight: 800,
      fill: palette.subtitle,
      anchor: "middle",
      haloWidth: subtitleHalo,
    }),
    textRun(PREVIEW_WIDTH / 2, DESCRIPTOR_BASELINE, spec.descriptor, palette, {
      size: DESCRIPTOR_SIZE,
      weight: 600,
      fill: palette.ink,
      anchor: "middle",
      haloWidth: palette.background ? 0 : 5,
    }),
    pillRow(measure, palette),
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" ` +
    `height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}">` +
    `${body}</svg>`;
}
