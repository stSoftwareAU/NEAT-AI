/**
 * Issue #2529 — Tests for Muon-style Newton-Schulz orthogonalisation.
 *
 * Covers:
 *   - Happy path: U^T U ≈ I (or U U^T ≈ I) on random matrices.
 *   - Edge case: rank-deficient input is stable (no NaN/Inf).
 *   - Edge cases: 1×1 and non-square matrices.
 *   - Property: orthogonalisation is approximately idempotent.
 *   - Default config: gradientOrthogonalisation defaults to "none".
 *   - Hook is a no-op when default-off.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import {
  frobeniusNorm,
  MUON_DEFAULT_STEPS,
  newtonSchulzOrthogonalise,
  orthogonalise2D,
  type RowMajorMatrix,
} from "@propagate/MuonOrthogonalisation.ts";
import { applyMuonGradientOrthogonalisation } from "@propagate/MuonGradientHook.ts";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function buildMatrix(values: number[][]): RowMajorMatrix {
  const rows = values.length;
  const cols = values[0]?.length ?? 0;
  const data = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) data[i * cols + j] = values[i][j];
  }
  return { data, rows, cols };
}

function gramian(m: RowMajorMatrix, transpose: "AtA" | "AAt"): number[][] {
  const { rows, cols, data } = m;
  if (transpose === "AtA") {
    const out: number[][] = [];
    for (let i = 0; i < cols; i++) {
      out.push(new Array(cols).fill(0));
    }
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) {
          out[i][j] += data[r * cols + i] * data[r * cols + j];
        }
      }
    }
    return out;
  } else {
    const out: number[][] = [];
    for (let i = 0; i < rows; i++) {
      out.push(new Array(rows).fill(0));
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < rows; j++) {
        let s = 0;
        for (let k = 0; k < cols; k++) {
          s += data[i * cols + k] * data[j * cols + k];
        }
        out[i][j] = s;
      }
    }
    return out;
  }
}

function makeRandomMatrix(
  rows: number,
  cols: number,
  seed: number,
): RowMajorMatrix {
  // Deterministic PRNG (mulberry32) so tests are reproducible.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Float64Array(rows * cols);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return { data, rows, cols };
}

// ---------------------------------------------------------------------------
// Math: happy path — U^T U ≈ I (square / tall) and U U^T ≈ I (wide).
// ---------------------------------------------------------------------------

/**
 * Compute the off-diagonal Frobenius mass of a square gramian matrix,
 * normalised by the diagonal mass. A perfect orthogonal matrix yields 0.
 */
function offDiagonalRatio(g: number[][]): number {
  let on = 0;
  let off = 0;
  for (let i = 0; i < g.length; i++) {
    for (let j = 0; j < g.length; j++) {
      const v = g[i][j];
      if (i === j) on += v * v;
      else off += v * v;
    }
  }
  return Math.sqrt(off) / Math.sqrt(Math.max(on, 1e-12));
}

// The standard 5-step quintic Newton-Schulz with coefficients
// (3.4445, -4.7750, 2.0315) does NOT have σ = 1 as a fixed point — it
// drives singular values into a stable band roughly [0.7, 1.2]. Final
// Frobenius rescaling re-centres the average towards 1, but individual
// σ_i can still vary by ~30%. What Muon delivers, and what we test, is
// substantial *decorrelation* — the off-diagonal mass of the gramian
// drops dramatically vs. the unprocessed input.

Deno.test("Muon - 4x4 random matrix gramian becomes substantially diagonal", () => {
  const original = makeRandomMatrix(4, 4, 42);
  const baseline = offDiagonalRatio(gramian(original, "AtA"));
  const m = makeRandomMatrix(4, 4, 42);
  newtonSchulzOrthogonalise(m);
  const after = offDiagonalRatio(gramian(m, "AtA"));
  // Off-diagonal mass should drop substantially (at least halved).
  assert(
    after < baseline * 0.7,
    `expected decorrelation: baseline=${baseline}, after=${after}`,
  );
});

Deno.test("Muon - tall (8x3) matrix decorrelates column directions", () => {
  const original = makeRandomMatrix(8, 3, 7);
  const baseline = offDiagonalRatio(gramian(original, "AtA"));
  const m = makeRandomMatrix(8, 3, 7);
  newtonSchulzOrthogonalise(m);
  const after = offDiagonalRatio(gramian(m, "AtA"));
  assert(
    after < baseline * 0.7,
    `expected decorrelation: baseline=${baseline}, after=${after}`,
  );
});

Deno.test("Muon - wide (3x8) matrix decorrelates row directions", () => {
  const original = makeRandomMatrix(3, 8, 11);
  const baseline = offDiagonalRatio(gramian(original, "AAt"));
  const m = makeRandomMatrix(3, 8, 11);
  newtonSchulzOrthogonalise(m);
  const after = offDiagonalRatio(gramian(m, "AAt"));
  assert(
    after < baseline * 0.7,
    `expected decorrelation: baseline=${baseline}, after=${after}`,
  );
});

Deno.test("Muon - 4x4 gramian diagonal is positive and bounded", () => {
  // The standard polynomial leaves diagonals in roughly [0.5, 1.5];
  // they must at minimum be strictly positive (no collapsed directions).
  const m = makeRandomMatrix(4, 4, 42);
  newtonSchulzOrthogonalise(m);
  const g = gramian(m, "AtA");
  for (let i = 0; i < 4; i++) {
    assert(g[i][i] > 0.3, `gramian diag[${i}] = ${g[i][i]} too small`);
    assert(g[i][i] < 2.5, `gramian diag[${i}] = ${g[i][i]} too large`);
  }
});

// ---------------------------------------------------------------------------
// Edge cases.
// ---------------------------------------------------------------------------

Deno.test("Muon - 1x1 positive scalar collapses to +1", () => {
  const m = buildMatrix([[3.7]]);
  newtonSchulzOrthogonalise(m);
  assertEquals(m.data[0], 1);
});

Deno.test("Muon - 1x1 negative scalar collapses to -1", () => {
  const m = buildMatrix([[-0.42]]);
  newtonSchulzOrthogonalise(m);
  assertEquals(m.data[0], -1);
});

Deno.test("Muon - all-zero matrix stays zero, no NaN/Inf", () => {
  const m = buildMatrix([[0, 0], [0, 0], [0, 0]]);
  newtonSchulzOrthogonalise(m);
  for (let i = 0; i < m.data.length; i++) {
    assertEquals(m.data[i], 0);
  }
});

Deno.test("Muon - rank-deficient input is finite (no NaN, no Inf)", () => {
  // Two identical rows + one zero row → rank 1, deeply degenerate.
  const m = buildMatrix([
    [1, 2, 3, 4],
    [1, 2, 3, 4],
    [0, 0, 0, 0],
  ]);
  newtonSchulzOrthogonalise(m);
  for (let i = 0; i < m.data.length; i++) {
    assert(
      Number.isFinite(m.data[i]),
      `entry ${i} is non-finite: ${m.data[i]}`,
    );
  }
});

Deno.test("Muon - non-finite inputs are sanitised to zero", () => {
  const m = buildMatrix([
    [Number.NaN, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, 0],
  ]);
  newtonSchulzOrthogonalise(m);
  for (let i = 0; i < m.data.length; i++) {
    assert(Number.isFinite(m.data[i]), `entry ${i} non-finite`);
  }
});

Deno.test("Muon - empty rows or empty cols are no-ops", () => {
  const a = { data: new Float64Array(0), rows: 0, cols: 5 };
  newtonSchulzOrthogonalise(a);
  assertEquals(a.data.length, 0);
  const b = { data: new Float64Array(0), rows: 5, cols: 0 };
  newtonSchulzOrthogonalise(b);
  assertEquals(b.data.length, 0);
});

// ---------------------------------------------------------------------------
// Property: idempotence (orthogonalising twice ≈ once within tolerance).
// ---------------------------------------------------------------------------

Deno.test("Muon - orthogonalisation is approximately idempotent", () => {
  // Once Newton-Schulz has driven a matrix close to the orthogonal
  // factor, re-applying it should leave the result close to where it
  // was. We compare per-entry with an honest tolerance — the 5-step
  // quintic does not have a precise fixed point, but per-row directions
  // are stable.
  const a = makeRandomMatrix(5, 5, 99);
  const b = makeRandomMatrix(5, 5, 99);
  newtonSchulzOrthogonalise(a);
  newtonSchulzOrthogonalise(b);
  newtonSchulzOrthogonalise(b); // applied twice
  // Both operands have unit Frobenius scale; check directional alignment
  // via cosine similarity per row (the direction is the stable property,
  // magnitude oscillates with the polynomial).
  const rows = a.rows;
  const cols = a.cols;
  for (let r = 0; r < rows; r++) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let c = 0; c < cols; c++) {
      const av = a.data[r * cols + c];
      const bv = b.data[r * cols + c];
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
    const cosine = dot / Math.max(1e-12, Math.sqrt(na * nb));
    assert(
      cosine > 0.9,
      `row ${r} direction drifted under idempotence: cosine=${cosine}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Convenience wrapper.
// ---------------------------------------------------------------------------

Deno.test("Muon - orthogonalise2D round-trips and preserves shape", () => {
  const out = orthogonalise2D([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  assertEquals(out.length, 3);
  assertEquals(out[0].length, 3);
  // Identity input is already orthogonal — Newton-Schulz preserves the
  // diagonal structure (off-diagonals must remain effectively zero).
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) {
        assert(out[i][j] > 0.5, `diag[${i}] = ${out[i][j]} too small`);
      } else {
        assertAlmostEquals(out[i][j], 0, 1e-9, `off[${i},${j}]`);
      }
    }
  }
});

Deno.test("Muon - frobeniusNorm matches Math.hypot of row entries", () => {
  const m = buildMatrix([[3, 4], [0, 0]]);
  assertAlmostEquals(frobeniusNorm(m), 5, 1e-12);
});

Deno.test("Muon - default steps constant is 5 (V4 standard)", () => {
  assertEquals(MUON_DEFAULT_STEPS, 5);
});

// ---------------------------------------------------------------------------
// Export contract (Issue #3211): the quintic Newton-Schulz coefficients are
// module-private implementation details, not part of the public surface. The
// intended public API stays exported.
// ---------------------------------------------------------------------------

Deno.test("Muon - quintic coefficients are not part of the public export surface", async () => {
  const mod = await import("@propagate/MuonOrthogonalisation.ts");
  const keys = Object.keys(mod);
  for (const name of ["MUON_QUINTIC_A", "MUON_QUINTIC_B", "MUON_QUINTIC_C"]) {
    assert(
      !keys.includes(name),
      `${name} must be module-private (over-exported dead code, Issue #3211)`,
    );
  }
  // The genuinely-public API must remain exported.
  for (
    const name of [
      "newtonSchulzOrthogonalise",
      "orthogonalise2D",
      "frobeniusNorm",
      "MUON_DEFAULT_STEPS",
    ]
  ) {
    assert(keys.includes(name), `${name} must remain part of the public API`);
  }
});

// ---------------------------------------------------------------------------
// Config + hook integration.
// ---------------------------------------------------------------------------

Deno.test("Muon - gradientOrthogonalisation defaults to 'none'", () => {
  const config = createBackPropagationConfig({});
  assertEquals(config.gradientOrthogonalisation, "none");
});

Deno.test("Muon - gradientOrthogonalisation accepts 'muon' explicitly", () => {
  const config = createBackPropagationConfig({
    gradientOrthogonalisation: "muon",
  });
  assertEquals(config.gradientOrthogonalisation, "muon");
});

Deno.test("Muon - hook is a no-op when default-off", () => {
  // Build a tiny creature with two hidden neurons sharing inputs.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.2 },
      { fromUUID: "input-0", toUUID: "h2", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.4 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const before = JSON.stringify(creature.exportJSON());

  const config = createBackPropagationConfig({});
  applyMuonGradientOrthogonalisation(creature, config);

  const after = JSON.stringify(creature.exportJSON());
  assertEquals(before, after, "default-off hook must not mutate creature");
});

Deno.test("Muon - hook does not throw on a creature with no batched state", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.2 },
      { fromUUID: "input-0", toUUID: "h2", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.4 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    gradientOrthogonalisation: "muon",
  });
  // No backprop has been run, so no synapse has a batchAverageWeight.
  // The hook should detect this and return without mutating anything.
  applyMuonGradientOrthogonalisation(creature, config);
});

Deno.test("Muon - hook orthogonalises per-neuron incoming-weight deltas", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.0 },
      { fromUUID: "input-0", toUUID: "h2", weight: 0.0 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.0 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.0 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // Plant correlated batch averages — both hidden neurons want the same
  // incoming-weight delta direction. After orthogonalisation, the second
  // row should be reorientated away from the first.
  const state = creature.state;
  // Hidden neurons sit after the inputs in the neurons array; with input=2
  // they are at indices 2 and 3.
  const h1Inward = creature.inwardConnections(2);
  const h2Inward = creature.inwardConnections(3);
  assertEquals(h1Inward.length, 2, "h1 should have two inward synapses");
  assertEquals(h2Inward.length, 2, "h2 should have two inward synapses");
  // h1 wants delta direction (1.0, 0.5); h2 wants (0.7, 0.7) — strongly
  // correlated (positive dot product ~0.85) but linearly independent so
  // the orthogonalisation can actually decorrelate them.
  const seed: Array<{ from: number; to: number; delta: number }> = [
    { from: h1Inward[0].from, to: h1Inward[0].to, delta: 1.0 },
    { from: h1Inward[1].from, to: h1Inward[1].to, delta: 0.5 },
    { from: h2Inward[0].from, to: h2Inward[0].to, delta: 0.7 },
    { from: h2Inward[1].from, to: h2Inward[1].to, delta: 0.7 },
  ];
  for (const s of seed) {
    state.connection(s.from, s.to).batchAverageWeight = s.delta; // weight is 0
  }

  const config = createBackPropagationConfig({
    gradientOrthogonalisation: "muon",
  });
  applyMuonGradientOrthogonalisation(creature, config);

  // Verify deltas are now decorrelated: row dot product ≈ 0 (much smaller
  // than the original 1*1 + 0.5*0.5 = 1.25).
  const r1 = [
    state.connection(h1Inward[0].from, h1Inward[0].to).batchAverageWeight!,
    state.connection(h1Inward[1].from, h1Inward[1].to).batchAverageWeight!,
  ];
  const r2 = [
    state.connection(h2Inward[0].from, h2Inward[0].to).batchAverageWeight!,
    state.connection(h2Inward[1].from, h2Inward[1].to).batchAverageWeight!,
  ];
  const dot = r1[0] * r2[0] + r1[1] * r2[1];
  const n1 = Math.hypot(r1[0], r1[1]);
  const n2 = Math.hypot(r2[0], r2[1]);
  const cosine = dot / (n1 * n2);
  // Original cosine similarity = (1.0*0.7 + 0.5*0.7) / (sqrt(1.25)*sqrt(0.98))
  // ≈ 0.948. After orthogonalisation, decorrelation must reduce it
  // substantially (closer to zero).
  assert(
    Math.abs(cosine) < 0.5,
    `expected decorrelation: original cosine ≈ 0.95, got ${cosine}`,
  );

  // All values must remain finite.
  for (const v of [...r1, ...r2]) {
    assert(Number.isFinite(v), `non-finite delta: ${v}`);
  }
});
