/**
 * PNG structural integrity, so corrupt artwork fails loud.
 *
 * A rasteriser that cannot decode an embedded image drops it silently: the
 * preview still renders, just without the neuron mark. Checking the chunk
 * CRCs before the bytes are embedded turns that into an error at the point of
 * the fault.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** PNG's chunk CRC — the same polynomial for checking and for writing. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Throws unless `bytes` is a structurally sound PNG: the signature, a chunk
 * chain whose lengths stay in bounds, every chunk CRC intact, and the IHDR /
 * IDAT / IEND chunks all present. `label` names the source in the error.
 */
export function assertSoundPng(bytes: Uint8Array, label: string): void {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((expected, i) => bytes[i] !== expected)
  ) {
    throw new Error(`${label} is not a PNG: bad signature`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const seen = new Set<string>();

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new Error(
        `${label} is truncated: chunk at byte ${offset} runs past the file`,
      );
    }
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const actual = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    const declared = view.getUint32(offset + 8 + length);
    if (actual !== declared) {
      throw new Error(
        `${label} is corrupt: ${type} chunk at byte ${offset} has CRC ` +
          `0x${actual.toString(16)}, declares 0x${declared.toString(16)}`,
      );
    }
    seen.add(type);
    offset = end;
  }

  if (offset !== bytes.length) {
    throw new Error(
      `${label} is corrupt: ${bytes.length - offset} trailing byte(s)`,
    );
  }
  for (const required of ["IHDR", "IDAT", "IEND"]) {
    if (!seen.has(required)) {
      throw new Error(`${label} is incomplete: no ${required} chunk`);
    }
  }
}
