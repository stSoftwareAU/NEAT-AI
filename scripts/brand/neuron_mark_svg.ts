/**
 * Issue #3805 — cut the neuron-A mark out of the signed-off B5 lockup.
 *
 * `docs/brand/templates/neuron-a.svg` is the whole lockup: the organic neuron
 * A, the wordmark around it, the subtitle, and the capability pills. The
 * previews draw their own text, so the committed mark PNG must carry the
 * neuron artwork alone — on the lockup's own canvas, so the neuron lands where
 * the lockup puts it once the preview stretches the image over the full frame.
 *
 * The cut is described here as a pure string transform so it can be tested
 * without a rasteriser; `render_neuron_mark.ts` rasterises what it returns.
 */

/** `id` of the group in the lockup SVG holding the neuron artwork. */
export const MARK_GROUP_ID = "neuron-a-mark";

/** Canvas of a lockup SVG, in the units its geometry is written in. */
export interface MarkCanvas {
  width: number;
  height: number;
  viewBox: string;
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (!match) throw new Error(`lockup SVG has no ${name} attribute`);
  return match[1];
}

/** The lockup's canvas, which the mark inherits unchanged. */
export function markCanvas(source: string): MarkCanvas {
  const root = source.match(/<svg\b[^>]*>/);
  if (!root) throw new Error("lockup SVG has no <svg> element");
  const width = Number(attribute(root[0], "width"));
  const height = Number(attribute(root[0], "height"));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("lockup SVG has a non-numeric width or height");
  }
  return { width, height, viewBox: attribute(root[0], "viewBox") };
}

/** The `<g id="neuron-a-mark">…</g>` subtree, with its nesting balanced. */
function markGroup(source: string): string {
  const open = source.match(
    new RegExp(`<g\\b[^>]*\\bid="${MARK_GROUP_ID}"[^>]*>`),
  );
  if (open?.index === undefined) {
    throw new Error(`lockup SVG has no <g id="${MARK_GROUP_ID}"> group`);
  }

  const tags = /<g\b[^>]*>|<\/g\s*>/g;
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let tag = tags.exec(source); tag; tag = tags.exec(source)) {
    depth += tag[0].startsWith("</") ? -1 : tag[0].endsWith("/>") ? 0 : 1;
    if (depth === 0) return source.slice(open.index, tags.lastIndex);
  }
  throw new Error(`<g id="${MARK_GROUP_ID}"> is never closed`);
}

/**
 * Build the standalone mark SVG from the lockup `source`: the lockup's
 * canvas, its `<defs>` (the mark's gradient lives there), and the neuron
 * group — no wordmark, subtitle, or pills.
 *
 * Throws when the lockup has no marked group, an unbalanced one, or no
 * canvas: a silently empty mark is exactly the failure this exists to stop.
 */
export function buildMarkSvg(source: string): string {
  const { width, height, viewBox } = markCanvas(source);
  const defs = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" ` +
    `height="${height}" viewBox="${viewBox}">${defs}${markGroup(source)}</svg>`;
}
