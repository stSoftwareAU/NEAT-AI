/**
 * The refusal to extrapolate (Issue #3933).
 *
 * The case the issue names as decisive: an out-of-distribution descriptor
 * yields a **refusal**, not a prediction. In a NEAT population that is not an
 * edge case — novel topologies are the mechanism, and they are by construction
 * the points the model has no data near.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { CoverageRegion } from "@surrogate/CoverageRegion.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** The guard defaults, spelt out so a test reads without the config module. */
const OPTIONS = { quantile: 0.95, factor: 1.5, margin: 0.5 };

/** A tight cluster of archived creatures: descriptor slots close together. */
function archivedCluster(): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < 12; i++) {
    rows.push([10 + i * 0.5, 40 + i, 3 + i * 0.1]);
  }
  return rows;
}

Deno.test("coverage region — a creature like the archived ones is covered", () => {
  const region = CoverageRegion.fit(archivedCluster(), OPTIONS);
  const reading = region.classify([12.6, 45.5, 3.55]);
  assertEquals(reading.inside, true);
  assertEquals(reading.verdict, undefined);
  assert(reading.distance <= reading.radius);
});

Deno.test("coverage region — a novel topology is refused, not predicted", () => {
  const region = CoverageRegion.fit(archivedCluster(), OPTIONS);
  // Three times the neurons of anything archived: the box test alone settles
  // it, whatever the remaining slots say.
  const reading = region.classify([300, 1200, 90]);
  assertEquals(reading.inside, false);
  assert(reading.verdict !== undefined);
  assertEquals(reading.verdict.kind, "out-of-distribution");
  assert(
    reading.verdict.reason.includes("outside the range"),
    `unexpected refusal reason: ${reading.verdict.reason}`,
  );
});

Deno.test("coverage region — a hole inside the box is still an extrapolation", () => {
  // Two tight clusters far apart on one slot: the midpoint is inside the box
  // of both and near neither, which is exactly the extrapolation the radius
  // test exists for.
  const rows: number[][] = [];
  for (let i = 0; i < 8; i++) rows.push([1 + i * 0.01, 5 + i * 0.01]);
  for (let i = 0; i < 8; i++) rows.push([9 + i * 0.01, 5 + i * 0.01]);
  const region = CoverageRegion.fit(rows, OPTIONS);
  const reading = region.classify([5, 5.04]);
  assertEquals(reading.inside, false);
  assert(
    reading.verdict?.reason.includes("nearest archived creature"),
    `unexpected refusal reason: ${reading.verdict?.reason}`,
  );
  assert(reading.distance > reading.radius);
});

Deno.test("coverage region — a non-finite descriptor slot is refused", () => {
  const region = CoverageRegion.fit(archivedCluster(), OPTIONS);
  const reading = region.classify([12, Number.NaN, 3.4]);
  assertEquals(reading.inside, false);
  assertEquals(reading.verdict?.kind, "out-of-distribution");
});

Deno.test("coverage region — a descriptor of the wrong width fails loud", () => {
  const region = CoverageRegion.fit(archivedCluster(), OPTIONS);
  const error = assertThrows(
    () => region.classify([12, 45]),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "INVALID_COVERAGE_REGION");
});

Deno.test("coverage region — an empty archive covers nothing and says so", () => {
  const error = assertThrows(
    () => CoverageRegion.fit([], OPTIONS),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "INVALID_COVERAGE_REGION");
});

Deno.test("coverage region — a non-finite archived descriptor is refused", () => {
  const rows = archivedCluster();
  rows[3][1] = Number.POSITIVE_INFINITY;
  const error = assertThrows(
    () => CoverageRegion.fit(rows, OPTIONS),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "INVALID_COVERAGE_REGION");
});

Deno.test("coverage region — an archive at one point supports no extrapolation", () => {
  const rows = Array.from({ length: 5 }, () => [7, 7, 7]);
  const region = CoverageRegion.fit(rows, OPTIONS);
  // Every column is constant, so the descriptor cannot tell these creatures
  // apart: the honest reading is "covered, and know nothing", which the
  // prediction then carries as a full window spread of doubt.
  assertEquals(region.classify([7, 7, 7]).inside, true);
  assertEquals(region.classify([70, 7, 7]).inside, true);
});

Deno.test("coverage region — the standardised rows are shared with the model", () => {
  const rows = archivedCluster();
  const region = CoverageRegion.fit(rows, OPTIONS);
  assertEquals(region.size, rows.length);
  assertEquals(region.descriptorWidth, 3);
  // The projection a consumer uses for its own distances is the region's own,
  // so a candidate cannot be judged covered under one scaling and predicted
  // under another.
  assertEquals(region.project(rows[0]), [...region.scaledRows[0]]);
});
