/**
 * Minimal PNG reader for the brand-asset tests (Issue #3764).
 *
 * The brand tests need to prove a committed preview really is transparent —
 * a claim only the pixels can settle. Rather than pull in an image library
 * for two assertions, this decodes the subset of PNG the brand set uses:
 * 8-bit, non-interlaced, truecolour with (type 6) or without (type 2) an
 * alpha channel, and the palette form (type 3) the GitHub uploads use since
 * Issue #3903. Anything else throws loudly rather than being silently treated
 * as opaque.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A decoded PNG, exposing per-pixel alpha. */
export interface PngPixels {
  readonly width: number;
  readonly height: number;
  /**
   * PNG colour type from IHDR: 2 = truecolour, 3 = palette,
   * 6 = truecolour + alpha.
   */
  readonly colourType: number;
  /** Distinct colours in the palette, or 0 when the image is not indexed. */
  readonly paletteSize: number;
  /** Alpha at (x, y): 0 fully transparent, 255 fully opaque. */
  alphaAt(x: number, y: number): number;
}

/** zlib-inflate `data` using the platform's DecompressionStream. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BufferSource]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Paeth predictor (PNG filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverse the per-scanline filters, returning packed samples. */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const stride = width * bytesPerPixel;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? out[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[row - stride + x] : 0;
      const upLeft = x >= bytesPerPixel && y > 0
        ? out[row - stride + x - bytesPerPixel]
        : 0;
      const value = raw[pos + x];
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filter}`);
      }
      out[row + x] = restored & 0xff;
    }
    pos += stride;
  }
  return out;
}

/** Decode `bytes` far enough to read its alpha channel. `label` names it. */
export async function decodePngPixels(
  bytes: Uint8Array,
  label: string,
): Promise<PngPixels> {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new Error(`${label} is not a PNG`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const idatParts: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let colourType = -1;
  let paletteSize = 0;
  let paletteAlpha: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = offset + 8;
    if (type === "IHDR") {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      const bitDepth = bytes[body + 8];
      colourType = bytes[body + 9];
      const interlace = bytes[body + 12];
      if (bitDepth !== 8 || interlace !== 0) {
        throw new Error(
          `${label}: only 8-bit non-interlaced PNGs are supported ` +
            `(bit depth ${bitDepth}, interlace ${interlace})`,
        );
      }
      if (colourType !== 2 && colourType !== 3 && colourType !== 6) {
        throw new Error(`${label}: unsupported PNG colour type ${colourType}`);
      }
    } else if (type === "PLTE") {
      paletteSize = length / 3;
    } else if (type === "tRNS") {
      paletteAlpha = bytes.subarray(body, body + length);
    } else if (type === "IDAT") {
      idatParts.push(bytes.subarray(body, body + length));
    } else if (type === "IEND") {
      break;
    }
    offset = body + length + 4;
  }
  if (idatParts.length === 0) throw new Error(`${label}: no IDAT chunk`);

  const compressedLength = idatParts.reduce((n, p) => n + p.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const part of idatParts) {
    compressed.set(part, cursor);
    cursor += part.length;
  }

  const channels = colourType === 6 ? 4 : colourType === 3 ? 1 : 3;
  const samples = unfilter(
    await inflate(compressed),
    width,
    height,
    channels,
  );

  return {
    width,
    height,
    colourType,
    paletteSize,
    alphaAt(x: number, y: number): number {
      if (colourType === 3) {
        // tRNS lists alpha for a prefix of the palette; the rest are opaque.
        const index = samples[y * width + x];
        return index < paletteAlpha.length ? paletteAlpha[index] : 255;
      }
      if (channels === 3) return 255;
      return samples[(y * width + x) * channels + 3];
    },
  };
}

/** Decode the PNG at `path` far enough to read its alpha channel. */
export async function readPngPixels(path: string): Promise<PngPixels> {
  return await decodePngPixels(await Deno.readFile(path), path);
}
