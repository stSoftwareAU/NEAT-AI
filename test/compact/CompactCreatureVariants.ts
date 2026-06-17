import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  compactCreature,
  compactCreatureVariants,
} from "@compact/CompactCreature.ts";
import { selectCompactVariant } from "@compact/CompactVariants.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #3037: compaction surfaces two candidates — a `safe` variant (all exact
// folds, score guaranteed ≥ original) and an `aggressive` variant (safe folds
// plus extra structural pruning). In this plumbing issue the aggressive pass is
// a no-op placeholder equal to the safe variant, so the two must dedupe via the
// existing UUID dedup rather than being scored twice.

const FIXTURE = "test/data/constant-fold-full-removal.json";

function loadFixture(path: string): CreatureExport {
  return JSON.parse(Deno.readTextFileSync(path)) as CreatureExport;
}

/** Build a tiny IDENTITY input→output creature with a given output bias. */
function tinyCreature(bias: number, score?: number): Creature {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  } as unknown as CreatureExport;
  const creature = Creature.fromJSON(json, false);
  if (score !== undefined) creature.score = score;
  return creature;
}

Deno.test(
  "compactCreatureVariants returns both a safe and an aggressive candidate",
  async () => {
    await initWasmForTests();

    const creature = Creature.fromJSON(loadFixture(FIXTURE), false);
    const variants = compactCreatureVariants(creature, false);

    assert(variants.safe !== undefined, "safe candidate should exist");
    assert(
      variants.aggressive !== undefined,
      "aggressive candidate should exist",
    );
  },
);

Deno.test(
  "compactCreature returns the safe variant for back-compat",
  async () => {
    await initWasmForTests();

    const safeOnly = compactCreature(
      Creature.fromJSON(loadFixture(FIXTURE), false),
      false,
    );
    const variants = compactCreatureVariants(
      Creature.fromJSON(loadFixture(FIXTURE), false),
      false,
    );

    assert(safeOnly !== undefined, "compactCreature should still compact");
    assertEquals(
      CreatureUtil.makeUUID(safeOnly!),
      CreatureUtil.makeUUID(variants.safe!),
      "compactCreature must return the safe variant",
    );
  },
);

Deno.test(
  "no-op aggressive pass dedupes to a single scored candidate via UUID",
  async () => {
    await initWasmForTests();

    const variants = compactCreatureVariants(
      Creature.fromJSON(loadFixture(FIXTURE), false),
      false,
    );

    // Identical variants share a UUID.
    assertEquals(
      CreatureUtil.makeUUID(variants.safe!),
      CreatureUtil.makeUUID(variants.aggressive!),
      "no-op aggressive variant must equal the safe variant",
    );

    // Mirror the call-site selection: offering both candidates to a
    // UUID-deduping set must collect exactly one unique candidate.
    const UUIDs = new Set<string>();
    for (const candidate of [variants.safe, variants.aggressive]) {
      if (candidate) UUIDs.add(CreatureUtil.makeUUID(candidate));
    }
    assertEquals(UUIDs.size, 1, "identical variants must dedupe to one");

    // selectCompactVariant keeps the safe floor and never scores the duplicate.
    assertEquals(
      selectCompactVariant(variants),
      variants.safe,
      "selection must keep the safe variant",
    );
  },
);

Deno.test(
  "compactCreatureVariants returns empty when nothing compacts",
  async () => {
    await initWasmForTests();

    // A bare input→output creature has nothing to fold.
    const variants = compactCreatureVariants(tinyCreature(0.1), false);

    assertEquals(variants.safe, undefined, "no safe candidate when no-op");
    assertEquals(
      variants.aggressive,
      undefined,
      "no aggressive candidate when no-op",
    );
  },
);

Deno.test("selectCompactVariant falls back to the present variant", () => {
  const safe = tinyCreature(0.1);
  const aggressive = tinyCreature(0.2);

  assertEquals(
    selectCompactVariant({ safe }),
    safe,
    "returns safe when aggressive is absent",
  );
  assertEquals(
    selectCompactVariant({ aggressive }),
    aggressive,
    "returns aggressive when safe is absent",
  );
  assertEquals(
    selectCompactVariant({}),
    undefined,
    "returns undefined when empty",
  );
});

Deno.test(
  "selectCompactVariant keeps safe when variants are identical (distinct instances)",
  () => {
    // Two distinct Creature instances with identical structure share a UUID.
    const safe = tinyCreature(0.1, 5);
    const aggressive = tinyCreature(0.1, 999); // score ignored — identical UUID

    assertEquals(
      CreatureUtil.makeUUID(safe),
      CreatureUtil.makeUUID(aggressive),
      "fixture sanity: clones must share a UUID",
    );
    assertEquals(
      selectCompactVariant({ safe, aggressive }),
      safe,
      "duplicate must never be scored — keep the safe floor",
    );
  },
);

Deno.test(
  "selectCompactVariant prefers a distinct, strictly higher-scoring aggressive",
  () => {
    const safe = tinyCreature(0.1, 5);
    const aggressive = tinyCreature(0.2, 6); // distinct UUID, higher score

    assert(
      CreatureUtil.makeUUID(safe) !== CreatureUtil.makeUUID(aggressive),
      "fixture sanity: variants must differ",
    );
    assertEquals(
      selectCompactVariant({ safe, aggressive }),
      aggressive,
      "higher-scoring distinct aggressive wins",
    );
  },
);

Deno.test(
  "selectCompactVariant keeps safe when aggressive does not improve the score",
  () => {
    const safe = tinyCreature(0.1, 6);
    const lower = tinyCreature(0.2, 5); // distinct, lower score
    assertEquals(
      selectCompactVariant({ safe, aggressive: lower }),
      safe,
      "lower-scoring aggressive must not displace the safe floor",
    );

    const tieSafe = tinyCreature(0.1, 5);
    const tieAggr = tinyCreature(0.2, 5); // distinct, equal score
    assertEquals(
      selectCompactVariant({ safe: tieSafe, aggressive: tieAggr }),
      tieSafe,
      "ties keep the safe floor",
    );
  },
);
