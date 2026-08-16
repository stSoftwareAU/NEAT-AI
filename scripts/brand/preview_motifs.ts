/**
 * Issue #3764 — per-repo motifs for the family social previews.
 *
 * Each sibling preview carries one small flat-vector motif that hints at what
 * that sub-project does. Motifs are drawn as primitives in a local box roughly
 * +/-70 units around the origin, then rendered twice — a halo pass underneath
 * and the artwork on top — so they stay legible on a transparent background in
 * both light and dark modes.
 */

import type { Palette } from "./preview_art.ts";

export type MotifId =
  | "gear"
  | "magnifier"
  | "bars"
  | "arrows"
  | "giraffe"
  | "telescope"
  | "camera"
  | "notebook";

/** Where the motif sits on the 1280x640 canvas: clear of the wordmark. */
const MOTIF_X = 1126;
const MOTIF_Y = 180;
/** Motifs are drawn in a +/-70 box, then scaled onto the canvas. */
const MOTIF_SCALE = 1.2;

/** Giraffe hide — the one place the family palette borrows a warm tone. */
const HIDE = "#E0A458";
const HIDE_SPOT = "#B4762E";

type Prim =
  | {
    kind: "circle";
    cx: number;
    cy: number;
    r: number;
    fill?: string;
    stroke?: string;
    width?: number;
  }
  | {
    kind: "ellipse";
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    fill?: string;
    transform?: string;
  }
  | {
    kind: "rect";
    x: number;
    y: number;
    w: number;
    h: number;
    rx?: number;
    fill?: string;
    transform?: string;
  }
  | {
    kind: "path";
    d: string;
    fill?: string;
    stroke?: string;
    width?: number;
  };

function attrs(
  prim: Prim,
  fill: string | undefined,
  stroke: string | undefined,
  width: number,
): string {
  const paint = `fill="${fill ?? "none"}"` +
    (stroke
      ? ` stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
      : "");
  switch (prim.kind) {
    case "circle":
      return `<circle cx="${prim.cx}" cy="${prim.cy}" r="${prim.r}" ${paint}/>`;
    case "ellipse":
      return `<ellipse cx="${prim.cx}" cy="${prim.cy}" rx="${prim.rx}" ry="${prim.ry}" ${paint}${
        prim.transform ? ` transform="${prim.transform}"` : ""
      }/>`;
    case "rect":
      return `<rect x="${prim.x}" y="${prim.y}" width="${prim.w}" height="${prim.h}" rx="${
        prim.rx ?? 0
      }" ${paint}${prim.transform ? ` transform="${prim.transform}"` : ""}/>`;
    case "path":
      return `<path d="${prim.d}" ${paint}/>`;
  }
}

/** Halo pass: every primitive fattened and painted in the halo colour. */
function haloPass(prims: Prim[], halo: string): string {
  return prims
    .map((prim) => {
      const own = "width" in prim ? prim.width ?? 0 : 0;
      return attrs(
        prim,
        "fill" in prim && prim.fill ? halo : undefined,
        halo,
        own + 9,
      );
    })
    .join("");
}

function artPass(prims: Prim[]): string {
  return prims
    .map((prim) =>
      attrs(
        prim,
        "fill" in prim ? prim.fill : undefined,
        "stroke" in prim ? prim.stroke : undefined,
        ("width" in prim ? prim.width : undefined) ?? 0,
      )
    )
    .join("");
}

/** Shared engine: a gear with a coral hub. */
function gear(palette: Palette): Prim[] {
  const teeth: Prim[] = [];
  for (let i = 0; i < 8; i++) {
    teeth.push({
      kind: "rect",
      x: -8,
      y: -66,
      w: 16,
      h: 22,
      rx: 5,
      fill: palette.teal,
      transform: `rotate(${i * 45} 0 0)`,
    });
  }
  return [
    ...teeth,
    { kind: "circle", cx: 0, cy: 0, r: 40, stroke: palette.teal, width: 16 },
    { kind: "circle", cx: 0, cy: 0, r: 15, fill: palette.coral },
  ];
}

/** Discovery: a magnifier over a newly found node. */
function magnifier(palette: Palette): Prim[] {
  return [
    { kind: "path", d: "M18 18 L52 52", stroke: palette.tealDeep, width: 17 },
    {
      kind: "path",
      d: "M-30 -26 L-6 -8 L14 2",
      stroke: palette.teal,
      width: 7,
    },
    { kind: "circle", cx: -30, cy: -26, r: 7, fill: palette.teal },
    { kind: "circle", cx: 14, cy: 2, r: 7, fill: palette.teal },
    { kind: "circle", cx: -6, cy: -8, r: 11, fill: palette.coral },
    { kind: "circle", cx: -6, cy: -8, r: 38, stroke: palette.teal, width: 13 },
  ];
}

/** Scorer: a rising bar chart with a coral tick. */
function bars(palette: Palette): Prim[] {
  return [
    { kind: "rect", x: -48, y: 0, w: 24, h: 44, rx: 7, fill: palette.teal },
    { kind: "rect", x: -14, y: -22, w: 24, h: 66, rx: 7, fill: palette.teal },
    { kind: "rect", x: 20, y: -44, w: 24, h: 88, rx: 7, fill: palette.teal },
    {
      kind: "path",
      d: "M-46 -30 L-30 -14 L2 -60",
      stroke: palette.coral,
      width: 12,
    },
  ];
}

/** Backpropagation: gradients flowing back through the layers. */
function arrows(palette: Palette): Prim[] {
  const nodes: Prim[] = [];
  for (const x of [-48, 0, 48]) {
    for (const y of [-46, 0, 46]) {
      nodes.push({ kind: "circle", cx: x, cy: y, r: 9, fill: palette.teal });
    }
  }
  return [
    ...nodes,
    { kind: "path", d: "M44 -24 L-30 -24", stroke: palette.coral, width: 9 },
    { kind: "path", d: "M-44 -24 L-26 -33 L-26 -15 Z", fill: palette.coral },
    { kind: "path", d: "M44 24 L-30 24", stroke: palette.coral, width: 9 },
    { kind: "path", d: "M-44 24 L-26 15 L-26 33 Z", fill: palette.coral },
  ];
}

/** Lamarck: the giraffe that stretched for the leaf. */
function giraffe(palette: Palette): Prim[] {
  return [
    { kind: "path", d: "M-34 22 Q-48 32 -44 46", stroke: HIDE, width: 6 },
    { kind: "circle", cx: -44, cy: 48, r: 6, fill: HIDE_SPOT },
    { kind: "rect", x: -26, y: 38, w: 9, h: 28, rx: 4, fill: HIDE },
    { kind: "rect", x: -12, y: 38, w: 9, h: 28, rx: 4, fill: HIDE },
    { kind: "rect", x: 4, y: 38, w: 9, h: 28, rx: 4, fill: HIDE },
    { kind: "rect", x: 16, y: 38, w: 9, h: 28, rx: 4, fill: HIDE },
    { kind: "ellipse", cx: -4, cy: 26, rx: 32, ry: 20, fill: HIDE },
    { kind: "path", d: "M6 18 L26 -34", stroke: HIDE, width: 22 },
    {
      kind: "ellipse",
      cx: 34,
      cy: -44,
      rx: 18,
      ry: 11,
      fill: HIDE,
      transform: "rotate(-16 34 -44)",
    },
    {
      kind: "ellipse",
      cx: 20,
      cy: -52,
      rx: 6,
      ry: 8,
      fill: HIDE,
      transform: "rotate(-30 20 -52)",
    },
    { kind: "path", d: "M28 -54 L26 -64", stroke: HIDE, width: 5 },
    { kind: "circle", cx: 26, cy: -66, r: 4, fill: HIDE_SPOT },
    { kind: "circle", cx: 38, cy: -47, r: 3, fill: "#0B1220" },
    { kind: "circle", cx: -16, cy: 20, r: 6, fill: HIDE_SPOT },
    { kind: "circle", cx: 0, cy: 30, r: 5, fill: HIDE_SPOT },
    { kind: "circle", cx: -22, cy: 34, r: 4, fill: HIDE_SPOT },
    { kind: "circle", cx: 12, cy: 20, r: 4, fill: HIDE_SPOT },
    { kind: "path", d: "M50 -48 L66 -58", stroke: palette.teal, width: 5 },
    {
      kind: "ellipse",
      cx: 58,
      cy: -62,
      rx: 11,
      ry: 6,
      fill: palette.teal,
      transform: "rotate(-24 58 -62)",
    },
    {
      kind: "ellipse",
      cx: 64,
      cy: -50,
      rx: 11,
      ry: 6,
      fill: palette.teal,
      transform: "rotate(18 64 -50)",
    },
  ];
}

/** Explore: a telescope pointed at a coral star. */
function telescope(palette: Palette): Prim[] {
  const tilt = "rotate(-28 0 0)";
  return [
    { kind: "path", d: "M-4 16 L-24 54", stroke: palette.tealDeep, width: 8 },
    { kind: "path", d: "M-4 16 L16 54", stroke: palette.tealDeep, width: 8 },
    {
      kind: "rect",
      x: -46,
      y: -9,
      w: 20,
      h: 18,
      rx: 6,
      fill: palette.tealDeep,
      transform: tilt,
    },
    {
      kind: "rect",
      x: -32,
      y: -14,
      w: 74,
      h: 28,
      rx: 13,
      fill: palette.teal,
      transform: tilt,
    },
    {
      kind: "rect",
      x: 36,
      y: -18,
      w: 13,
      h: 36,
      rx: 5,
      fill: palette.coral,
      transform: tilt,
    },
    {
      kind: "path",
      d: "M46 -62 L50 -52 L60 -48 L50 -44 L46 -34 L42 -44 L32 -48 L42 -52 Z",
      fill: palette.coral,
    },
  ];
}

/** Snapshot: a camera freezing the run. */
function camera(palette: Palette, detail: string): Prim[] {
  return [
    {
      kind: "rect",
      x: -22,
      y: -48,
      w: 36,
      h: 16,
      rx: 6,
      fill: palette.tealDeep,
    },
    { kind: "rect", x: -56, y: -34, w: 112, h: 70, rx: 15, fill: palette.teal },
    { kind: "circle", cx: -2, cy: 2, r: 23, fill: detail },
    { kind: "circle", cx: -2, cy: 2, r: 11, fill: palette.coral },
    { kind: "circle", cx: 38, cy: -20, r: 6, fill: palette.coral },
  ];
}

/** Examples: a worked notebook with a coral bookmark. */
function notebook(palette: Palette): Prim[] {
  return [
    {
      kind: "rect",
      x: -52,
      y: -40,
      w: 84,
      h: 92,
      rx: 11,
      fill: palette.tealDeep,
    },
    { kind: "rect", x: -40, y: -48, w: 84, h: 92, rx: 11, fill: palette.teal },
    { kind: "rect", x: -26, y: -30, w: 50, h: 8, rx: 4, fill: palette.halo },
    { kind: "rect", x: -26, y: -10, w: 50, h: 8, rx: 4, fill: palette.halo },
    { kind: "rect", x: -26, y: 10, w: 32, h: 8, rx: 4, fill: palette.halo },
    {
      kind: "path",
      d: "M18 -48 L38 -48 L38 -12 L28 -22 L18 -12 Z",
      fill: palette.coral,
    },
  ];
}

const MOTIFS: Record<MotifId, (palette: Palette, detail: string) => Prim[]> = {
  gear,
  magnifier,
  bars,
  arrows,
  giraffe,
  telescope,
  camera,
  notebook,
};

/** The positioned motif group for `id`, halo pass first. */
export function motifSvg(
  id: MotifId,
  palette: Palette,
  detail: string,
): string {
  const build = MOTIFS[id];
  if (!build) throw new Error(`unknown motif: ${id}`);
  const prims = build(palette, detail);
  return `<g transform="translate(${MOTIF_X} ${MOTIF_Y}) scale(${MOTIF_SCALE})">` +
    `<g>${haloPass(prims, palette.halo)}</g><g>${artPass(prims)}</g></g>`;
}
