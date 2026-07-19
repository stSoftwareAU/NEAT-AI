/**
 * Forced-focus neuron references may be numeric runtime ids OR stable wire
 * UUID strings (for example `input-2460`, or a hidden/output neuron UUID).
 * `resolveForcedFocusReferences` resolves strings to runtime ids while
 * preserving order and identity, and reports unresolvable tokens loudly
 * instead of silently dropping them.
 *
 * Issue #3493 — Discovery: preserve UUIDs passed through --focusNeurons.
 * Test created: 19-Jul-2026
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { TANH } from "@methods/activations/types/TANH.ts";
import {
  buildWireToRuntimeIdMap,
  resolveForcedFocusReferences,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";

function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: TANH.NAME, bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-2", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.2 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("resolveForcedFocusReferences resolves a hidden-neuron UUID string", () => {
  const creature = makeCreature();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const expected = wireToId.get("hidden-1");
  assertEquals(typeof expected, "number");

  const { ids, unresolved } = resolveForcedFocusReferences(creature, [
    "hidden-1",
  ]);
  assertEquals(ids, [expected]);
  assertEquals(unresolved, []);
});

Deno.test("resolveForcedFocusReferences resolves an input-N wire UUID", () => {
  const creature = makeCreature();
  // Input runtime ids are the input index: `input-2` -> 2.
  const { ids, unresolved } = resolveForcedFocusReferences(creature, [
    "input-2",
  ]);
  assertEquals(ids, [2]);
  assertEquals(unresolved, []);
});

Deno.test("resolveForcedFocusReferences preserves order and identity of multiple UUIDs", () => {
  const creature = makeCreature();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const id2 = wireToId.get("hidden-2");
  const id0 = wireToId.get("hidden-0");

  const { ids, unresolved } = resolveForcedFocusReferences(creature, [
    "hidden-2",
    "hidden-0",
  ]);
  assertEquals(ids, [id2, id0]);
  assertEquals(unresolved, []);
});

Deno.test("resolveForcedFocusReferences passes numeric runtime ids through unchanged", () => {
  const creature = makeCreature();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const hiddenId = wireToId.get("hidden-1")!;

  const { ids, unresolved } = resolveForcedFocusReferences(creature, [
    hiddenId,
  ]);
  assertEquals(ids, [hiddenId]);
  assertEquals(unresolved, []);
});

Deno.test("resolveForcedFocusReferences treats a bare integer string as a runtime id", () => {
  const creature = makeCreature();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const hiddenId = wireToId.get("hidden-1")!;

  const { ids, unresolved } = resolveForcedFocusReferences(creature, [
    String(hiddenId),
  ]);
  assertEquals(ids, [hiddenId]);
  assertEquals(unresolved, []);
});

Deno.test("resolveForcedFocusReferences reports unresolvable tokens without dropping valid ones", () => {
  const creature = makeCreature();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const id1 = wireToId.get("hidden-1");

  const { ids, unresolved } = resolveForcedFocusReferences(creature, [
    "hidden-1",
    "not-a-real-neuron",
  ]);
  assertEquals(ids, [id1]);
  assertEquals(unresolved, ["not-a-real-neuron"]);
});
