/**
 * Palette quantisation and indexed-PNG encoding (Issue #3903).
 *
 * GitHub's Social preview slot refuses files of 1 MB or larger, and the
 * family's canonical transparent PNGs are 752 KB–1.2 MB as 8-bit RGBA. A
 * flattened JPEG used to buy the headroom at the cost of the transparent
 * background; a median-cut palette buys it while keeping the alpha channel —
 * an indexed PNG stores one byte per pixel plus a `tRNS` chunk.
 */

import { deflateSync } from "node:zlib";
import { crc32 } from "./png_integrity.ts";

/** Straight-alpha RGBA pixels, row-major, 8 bits per sample. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** A quantised image: up to 256 RGBA palette entries plus per-pixel indices. */
export interface QuantisedImage {
  /** Palette entries as flat RGBA quads; non-opaque entries come first. */
  readonly palette: Uint8Array;
  /** One palette index per pixel. */
  readonly indices: Uint8Array;
}

/** The widest palette an 8-bit indexed PNG can carry. */
export const MAX_PALETTE = 256;

interface Colour {
  r: number;
  g: number;
  b: number;
  a: number;
  count: number;
}

/**
 * Alpha error shows as a halo around the artwork, so it is weighted above the
 * colour channels when a pixel is snapped to its nearest palette entry.
 */
const ALPHA_WEIGHT = 4;

function packRgba(r: number, g: number, b: number, a: number): number {
  // Fully transparent pixels carry meaningless colour; collapse them so the
  // whole transparent pad shares one palette entry.
  if (a === 0) return 0;
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function histogram(image: RgbaImage): Map<number, number> {
  const counts = new Map<number, number>();
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const key = packRgba(data[i], data[i + 1], data[i + 2], data[i + 3]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function toColours(counts: Map<number, number>): Colour[] {
  const colours: Colour[] = [];
  for (const [key, count] of counts) {
    colours.push({
      r: (key >>> 24) & 0xff,
      g: (key >>> 16) & 0xff,
      b: (key >>> 8) & 0xff,
      a: key & 0xff,
      count,
    });
  }
  return colours;
}

type Channel = "r" | "g" | "b" | "a";
const CHANNELS: Channel[] = ["r", "g", "b", "a"];

interface Bucket {
  colours: Colour[];
  channel: Channel;
  range: number;
  count: number;
}

function makeBucket(colours: Colour[]): Bucket {
  let channel: Channel = "r";
  let range = -1;
  let count = 0;
  for (const colour of colours) count += colour.count;
  for (const candidate of CHANNELS) {
    let min = 255;
    let max = 0;
    for (const colour of colours) {
      const value = colour[candidate];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const spread = max - min;
    if (spread > range) {
      range = spread;
      channel = candidate;
    }
  }
  return { colours, channel, range, count };
}

/** Split `bucket` at the count-weighted median of its widest channel. */
function splitBucket(bucket: Bucket): [Bucket, Bucket] {
  const sorted = [...bucket.colours].sort((a, b) =>
    a[bucket.channel] - b[bucket.channel]
  );
  const half = bucket.count / 2;
  let running = 0;
  let cut = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    running += sorted[i].count;
    cut = i + 1;
    if (running >= half) break;
  }
  return [makeBucket(sorted.slice(0, cut)), makeBucket(sorted.slice(cut))];
}

/** The count-weighted mean of a bucket, rounded to 8-bit samples. */
function averageColour(bucket: Bucket): Colour {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const colour of bucket.colours) {
    r += colour.r * colour.count;
    g += colour.g * colour.count;
    b += colour.b * colour.count;
    a += colour.a * colour.count;
  }
  const total = bucket.count;
  return {
    r: Math.round(r / total),
    g: Math.round(g / total),
    b: Math.round(b / total),
    a: Math.round(a / total),
    count: total,
  };
}

/** Median-cut the visible colours into at most `budget` palette entries. */
function medianCut(colours: Colour[], budget: number): Colour[] {
  if (colours.length <= budget) return colours;
  let buckets = [makeBucket(colours)];
  while (buckets.length < budget) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.colours.length < 2 || bucket.range === 0) continue;
      const score = bucket.range * bucket.count;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break; // nothing left worth splitting
    const [left, right] = splitBucket(buckets[bestIndex]);
    buckets = [
      ...buckets.slice(0, bestIndex),
      left,
      right,
      ...buckets.slice(bestIndex + 1),
    ];
  }
  return buckets.map(averageColour);
}

/**
 * Reduce `image` to at most `maxColours` palette entries.
 *
 * Fully transparent pixels are held out of the median cut and given their own
 * entry, so the pad stays exactly transparent however tight the budget is.
 * Non-opaque entries are sorted first so the `tRNS` chunk stays short.
 */
export function quantise(image: RgbaImage, maxColours: number): QuantisedImage {
  if (maxColours < 2 || maxColours > MAX_PALETTE) {
    throw new Error(
      `palette budget ${maxColours} is outside 2..${MAX_PALETTE}`,
    );
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new Error(
      `image data is ${image.data.length} bytes, expected ` +
        `${image.width * image.height * 4} for ${image.width}×${image.height}`,
    );
  }

  const counts = histogram(image);
  const hasTransparent = counts.has(0);
  counts.delete(0);

  const budget = hasTransparent ? maxColours - 1 : maxColours;
  const entries = medianCut(toColours(counts), budget);
  if (hasTransparent) entries.push({ r: 0, g: 0, b: 0, a: 0, count: 0 });

  // tRNS covers a prefix of the palette, so put every non-opaque entry first.
  entries.sort((x, y) => x.a - y.a);

  const palette = new Uint8Array(entries.length * 4);
  for (let i = 0; i < entries.length; i++) {
    palette[i * 4] = entries[i].r;
    palette[i * 4 + 1] = entries[i].g;
    palette[i * 4 + 2] = entries[i].b;
    palette[i * 4 + 3] = entries[i].a;
  }

  const indices = new Uint8Array(image.width * image.height);
  const cache = new Map<number, number>();
  const { data } = image;
  for (let p = 0; p < indices.length; p++) {
    const i = p * 4;
    const key = packRgba(data[i], data[i + 1], data[i + 2], data[i + 3]);
    let index = cache.get(key);
    if (index === undefined) {
      index = nearestEntry(entries, key);
      cache.set(key, index);
    }
    indices[p] = index;
  }

  return { palette, indices };
}

function nearestEntry(entries: Colour[], key: number): number {
  const r = (key >>> 24) & 0xff;
  const g = (key >>> 16) & 0xff;
  const b = (key >>> 8) & 0xff;
  const a = key & 0xff;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const da = entry.a - a;
    let distance = da * da * ALPHA_WEIGHT;
    if (distance < bestDistance) {
      const dr = entry.r - r;
      const dg = entry.g - g;
      const db = entry.b - b;
      distance += dr * dr + dg * dg + db * db;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/**
 * Encode a quantised image as an 8-bit indexed PNG.
 *
 * Scanlines use filter `None`: palette indices are labels, not magnitudes, so
 * the delta filters only scramble the runs deflate feeds on.
 */
export function encodeIndexedPng(
  width: number,
  height: number,
  palette: Uint8Array,
  indices: Uint8Array,
): Uint8Array {
  const entries = palette.length / 4;
  if (entries < 1 || entries > MAX_PALETTE || palette.length % 4 !== 0) {
    throw new Error(`palette of ${palette.length} bytes is not 1..256 RGBA`);
  }
  if (indices.length !== width * height) {
    throw new Error(
      `${indices.length} indices for a ${width}×${height} image`,
    );
  }

  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: None
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const plte = new Uint8Array(entries * 3);
  let transparentEntries = 0;
  for (let i = 0; i < entries; i++) {
    plte[i * 3] = palette[i * 4];
    plte[i * 3 + 1] = palette[i * 4 + 1];
    plte[i * 3 + 2] = palette[i * 4 + 2];
    if (palette[i * 4 + 3] !== 255) transparentEntries = i + 1;
  }

  const parts: Uint8Array[] = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
  ];
  if (transparentEntries > 0) {
    const trns = new Uint8Array(transparentEntries);
    for (let i = 0; i < transparentEntries; i++) trns[i] = palette[i * 4 + 3];
    parts.push(chunk("tRNS", trns));
  }
  const compressed = new Uint8Array(deflateSync(raw, { level: 9 }));
  parts.push(chunk("IDAT", compressed));
  parts.push(chunk("IEND", new Uint8Array(0)));

  const total = parts.reduce((n, part) => n + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}
