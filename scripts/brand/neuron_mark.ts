/**
 * Build the neuron-A mark SVG from the signed-off B5 lockup.
 *
 * `docs/brand/templates/neuron-a.svg` is a complete lockup: the organic neuron
 * plus its own wordmark, subtitle, and pills. The previews draw their wordmark
 * themselves and composite `neuron-a-mark.png` over the whole canvas, so the
 * mark must carry the neuron **alone**, moved into the A slot of the generated
 * lockup. This module does that move as data — extract the neuron group, place
 * it, and hand the SVG to the rasteriser — so the committed mark is generated
 * rather than hand-exported (Issue #3805).
 */

/** GitHub's social preview canvas, shared with `preview_art.ts`. */
export const MARK_WIDTH = 1280;
export const MARK_HEIGHT = 640;

/** `id` of the neuron artwork group inside the template SVG. */
export const NEURON_ID = "neuron";

/** `id` of the gradient the neuron artwork paints with. */
export const GRADIENT_ID = "neuronGrad";

/** A point on the mark canvas. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Midpoint of the neuron's eyes in the template's own coordinates — the two
 * `<circle>` pupils at (441, 249) and (477, 249).
 */
export const TEMPLATE_FACE: Point = { x: 459, y: 249 };

/**
 * Where that face must land on the preview canvas: the A slot between the
 * generated "E" and "T". `x` is the previous signed-off mark's eye midpoint —
 * (449.5, 215) and (483, 215) on its 1024x512 canvas — scaled by 1.25 onto the
 * 1280x640 preview canvas; `y` sits a little above it so the B5 body, which is
 * longer than that mark's, keeps its feet clear of the subtitle.
 */
export const LOCKUP_FACE: Point = { x: 582.81, y: 258.5 };

/**
 * The B5 neuron stands 362 template units tall against the 340 preview units
 * the previous mark filled, so it is scaled down to sit inside the wordmark
 * without crowding the subtitle beneath it.
 */
export const LOCKUP_SCALE = 0.94;

/** Where the extracted neuron is placed on the mark canvas. */
export interface MarkPlacement {
  scale: number;
  face: Point;
}

export const MARK_PLACEMENT: MarkPlacement = {
  scale: LOCKUP_SCALE,
  face: LOCKUP_FACE,
};

/** Round to two decimals — smaller files, byte-identical re-renders. */
function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * The markup of the element carrying `id` in `svg`, opening tag to closing tag.
 *
 * Throws when the id is absent or its element never closes, so a template that
 * drops or renames the neuron fails at the export instead of quietly writing a
 * mark with nothing in it.
 */
export function extractElement(svg: string, id: string): string {
  const idAt = svg.indexOf(`id="${id}"`);
  if (idAt < 0) throw new Error(`neuron-a template has no element id="${id}"`);

  const openAt = svg.lastIndexOf("<", idAt);
  const openEnd = svg.indexOf(">", idAt);
  if (openAt < 0 || openEnd < 0) {
    throw new Error(`element id="${id}" has a malformed opening tag`);
  }
  const name = svg.slice(openAt + 1).match(/^[\w:-]+/)?.[0];
  if (!name) throw new Error(`element id="${id}" has no tag name`);
  if (svg[openEnd - 1] === "/") return svg.slice(openAt, openEnd + 1);

  // Walk the tags that follow, so nested groups keep their depth. The pattern
  // is a literal that captures each tag's name — building it from `name` would
  // compile attacker-shaped template text into a regex (ReDoS).
  const tags = /<(\/?)([\w:-]+)[^>]*>/g;
  tags.lastIndex = openEnd + 1;
  let depth = 1;
  for (let match = tags.exec(svg); match; match = tags.exec(svg)) {
    const [tag, closing, tagName] = match;
    if (tagName !== name) continue;
    if (closing) depth--;
    else if (!tag.endsWith("/>")) depth++;
    if (depth === 0) return svg.slice(openAt, match.index + tag.length);
  }
  throw new Error(`element id="${id}" is never closed`);
}

/**
 * The 1280x640 mark SVG: the template's gradient, then its neuron group scaled
 * and translated so the face lands on `placement.face`.
 */
export function buildNeuronMarkSvg(
  template: string,
  placement: MarkPlacement = MARK_PLACEMENT,
): string {
  const gradient = extractElement(template, GRADIENT_ID);
  const neuron = extractElement(template, NEURON_ID);
  const { scale, face } = placement;
  const dx = face.x - TEMPLATE_FACE.x * scale;
  const dy = face.y - TEMPLATE_FACE.y * scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK_WIDTH}" ` +
    `height="${MARK_HEIGHT}" viewBox="0 0 ${MARK_WIDTH} ${MARK_HEIGHT}">` +
    `<defs>${gradient}</defs>` +
    `<g transform="translate(${n(dx)} ${n(dy)}) scale(${n(scale)})">` +
    `${neuron}</g></svg>`;
}
