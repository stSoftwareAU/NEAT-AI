/**
 * Identical-descriptor / different-score incidence (Issue #3929).
 *
 * Two creatures with the same descriptor but materially different exact scores
 * mean the descriptor is blind to something that decides fitness — and no
 * surrogate fitted to the archive can see it either. The incidence rate is
 * therefore a ceiling on any such model, which makes it worth measuring before
 * a model is built rather than after it disappoints.
 */

import { assert, assertEquals } from "@std/assert";
import type { EvaluationArchiveRecord } from "@archive/EvaluationArchive.ts";
import {
  DEFAULT_COLLISION_TOLERANCE,
  formatDescriptorCollisionReport,
  reportDescriptorCollisions,
} from "@archive/DescriptorCollisions.ts";
import { EVALUATION_DESCRIPTOR_VERSION } from "@archive/EvaluationDescriptor.ts";

/** A record carrying the given descriptor, score and fidelity. */
function record(
  descriptor: number[],
  score: number,
  fidelity = 1,
): EvaluationArchiveRecord {
  return {
    descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
    runId: "run",
    generation: 1,
    uuid: `${descriptor.join("-")}:${score}`,
    parents: [],
    operators: [],
    score,
    fidelity,
    recordedAt: "2026-01-01T00:00:00Z",
    descriptor,
  };
}

Deno.test("descriptor collisions - an empty archive reports zero incidence", () => {
  const report = reportDescriptorCollisions([]);
  assertEquals(report.records, 0);
  assertEquals(report.incidence, 0);
  assertEquals(report.collidingRecords, 0);
});

Deno.test("descriptor collisions - distinct descriptors never collide", () => {
  const report = reportDescriptorCollisions([
    record([1, 0], 0.5),
    record([2, 0], 0.9),
    record([3, 0], 0.1),
  ]);
  assertEquals(report.records, 3);
  assertEquals(report.distinctDescriptors, 3);
  assertEquals(report.sharedDescriptors, 0);
  assertEquals(report.collidingDescriptors, 0);
  assertEquals(report.incidence, 0);
});

Deno.test("descriptor collisions - identical descriptors agreeing on score are not blindness", () => {
  const report = reportDescriptorCollisions([
    record([1, 0], 0.5),
    record([1, 0], 0.5),
  ]);
  assertEquals(report.sharedDescriptors, 1);
  assertEquals(report.collidingDescriptors, 0);
  assertEquals(report.incidence, 0);
  assertEquals(report.maxSpread, 0);
});

Deno.test("descriptor collisions - a real disagreement is counted and measured", () => {
  const report = reportDescriptorCollisions([
    record([1, 0], 0.10),
    record([1, 0], 0.40),
    record([2, 0], 0.70),
    record([3, 0], 0.90),
  ]);
  assertEquals(report.records, 4);
  assertEquals(report.distinctDescriptors, 3);
  assertEquals(report.collidingDescriptors, 1);
  assertEquals(report.collidingRecords, 2);
  assertEquals(report.incidence, 0.5);
  assert(
    Math.abs(report.maxSpread - 0.3) < 1e-12,
    `unexpected spread ${report.maxSpread}`,
  );
  assertEquals(report.worstGroups.length, 1);
  assertEquals(report.worstGroups[0].records, 2);
  assertEquals(report.worstGroups[0].minScore, 0.10);
  assertEquals(report.worstGroups[0].maxScore, 0.40);
});

Deno.test("descriptor collisions - float noise below the tolerance is not a collision", () => {
  const noise = DEFAULT_COLLISION_TOLERANCE / 10;
  const report = reportDescriptorCollisions([
    record([1, 0], 0.5),
    record([1, 0], 0.5 + noise),
  ]);
  assertEquals(report.collidingDescriptors, 0);

  // The same pair, judged with no tolerance at all, is a collision.
  const strict = reportDescriptorCollisions(
    [record([1, 0], 0.5), record([1, 0], 0.5 + noise)],
    0,
  );
  assertEquals(strict.collidingDescriptors, 1);
});

Deno.test("descriptor collisions - only exact records are judged", () => {
  const report = reportDescriptorCollisions([
    record([1, 0], 0.5),
    record([1, 0], 0.9, 0.2),
  ]);
  assertEquals(
    report.records,
    1,
    "a partial score differing says nothing about the descriptor",
  );
  assertEquals(report.collidingDescriptors, 0);
});

Deno.test("descriptor collisions - the report renders the numbers an operator needs", () => {
  const text = formatDescriptorCollisionReport(
    reportDescriptorCollisions([
      record([1, 0], 0.1),
      record([1, 0], 0.4),
      record([2, 0], 0.7),
    ]),
  );
  assert(text.includes("exact records: 3"), text);
  assert(text.includes("colliding records: 2"), text);
  assert(text.includes("66.667% incidence"), text);
});
