/**
 * @module
 *
 * Pins the throw ordering between `creatureValidate`'s **host-only** checks and
 * its **portable rule** checks (Issue #3802).
 *
 * `creatureValidate` is first-failure-wins, so a creature that violates both a
 * rule and a host-only invariant must keep throwing the same error it throws
 * today. The host-only checks — `neuron.validate()`, the `neuron.index` cache
 * field and the `neuron.creature` object identity — fire *inside* the neuron
 * loop, after that neuron's rule checks and before the next neuron's. That
 * interleaving is invisible to the language-neutral conformance corpus
 * (`test/fixtures/validate/`), because no JSON fixture can express object
 * identity, so it is pinned here instead.
 */

import { assert, assertEquals, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { TopologyError } from "@errors/TopologyError.ts";
import type { ValidationError } from "@errors/ValidationError.ts";

/** input-0, input-1, hidden, output — valid, fully connected. */
function makeCreature(): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.DEBUG = false;
  creatureValidate(creature);
  return creature;
}

const HIDDEN_INDEX = 2;
const OUTPUT_INDEX = 3;

/** Runs validation, failing the test when it unexpectedly passes. */
function expectThrow(creature: Creature): ValidationError | TopologyError {
  try {
    creatureValidate(creature);
  } catch (caught) {
    return caught as ValidationError | TopologyError;
  }
  fail("Expected creatureValidate to throw");
}

function dropSynapses(
  creature: Creature,
  keep: (synapse: Synapse) => boolean,
): void {
  creature.synapses = creature.synapses.filter(keep);
  creature.clearCache();
}

/**
 * Points a neuron at a different owning creature. `Neuron.creature` is
 * readonly — only a corrupt in-memory creature reaches this state — so the cast
 * is the only way to reproduce what the host-only identity check guards.
 */
function reparent(creature: Creature, indx: number, owner: Creature): void {
  (creature.neurons[indx] as unknown as { creature: Creature }).creature =
    owner;
}

Deno.test(
  "Issue #3802: a hidden neuron's rule checks fire before its host-only neuron.validate()",
  () => {
    const creature = makeCreature();
    // Rule breach: no outward connections. Host-only breach: no squash, which
    // only `neuron.validate()` rejects.
    dropSynapses(creature, (s) => s.from !== HIDDEN_INDEX);
    creature.neurons[HIDDEN_INDEX].squash = undefined;

    const error = expectThrow(creature);
    assertEquals(error.reason, "NO_OUTWARD_CONNECTIONS");
    assert(
      error.message.includes("no outward connections"),
      `message: ${error.message}`,
    );
  },
);

Deno.test(
  "Issue #3802: host-only neuron.validate() fires before the host-only index check",
  () => {
    const creature = makeCreature();
    creature.neurons[OUTPUT_INDEX].squash = undefined;
    creature.neurons[OUTPUT_INDEX].index = 99;

    const error = expectThrow(creature);
    assertEquals(error.reason, "MISSING_SQUASH");
    assert(
      error.message.includes("Missing squash"),
      `message: ${error.message}`,
    );
  },
);

Deno.test(
  "Issue #3802: the host-only index check fires before the host-only creature-identity check",
  () => {
    const creature = makeCreature();
    const other = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.neurons[0].index = 99;
    reparent(creature, 0, other);

    const error = expectThrow(creature);
    assertEquals(error.reason, "OTHER");
    assert(
      error.message.includes("does not match expected index"),
      `message: ${error.message}`,
    );
  },
);

Deno.test(
  "Issue #3802: a host-only breach on an earlier neuron fires before a rule breach on a later one",
  () => {
    const creature = makeCreature();
    // Host-only breach on neuron 0; rule breach (no inward connections) on the
    // hidden neuron at index 2.
    creature.neurons[0].index = 99;
    dropSynapses(creature, (s) => s.to !== HIDDEN_INDEX);

    const error = expectThrow(creature);
    assertEquals(error.reason, "OTHER");
    assert(
      error.message.includes("does not match expected index"),
      `message: ${error.message}`,
    );
  },
);

Deno.test(
  "Issue #3802: a host-only breach in the neuron loop fires before the post-loop synapse rules",
  () => {
    const creature = makeCreature();
    const other = new Creature(2, 1, { layers: [{ count: 1 }] });
    reparent(creature, 0, other);
    // Rule breach checked only after the neuron loop: a duplicate synapse.
    creature.synapses.push(new Synapse(0, HIDDEN_INDEX, 0.5));
    creature.synapses.sort((a, b) =>
      a.from !== b.from ? a.from - b.from : a.to - b.to
    );
    creature.clearCache();

    const error = expectThrow(creature);
    assertEquals(error.reason, "INVALID_STATE");
    assert(
      error.message.includes("creature mismatch"),
      `message: ${error.message}`,
    );
  },
);

Deno.test(
  "Issue #3802: host-only checks do not run neuron.validate() on input or constant neurons",
  () => {
    const creature = makeCreature();
    // `Neuron.validate()` rejects a squash on a non-hidden/output neuron, but
    // `creatureValidate` never calls it for inputs — the rule half owns them.
    creature.neurons[0].squash = "IDENTITY";

    creatureValidate(creature);
  },
);
