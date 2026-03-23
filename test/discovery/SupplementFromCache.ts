/**
 * Tests for supplementing Phase 2 combination building with success cache data.
 *
 * Issue #1734: When Phase 1 produces only 1 successful single candidate,
 * supplement with historically successful candidates from the success cache
 * to enable combination building.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  supplementFromCache,
} from "../../src/discovery/SupplementFromCache.ts";
import { recordSuccessSync } from "../../src/discovery/SuccessCache.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

// Deterministic integer ID for "hidden-1" (from deterministicIdFromUuid)
const HIDDEN_1_ID = 1775329650;
// Input neuron IDs
const INPUT_0_ID = 0;
// Output neuron ID
const OUTPUT_0_ID = -1;

/** Helper to create a candidate creature with a squash change applied. */
function makeSquashCandidate(
  base: Creature,
  neuronId: number,
  squash: string,
): DiscoveryCandidate {
  const json = base.exportJSON();
  const neuron = json.neurons.find((n) => n.id === neuronId);
  if (!neuron) throw new Error(`Neuron ${neuronId} not found`);
  neuron.squash = squash;
  const modified = Creature.fromJSON(json);
  modified.validate();
  CreatureUtil.makeUUID(modified);
  return {
    creature: modified,
    change: {
      type: "change-squash",
      description: `Change squash on ${neuronId} to ${squash}`,
      squashCandidate: {
        neuronId,
        previousSquash: "IDENTITY",
        squash,
        expectedCreatureScoreGain: 0.1,
        improvedError: 0.05,
        currentError: 0.1,
      },
    },
  };
}

/** Helper to create a candidate with an added synapse. */
function makeAddSynapseCandidate(
  base: Creature,
  fromId: number,
  toId: number,
  weight: number,
): DiscoveryCandidate {
  const json = base.exportJSON();
  json.synapses.push({ fromId, toId, weight });
  const modified = Creature.fromJSON(json);
  modified.validate();
  CreatureUtil.makeUUID(modified);
  return {
    creature: modified,
    change: {
      type: "add-synapses",
      description: `Add synapse ${fromId} → ${toId}`,
      synapseCandidate: {
        fromNeuronId: fromId,
        toNeuronId: toId,
        weight,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.15,
        improvedCount: 4,
        totalCount: 6,
      },
    },
  };
}

Deno.test("supplementFromCache returns empty when no cache dir", () => {
  const creature = makeBaseCreature();
  const result = supplementFromCache(creature, undefined, []);
  assertEquals(result.length, 0);
});

Deno.test("supplementFromCache returns empty when cache is empty", () => {
  const tmpDir = Deno.makeTempDirSync();
  try {
    const creature = makeBaseCreature();
    const result = supplementFromCache(creature, tmpDir, []);
    assertEquals(result.length, 0);
  } finally {
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

Deno.test({
  name: "supplementFromCache returns candidates from cache",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record a squash change candidate in the cache
      const squashCandidate = makeSquashCandidate(base, HIDDEN_1_ID, "TANH");
      recordSuccessSync(tmpDir, squashCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      // Supplement should find the cached entry
      const result = supplementFromCache(base, tmpDir, []);
      assert(
        result.length > 0,
        "Should return at least 1 supplemental candidate",
      );
      assertEquals(
        result[0].change.type,
        "change-squash",
        "Supplemented candidate should be change-squash",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
});

Deno.test(
  "supplementFromCache skips already-applied entries",
  () => {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record a squash change to TANH in the cache
      const squashCandidate = makeSquashCandidate(base, HIDDEN_1_ID, "TANH");
      recordSuccessSync(tmpDir, squashCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      // Create a creature that already has hidden-1 as TANH
      const alreadyApplied = squashCandidate.creature;

      // Supplement should skip the already-applied entry
      const result = supplementFromCache(alreadyApplied, tmpDir, []);
      assertEquals(
        result.length,
        0,
        "Should not return candidates that are already applied",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "supplementFromCache skips entries referencing non-existent neurons",
  () => {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record a squash change for a neuron that exists in the base creature
      const squashCandidate = makeSquashCandidate(base, HIDDEN_1_ID, "TANH");
      recordSuccessSync(tmpDir, squashCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      // Create a different creature that does NOT have hidden-1
      const differentCreature = Creature.fromJSON({
        input: 2,
        output: 1,
        neurons: [
          {
            type: "hidden",
            uuid: "hidden-99",
            squash: "IDENTITY",
            bias: 0,
          },
          {
            type: "output",
            uuid: "output-0",
            squash: "IDENTITY",
            bias: 0,
          },
        ],
        synapses: [
          { fromUUID: "input-0", toUUID: "hidden-99", weight: 0.5 },
          { fromUUID: "hidden-99", toUUID: "output-0", weight: 0.5 },
        ],
      });
      differentCreature.validate();
      CreatureUtil.makeUUID(differentCreature);

      // Supplement should skip the entry because hidden-1 doesn't exist
      const result = supplementFromCache(differentCreature, tmpDir, []);
      assertEquals(
        result.length,
        0,
        "Should not return candidates referencing non-existent neurons",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "supplementFromCache excludes duplicates of existing Phase 1 successes",
  () => {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record a squash change in the cache
      const squashCandidate = makeSquashCandidate(base, HIDDEN_1_ID, "TANH");
      recordSuccessSync(tmpDir, squashCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      // Pass the same candidate as an existing Phase 1 success
      const result = supplementFromCache(base, tmpDir, [squashCandidate]);
      assertEquals(
        result.length,
        0,
        "Should not duplicate existing Phase 1 successes",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
);

Deno.test({
  name: "supplementFromCache respects maxSupplements limit",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record multiple candidates in the cache
      const squashCandidate = makeSquashCandidate(base, HIDDEN_1_ID, "TANH");
      recordSuccessSync(tmpDir, squashCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      const synapseCandidate = makeAddSynapseCandidate(
        base,
        INPUT_0_ID,
        OUTPUT_0_ID,
        0.3,
      );
      recordSuccessSync(tmpDir, synapseCandidate, {
        originalScore: -0.5,
        candidateScore: -0.35,
        scoreDelta: 0.15,
        error: 0.35,
      }, base);

      // Limit to 1
      const result = supplementFromCache(base, tmpDir, [], 1);
      assertEquals(result.length, 1, "Should respect maxSupplements limit");
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "supplementFromCache sorts by scoreDelta descending",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record two candidates with different score deltas
      const squashCandidate = makeSquashCandidate(base, HIDDEN_1_ID, "TANH");
      recordSuccessSync(tmpDir, squashCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      const synapseCandidate = makeAddSynapseCandidate(
        base,
        INPUT_0_ID,
        OUTPUT_0_ID,
        0.3,
      );
      recordSuccessSync(tmpDir, synapseCandidate, {
        originalScore: -0.5,
        candidateScore: -0.3,
        scoreDelta: 0.2,
        error: 0.3,
      }, base);

      const result = supplementFromCache(base, tmpDir, []);
      assertEquals(result.length, 2, "Should return both candidates");
      // Best scoreDelta should come first
      assertEquals(
        result[0].change.type,
        "add-synapses",
        "Higher scoreDelta should be first",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
});

Deno.test(
  "supplementFromCache skips combo entries from cache",
  () => {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Manually create a combo cache entry by writing JSON directly
      const comboDir = `${tmpDir}/combo-successful`;
      Deno.mkdirSync(comboDir, { recursive: true });
      Deno.writeTextFileSync(
        `${comboDir}/test-combo.json`,
        JSON.stringify({
          key: "test-combo",
          changeType: "combo-successful",
          description: "Combined changes",
          originalScore: -0.5,
          candidateScore: -0.2,
          scoreDelta: 0.3,
          error: 0.2,
        }),
      );

      const result = supplementFromCache(base, tmpDir, []);
      assertEquals(
        result.length,
        0,
        "Should skip combo entries from cache",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
);
