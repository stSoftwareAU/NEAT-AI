/**
 * DataQuantisation.ts - In-place quantisation of training data buffers.
 *
 * Issue #1901: Quantises continuous values to a finite set of discrete
 * levels, preventing networks from memorising exact training examples.
 * Quantisation is deterministic — the same input always produces the
 * same quantised output.
 *
 * The value range [min, max] observed in the buffer is divided into
 * `levels` evenly spaced bins, and each value is snapped to the
 * nearest bin centre.
 */

/**
 * Quantise values in a Float32Array in-place to a fixed number of
 * discrete levels.
 *
 * Maps the value range [min, max] observed in the buffer to `levels`
 * evenly spaced bins. Each value is snapped to the nearest bin centre.
 *
 * @param buffer - The data buffer to quantise in place
 * @param levels - Number of discrete quantisation levels (must be >= 2)
 */
export function quantiseBuffer(buffer: Float32Array, levels: number): void {
  const len = buffer.length;
  if (len === 0) return;

  // Find min/max in the buffer
  let min = buffer[0];
  let max = buffer[0];
  for (let i = 1; i < len; i++) {
    const v = buffer[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  if (range < Number.EPSILON) return; // All values identical, nothing to quantise

  const step = range / (levels - 1);
  for (let i = 0; i < len; i++) {
    buffer[i] = min + Math.round((buffer[i] - min) / step) * step;
  }
}
