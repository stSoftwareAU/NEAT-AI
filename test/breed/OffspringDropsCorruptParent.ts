/**
 * Tests for Offspring.breed dropping corrupt parents (Issue #2648).
 *
 * Background: GRQ-7-style `evolveRL` runs occasionally produce a parent
 * whose topology traps the WASM validator (`RuntimeError: memory access
 * out of bounds` inside `validate_topology`). The previous flow let the
 * trap escape uncaught from `prepareCreatureForBreeding(mum.shallowClone())`
 * and terminated the whole evolution run.
 *
 * The fix is two-layered:
 *
 *  1. `WasmTopologyOps.withWasmTrapGuard` re-throws WASM traps as a
 *     typed `TopologyError` (covered by `WasmTopologyOpsTrapGuard.ts`).
 *  2. `Offspring.breed` catches `TopologyError` / `ValidationError`
 *     from parent preparation and returns `undefined`, mirroring the
 *     existing producer-side compile-guard pattern.
 *
 * This file covers the second layer. We corrupt a forward-only parent
 * after the constructor's own validation so `prepareCreatureForBreeding`
 * raises during the breed call; `Offspring.breed` must return `undefined`
 * rather than letting the error escape.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { Synapse } from "@architecture/Synapse.ts";

/** Make a small, valid forward-only creature. */
function makeValidForwardOnlyCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: -0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Inject a backward synapse (`output -> hidden`) so the forward-only
 * validator rejects this creature when `prepareCreatureForBreeding`
 * runs during breeding. We do this *after* construction so the JSON
 * loader's own validation does not catch it first.
 */
function corruptWithBackwardSynapse(creature: Creature): void {
  const hiddenIdx = creature.neurons.findIndex((n) => n.type === "hidden");
  const outputIdx = creature.neurons.findIndex((n) => n.type === "output");
  assert(hiddenIdx >= 0 && outputIdx >= 0, "expected hidden+output");
  // output -> hidden is a backward edge in a forward-only creature.
  const bad = new Synapse(outputIdx, hiddenIdx, 0.42);
  creature.synapses.push(bad);
}

Deno.test(
  "Offspring.breed drops offspring when mother fails forward-only validation",
  () => {
    const mum = makeValidForwardOnlyCreature();
    const dad = makeValidForwardOnlyCreature();
    corruptWithBackwardSynapse(mum);

    const child = Offspring.breed(mum, dad, { forwardOnly: true });

    assertEquals(
      child,
      undefined,
      "Offspring.breed should return undefined when the mother is corrupt, " +
        "not throw an uncaught error",
    );
  },
);

Deno.test(
  "Offspring.breed drops offspring when father fails forward-only validation",
  () => {
    const mum = makeValidForwardOnlyCreature();
    const dad = makeValidForwardOnlyCreature();
    corruptWithBackwardSynapse(dad);

    const child = Offspring.breed(mum, dad, { forwardOnly: true });

    assertEquals(
      child,
      undefined,
      "Offspring.breed should return undefined when the father is corrupt, " +
        "not throw an uncaught error",
    );
  },
);
