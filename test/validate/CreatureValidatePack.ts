/**
 * @module
 *
 * The packed request shape, and the fallback that names a failure (Issue #3832).
 *
 * `creatureValidate` sends the creature to NEAT-AI-core as a packed buffer of
 * numbers, because the JSON request costs more than the rules on a large
 * creature. The buffer carries no text, so it can say "healthy, and here are
 * the counters" but not *which* rule a broken creature broke — that comes from
 * a second call through the JSON shape.
 *
 * What has to hold, and what these tests drive:
 *
 * 1. A healthy creature is answered from the packed shape alone, with the same
 *    counters the JSON shape would have reported.
 * 2. A broken creature still throws the **same** error it threw before the
 *    packed shape existed — same class, same reason, same message text — which
 *    is the whole point of the fallback.
 * 3. The values JSON has no literal for still reach the same rule, because the
 *    packed shape has to substitute exactly what `CreatureValidateMarshal.ts`
 *    substitutes.
 * 4. The scratch buffer the packer reuses between calls cannot leak one
 *    creature's neurons into the next one's verdict.
 *
 * The corpus replay in `CreatureValidateConformance.ts` covers the rule table
 * itself; nothing here restates a rule.
 */

import { assertEquals, assertStringIncludes, fail } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  packCreatureValidateRequest,
  packedMemetic,
  packedRequestLength,
} from "@architecture/CreatureValidatePack.ts";
import {
  coreValidateCreature,
  coreValidateCreaturePacked,
} from "@wasm/WasmCreatureValidate.ts";
import { marshalCreatureValidateRequest } from "@architecture/CreatureValidateMarshal.ts";
import type { ValidationError } from "@errors/ValidationError.ts";

/** A valid 2-input, 1-hidden, 1-output creature. */
function makeCreature(): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.DEBUG = false;
  creatureValidate(creature);
  return creature;
}

/** Validates, failing the test when the creature unexpectedly passes. */
function expectThrow(creature: Creature): ValidationError {
  try {
    creatureValidate(creature);
  } catch (caught) {
    return caught as ValidationError;
  }
  fail("Expected creatureValidate to throw");
}

Deno.test("packed: a healthy creature is answered from the buffer alone", () => {
  const creature = makeCreature();

  const packed = coreValidateCreaturePacked(
    packCreatureValidateRequest(creature),
    packedMemetic(creature),
  );

  assertEquals(packed?.detailRequired, undefined);
  assertEquals(packed?.stats, {
    input: 2,
    constant: 0,
    hidden: 1,
    output: 1,
    connections: 3,
  });
});

Deno.test("packed: the two shapes count a healthy creature the same way", () => {
  const creature = makeCreature();

  const packed = coreValidateCreaturePacked(
    packCreatureValidateRequest(creature),
    packedMemetic(creature),
  );
  const json = coreValidateCreature(
    marshalCreatureValidateRequest(creature).request,
  );

  assertEquals(packed?.stats, json.stats);
});

Deno.test("packed: a broken creature is sent back for the failure, not answered", () => {
  const creature = makeCreature();
  // A hidden neuron nothing reads: rule 18.
  creature.synapses = creature.synapses.filter((synapse) =>
    synapse.from !== 2
  );

  const packed = coreValidateCreaturePacked(
    packCreatureValidateRequest(creature),
    packedMemetic(creature),
  );

  assertEquals(packed?.detailRequired, true);
  assertEquals(packed?.stats, undefined);
});

Deno.test("packed: the failure a broken creature throws still names the rule", () => {
  const creature = makeCreature();
  creature.synapses = creature.synapses.filter((synapse) =>
    synapse.from !== 2
  );

  const error = expectThrow(creature);
  assertEquals(error.name, "ValidationError");
  assertEquals(error.reason, "NO_OUTWARD_CONNECTIONS");
  assertStringIncludes(error.message, "has no outward connections");
});

Deno.test("packed: an options bag still reaches the rules it pins", () => {
  const creature = makeCreature();

  // The creature is healthy, so only the pinned count can reject it.
  const error = (() => {
    try {
      creatureValidate(creature, { connections: 99 });
    } catch (caught) {
      return caught as ValidationError;
    }
    fail("Expected the pinned connection count to be checked");
  })();

  assertEquals(error.reason, "OTHER");
  assertStringIncludes(error.message, "expected: 99");
});

Deno.test("packed: the forward-only leg runs, and clears a feed-forward creature", () => {
  const creature = makeCreature();

  // `forwardOnly` adds the topology, structural-integrity and cycle checks on
  // top of the rule walk. A feed-forward creature must still come back healthy
  // and counted the same way.
  assertEquals(
    creatureValidate(creature, { forwardOnly: true }),
    creatureValidate(creature),
  );
});

Deno.test("packed: the forward-only leg still rejects a backward edge", () => {
  const creature = makeCreature();
  // The constructor's guard refuses a recurrent edge on a forward-only
  // creature, so the edge is added with the mode off and asked about with the
  // option on — which is how `Upgrade` and `Offspring` reach this rule.
  creature.forwardOnly = false;
  creature.connect(3, 2, 0.5);

  const error = (() => {
    try {
      creatureValidate(creature, { forwardOnly: true });
    } catch (caught) {
      return caught as ValidationError;
    }
    fail("Expected a forward-only creature with a backward edge to throw");
  })();

  assertEquals(error.reason, "RECURSIVE_SYNAPSE");
});

Deno.test("packed: a NaN neuron id still reaches the id rule", () => {
  const creature = makeCreature();
  creature.neurons[2].id = NaN;

  const error = expectThrow(creature);
  assertEquals(error.reason, "OTHER");
  assertEquals(error.message, "NaN) invalid neuron id: NaN");
});

Deno.test("packed: a non-finite bias still reaches the bias rule", () => {
  const creature = makeCreature();
  creature.neurons[2].bias = Infinity;

  const error = expectThrow(creature);
  assertEquals(error.reason, "OTHER");
  assertStringIncludes(error.message, "invalid bias: Infinity");
});

Deno.test("packed: an absent bias is not the same as a bias of zero", () => {
  const creature = makeCreature();
  creature.neurons[2].bias = undefined as unknown as number;

  const error = expectThrow(creature);
  assertEquals(error.reason, "OTHER");
  assertStringIncludes(error.message, "invalid bias: undefined");
});

/**
 * The packer reuses one scratch buffer across calls, so a smaller creature
 * packed after a larger one sits on the larger one's bytes. Every field core
 * reads has to be written unconditionally — a stale neuron surviving into the
 * next verdict is the failure mode this shape could have introduced.
 */
Deno.test("packed: a creature is never judged on the previous creature's bytes", () => {
  const wide = new Creature(8, 2, { layers: [{ count: 6 }] });
  wide.DEBUG = false;
  const narrow = makeCreature();

  const wideStats = creatureValidate(wide);
  const narrowStats = creatureValidate(narrow);
  // Pack the wide creature again, then the narrow one, over the same buffer.
  creatureValidate(wide);

  assertEquals(creatureValidate(narrow), narrowStats);
  assertEquals(creatureValidate(wide), wideStats);
  assertEquals(narrowStats.input, 2);
  assertEquals(wideStats.input, 8);
});

Deno.test("packed: the buffer is exactly the length core computes for it", () => {
  const creature = makeCreature();

  const request = packCreatureValidateRequest(creature);

  assertEquals(
    request.length,
    packedRequestLength(creature.neurons.length, creature.synapses.length),
  );
});

Deno.test("packed: a creature with no memetic record sends no memetic JSON", () => {
  const creature = makeCreature();

  assertEquals(packedMemetic(creature), "");
});
