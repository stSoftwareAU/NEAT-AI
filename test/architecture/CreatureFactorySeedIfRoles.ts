/**
 * Issue #3851: the Creature Factory must emit a **valid** `IF` hidden neuron
 * or refuse to build the seed at all.
 *
 * An `IF` neuron branches on its `condition` edges and reads its two branches
 * from the `positive` / `negative` edges. A factory seed that emits `IF`
 * hidden neurons with untyped inward synapses is invalid at birth: it only
 * becomes usable because a downstream `fix()` / repair pass invents the
 * wiring — structural design work no producer ever chose.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import {
  creatureForDataset,
  creatureForProblem,
} from "@architecture/CreatureFactory.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { repairInvalidIfNeuronsInCreature } from "@architecture/RepairInvalidIfNeurons.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";

/** Inward synapse roles of `index`, defaulting untyped to `positive`. */
function inwardRoles(creature: Creature, index: number): string[] {
  return creature.inwardConnections(index).map((s) => s.type ?? "positive");
}

/** Every hidden neuron carrying the `IF` squash. */
function ifHiddenIndices(creature: Creature): number[] {
  const indices: number[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type === "hidden" && neuron.squash === "IF") indices.push(i);
  }
  return indices;
}

Deno.test("creatureForProblem: an IF-forced seed validates without any repair", () => {
  const creature = creatureForProblem({
    inputs: 8,
    outputs: 1,
    cost: "MSE",
    outputRange: { min: -1, max: 1 },
    hiddenSquash: "IF",
  });

  creatureValidate(creature);
  assertEquals(
    repairInvalidIfNeuronsInCreature(creature),
    false,
    "the seed needed a repair pass to become valid",
  );
});

Deno.test("creatureForProblem: every emitted IF neuron carries all three roles", () => {
  const creature = creatureForProblem({
    inputs: 8,
    outputs: 1,
    hiddenSquash: "IF",
  });

  const ifNeurons = ifHiddenIndices(creature);
  assert(ifNeurons.length > 0, "expected the seed to carry IF hidden neurons");

  for (const index of ifNeurons) {
    const roles = inwardRoles(creature, index);
    assert(
      roles.length >= 3,
      `neuron ${index} has only ${roles.length} inward connections`,
    );
    for (const role of ["condition", "positive", "negative"]) {
      assert(
        roles.includes(role),
        `neuron ${index} is missing a '${role}' edge, roles: ${
          roles.join(",")
        }`,
      );
    }
  }
});

Deno.test("creatureForProblem: IF role assignment is deterministic, not arbitrary", () => {
  const spec = { inputs: 7, outputs: 2, hiddenSquash: "IF" } as const;
  const first = creatureForProblem(spec);
  const second = creatureForProblem(spec);

  const roleMap = (creature: Creature) =>
    creature.synapses.map((s) => `${s.from}->${s.to}:${s.type ?? ""}`).join(
      "|",
    );

  assertEquals(roleMap(first), roleMap(second));
});

Deno.test("creatureForDataset: an IF-forced seed validates without any repair", () => {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 12; i++) {
    records.push({
      input: new Float32Array([i / 12, 1 - i / 12, (i % 3) / 3, (i % 5) / 5]),
      output: new Float32Array([i / 12]),
    });
  }

  const creature = creatureForDataset(records, {
    cost: "MSE",
    hiddenSquash: "IF",
  });

  creatureValidate(creature);
  assertEquals(repairInvalidIfNeuronsInCreature(creature), false);
});

Deno.test("Creature.forProblem: the static forwarder emits valid IF seeds too", () => {
  const creature = Creature.forProblem({
    inputs: 5,
    outputs: 1,
    hiddenSquash: "IF",
  });

  creatureValidate(creature);
});

Deno.test("creatureForProblem: a seed too narrow for IF fails loud, naming the squash", () => {
  const error = assertThrows(
    () =>
      creatureForProblem({
        inputs: 2,
        outputs: 1,
        hiddenSquash: "IF",
      }),
    TopologyError,
  ) as TopologyError;

  assertEquals(error.reason, "INVALID_SQUASH");
  assert(
    error.message.includes("'IF'"),
    `message must name the squash, got: ${error.message}`,
  );
  assert(
    error.message.includes("hiddenSquash"),
    `message must name the rule that forced it, got: ${error.message}`,
  );
});

Deno.test("creatureForProblem: a seed that does not force IF is untouched", () => {
  const creature = creatureForProblem({
    inputs: 8,
    outputs: 1,
    cost: "MSE",
    outputRange: { min: -1, max: 1 },
  });

  creatureValidate(creature);
  assertEquals(ifHiddenIndices(creature).length, 0);
  for (const synapse of creature.synapses) {
    assertEquals(
      synapse.type,
      undefined,
      "a non-IF seed must not carry synapse roles",
    );
  }
});
