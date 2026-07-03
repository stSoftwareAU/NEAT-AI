/**
 * Issue #2529 — Muon-style orthogonalised gradient updates.
 *
 * Implements the Newton-Schulz polynomial iteration used by the Muon
 * optimiser to orthogonalise per-neuron gradient matrices. Each row of
 * the gradient matrix corresponds to one target neuron's incoming-weight
 * gradient vector; orthogonalising the matrix decorrelates per-neuron
 * update directions and (per the DeepSeek V4 paper) accelerates
 * convergence and improves stability over AdamW.
 *
 * Algorithm (the standard "quintic" Newton-Schulz, Bernstein 2024):
 *
 *   X ← G / ||G||_F                         (Frobenius normalise)
 *   repeat 5 times:
 *     A ← X X^T
 *     B ← b·A + c·A·A
 *     X ← a·X + B·X
 *
 *   with quintic coefficients (a, b, c) = (3.4445, -4.7750, 2.0315).
 *
 * The iteration converges to U·V^T from the SVD G = U Σ V^T (i.e. the
 * orthogonal factor of G's polar decomposition) for any well-conditioned
 * input. For tall matrices (rows > cols) we instead compute X^T X to
 * keep the inner dimension small.
 *
 * Wired in behind the default-off `gradientOrthogonalisation` flag in
 * `BackPropagationArguments`. With the default `"none"` setting this
 * module is never invoked.
 */

/**
 * Standard Muon quintic Newton-Schulz coefficients. Module-private: used only
 * by the quintic iteration below, with no in-repo importers (Issue #3211).
 */
const MUON_QUINTIC_A = 3.4445;
const MUON_QUINTIC_B = -4.7750;
const MUON_QUINTIC_C = 2.0315;

/** Default number of Newton-Schulz iterations (the V4 standard is 5). */
export const MUON_DEFAULT_STEPS = 5;

/**
 * In-place row-major matrix view used by the orthogonalisation routines.
 *
 * `data.length` MUST equal `rows * cols`. The caller owns the buffer —
 * `newtonSchulzOrthogonalise` mutates it.
 */
export interface RowMajorMatrix {
  data: Float64Array;
  rows: number;
  cols: number;
}

/**
 * Compute the Frobenius norm of a row-major matrix.
 * Returns 0 only when every entry is exactly zero (or non-finite).
 */
export function frobeniusNorm(m: RowMajorMatrix): number {
  let s = 0;
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i];
    if (Number.isFinite(v)) s += v * v;
  }
  return Math.sqrt(s);
}

/** Y ← α·A·B (row-major; Y is rows(A) × cols(B); inner = cols(A) = rows(B)). */
function matMul(
  out: Float64Array,
  outRows: number,
  outCols: number,
  a: Float64Array,
  aCols: number,
  b: Float64Array,
  alpha: number,
): void {
  out.fill(0);
  for (let i = 0; i < outRows; i++) {
    const aRow = i * aCols;
    const oRow = i * outCols;
    for (let k = 0; k < aCols; k++) {
      const aik = a[aRow + k] * alpha;
      if (aik === 0) continue;
      const bRow = k * outCols;
      for (let j = 0; j < outCols; j++) {
        out[oRow + j] += aik * b[bRow + j];
      }
    }
  }
}

/** Y ← A^T (rows × cols → cols × rows, row-major). */
function transpose(
  out: Float64Array,
  rows: number,
  cols: number,
  src: Float64Array,
): void {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      out[j * rows + i] = src[i * cols + j];
    }
  }
}

/**
 * Orthogonalise a gradient matrix in place using `steps` Newton-Schulz
 * iterations with the standard Muon quintic coefficients.
 *
 * Behaviour:
 * - 0×N or M×0 matrices are no-ops.
 * - 1×1 matrices collapse to ±1 (sign of the input) — the orthogonal
 *   factor of a 1×1 matrix is its sign.
 * - All-zero or non-finite inputs are left as zero — orthogonalising the
 *   zero matrix is undefined; we return zeros rather than NaN/Inf.
 * - Rank-deficient inputs are stable: the iteration is run on a
 *   normalised copy and produces a finite (approximately orthogonal)
 *   result for every singular direction with non-zero singular value.
 *
 * The result satisfies U^T U ≈ I (cols × cols) when rows ≥ cols, and
 * U U^T ≈ I (rows × rows) when rows < cols, in the directions spanned
 * by the input.
 *
 * @param matrix mutated in place; the orthogonalised matrix is left in
 *   `matrix.data`.
 * @param steps number of Newton-Schulz iterations (default 5).
 */
export function newtonSchulzOrthogonalise(
  matrix: RowMajorMatrix,
  steps: number = MUON_DEFAULT_STEPS,
): RowMajorMatrix {
  const { rows, cols, data } = matrix;
  if (rows === 0 || cols === 0) return matrix;
  if (data.length !== rows * cols) {
    throw new RangeError(
      `MuonOrthogonalisation: data length ${data.length} != rows*cols ${
        rows * cols
      }`,
    );
  }

  // Sanitise non-finite entries and detect the all-zero case in one pass.
  let allZero = true;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) {
      data[i] = 0;
    } else if (data[i] !== 0) {
      allZero = false;
    }
  }
  if (allZero) return matrix;

  // 1×1 special case: orthogonal factor of a scalar is its sign.
  if (rows === 1 && cols === 1) {
    data[0] = data[0] > 0 ? 1 : -1;
    return matrix;
  }

  // Frobenius normalise. The quintic iteration converges for ||X||_2 ≤ 1;
  // ||X||_2 ≤ ||X||_F so dividing by Frobenius norm gives a safe start.
  const frob = frobeniusNorm(matrix);
  if (frob === 0) return matrix;
  const inv = 1 / frob;
  for (let i = 0; i < data.length; i++) data[i] *= inv;

  // Pick the smaller-inner-dimension formulation:
  //   "wide"  (cols ≥ rows): A = X X^T  (rows × rows)
  //   "tall"  (rows >  cols): A = X^T X (cols × cols)
  const useWide = cols >= rows;
  const innerDim = useWide ? rows : cols;

  // Workspace buffers.
  const A = new Float64Array(innerDim * innerDim);
  const A2 = new Float64Array(innerDim * innerDim);
  const B = new Float64Array(innerDim * innerDim);
  const xT = new Float64Array(rows * cols);
  const next = new Float64Array(rows * cols);

  for (let step = 0; step < steps; step++) {
    if (useWide) {
      // A = X X^T  (rows × rows)
      transpose(xT, rows, cols, data);
      matMul(A, rows, rows, data, cols, xT, 1);
    } else {
      // A = X^T X  (cols × cols)
      transpose(xT, rows, cols, data);
      matMul(A, cols, cols, xT, rows, data, 1);
    }

    // A2 = A · A
    matMul(A2, innerDim, innerDim, A, innerDim, A, 1);
    // B = b·A + c·A·A
    for (let i = 0; i < B.length; i++) {
      B[i] = MUON_QUINTIC_B * A[i] + MUON_QUINTIC_C * A2[i];
    }

    if (useWide) {
      // next = a·X + B·X     (B is rows × rows)
      matMul(next, rows, cols, B, rows, data, 1);
      for (let i = 0; i < data.length; i++) {
        next[i] += MUON_QUINTIC_A * data[i];
      }
    } else {
      // next = a·X + X·B     (B is cols × cols)
      matMul(next, rows, cols, data, cols, B, 1);
      for (let i = 0; i < data.length; i++) {
        next[i] += MUON_QUINTIC_A * data[i];
      }
    }

    // Guard: if a step produced any non-finite entry (degenerate input)
    // fall back to the previous iterate and stop.
    let finite = true;
    for (let i = 0; i < next.length; i++) {
      if (!Number.isFinite(next[i])) {
        finite = false;
        break;
      }
    }
    if (!finite) break;

    data.set(next);
  }

  // Final rescale: the quintic Newton-Schulz polynomial converges to
  // U·V^T multiplied by an iteration-dependent scalar (with the standard
  // (3.4445, -4.7750, 2.0315) coefficients the polynomial does not have
  // σ = 1 as a fixed point). For a true orthogonal matrix the Frobenius
  // norm is sqrt(min(rows, cols)) — every non-zero singular value equals
  // 1. Rescale so the output Frobenius norm matches this target, which
  // makes σ_i ≈ 1 (i.e. U^T U ≈ I in the spanned directions) and makes
  // the iteration approximately idempotent.
  const finalFrob = frobeniusNorm(matrix);
  if (finalFrob > 0) {
    const targetFrob = Math.sqrt(Math.min(rows, cols));
    const rescale = targetFrob / finalFrob;
    for (let i = 0; i < data.length; i++) data[i] *= rescale;
  }

  return matrix;
}

/**
 * Convenience: build a row-major matrix from a 2D number array, run the
 * Newton-Schulz iteration, and return the result as a 2D number array.
 *
 * Used by tests and benchmarks; production callers should prefer the
 * in-place {@link newtonSchulzOrthogonalise} on a pre-allocated
 * {@link RowMajorMatrix} to avoid per-step allocation.
 */
export function orthogonalise2D(
  rowsIn: readonly (readonly number[])[],
  steps: number = MUON_DEFAULT_STEPS,
): number[][] {
  const rows = rowsIn.length;
  if (rows === 0) return [];
  const cols = rowsIn[0].length;
  const data = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    if (rowsIn[i].length !== cols) {
      throw new RangeError(
        `MuonOrthogonalisation: ragged input (row ${i} has ${
          rowsIn[i].length
        } cols, expected ${cols})`,
      );
    }
    for (let j = 0; j < cols; j++) data[i * cols + j] = rowsIn[i][j];
  }
  newtonSchulzOrthogonalise({ data, rows, cols }, steps);
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row = new Array<number>(cols);
    for (let j = 0; j < cols; j++) row[j] = data[i * cols + j];
    out.push(row);
  }
  return out;
}
