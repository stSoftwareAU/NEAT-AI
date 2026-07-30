import { assert, assertEquals } from "@std/assert";
import { enumerateOptionKeys } from "../../scripts/lib/optionInventory.ts";
import {
  OPTION_AUDIT_ROLLUP,
  removalIssuesByKey,
} from "../../scripts/lib/optionAuditRollup.ts";
import {
  reconcile,
  toConsolidatedMarkdown,
} from "../../scripts/lib/optionAuditReconcile.ts";

/**
 * Roll-up reconciliation for the #3505 option-removal audit (Issue #3525).
 *
 * The audit's own failure-detection brief requires the coverage check to be
 * mechanical: diff the #3518 harness key inventory against the merged
 * classification table rather than eyeballing the six slice comments. These
 * tests are that check, run on every CI build so the roll-up cannot silently
 * go stale when the config surface moves.
 */

const rows = await enumerateOptionKeys(".");
const result = reconcile(rows, OPTION_AUDIT_ROLLUP);

// -------------------------------------------------------------- coverage

Deno.test("reconcile - every enumerated option key is classified", () => {
  assertEquals(
    result.gaps,
    [],
    `unclassified keys must be filed as follow-ups, not lost:\n${
      result.gaps.map((g) => `  ${g.reason}: ${g.detail}`).join("\n")
    }`,
  );
});

Deno.test("reconcile - classifies the whole enumerated surface", () => {
  assertEquals(result.classified.length, rows.length);
  assert(
    result.classified.every((c) => c.verdict !== undefined),
    "every row resolves to a verdict",
  );
});

Deno.test("reconcile - top-level coverage matches NeatArguments exactly", () => {
  const topLevel = rows.filter((r) => r.slice === "top-level");
  const covered = new Set(
    result.classified.filter((c) => c.row.slice === "top-level").map((c) =>
      c.row.key
    ),
  );
  assertEquals(covered.size, topLevel.length);
  // `mutation` is the key the six slice briefs missed: they were built from a
  // grep that skipped `readonly mutation`, which is why #3518 quoted 118
  // top-level fields where the parser sees 119. The roll-up classifies it.
  assert(covered.has("mutation"), "the #3518 118-vs-119 gap key is covered");
});

Deno.test("reconcile - no roll-up entry describes a key that no longer exists", () => {
  assertEquals(
    result.orphans,
    [],
    `roll-up entries with no matching source key: ${result.orphans.join(", ")}`,
  );
});

// ---------------------------------------------------------- removal issues

Deno.test("rollup - every QUALIFIES verdict carries a removal issue", () => {
  const unlinked = result.classified
    .filter((c) => c.verdict === "QUALIFIES" && c.issue === undefined)
    .map((c) => c.row.key);
  assertEquals(unlinked, [], "QUALIFIES without a linked issue");
});

Deno.test("rollup - no option key is claimed by two removal issues", () => {
  const duplicated = [...removalIssuesByKey(OPTION_AUDIT_ROLLUP)]
    .filter(([, issues]) => issues.length > 1)
    .map(([key, issues]) => `${key} → ${issues.join(", ")}`);
  assertEquals(duplicated, [], "cross-slice duplicate removal issues");
});

Deno.test("rollup - the named cross-slice overlaps resolve to one issue each", () => {
  const byKey = removalIssuesByKey(OPTION_AUDIT_ROLLUP);
  // The three overlap pairs the roll-up brief names. `seed` is not a
  // NeatArguments field at all (it is input-only, resolved into `rng`), so the
  // A↔E pair reduces to `rng`, which no issue touches.
  assertEquals(byKey.get("dnaSharingMode"), [3554]);
  assertEquals(byKey.get("rng"), undefined);
  assertEquals(byKey.get("discoveryCache"), undefined);
  assertEquals(byKey.get("discoveryDiskSpace"), undefined);
});

Deno.test("rollup - verdict totals are internally consistent", () => {
  const counts = new Map<string, number>();
  for (const c of result.classified) {
    counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assertEquals(total, rows.length);
  assert((counts.get("IN USE") ?? 0) > 0, "some options are consumer-set");
  assert((counts.get("QUALIFIES") ?? 0) > 0, "some options qualify");
});

// ---------------------------------------------------------------- report

Deno.test("toConsolidatedMarkdown - renders every classified key", () => {
  const md = toConsolidatedMarkdown(result);
  for (const key of ["populationSize", "mutation", "specialist", "mcmc"]) {
    assert(md.includes(`\`${key}\``), `${key} missing from the merged table`);
  }
  assert(md.includes("| `mutation`"), "the gap key has its own table row");
  assert(md.includes("#3554"), "removal issue numbers are rendered");
});

Deno.test("toConsolidatedMarkdown - reports a gap loudly when one exists", () => {
  const withGap = reconcile(
    [...rows, {
      slice: "top-level" as const,
      ownerFile: "src/config/NeatArguments.ts",
      owner: "NeatArguments",
      key: "aKeyNobodyClassified",
    }],
    OPTION_AUDIT_ROLLUP,
  );
  assertEquals(withGap.gaps.length, 1);
  assertEquals(withGap.gaps[0].detail, "aKeyNobodyClassified");
  assert(
    toConsolidatedMarkdown(withGap).includes("aKeyNobodyClassified"),
    "a gap must appear in the report rather than being silently dropped",
  );
});
