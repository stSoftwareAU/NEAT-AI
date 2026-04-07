import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";

function loadFixture(name: string): Creature {
  const json = JSON.parse(
    Deno.readTextFileSync(`./test/data/${name}.json`),
  );
  return Creature.fromJSON(json);
}

Deno.test("GRQ-25-1 fixture loads and validates", () => {
  const creature = loadFixture("grq-25-1-sample");
  creatureValidate(creature);

  // Sparse, deep topology with legacy UUID format
  const hiddenNeurons = creature.neurons.filter((n) => n.type === "hidden");
  assert(
    hiddenNeurons.length >= 50,
    `Expected >= 50 hidden neurons, got ${hiddenNeurons.length}`,
  );

  // No memetic data
  const exported = creature.exportJSON();
  assertEquals(exported.memetic, undefined);

  // Legacy UUID format (not UUID-v4)
  const uuidV4Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const n of hiddenNeurons) {
    assert(
      !uuidV4Pattern.test(n.uuid ?? ""),
      `GRQ-25-1 hidden neuron should use legacy UUID format, got UUID-v4: ${n.uuid}`,
    );
  }
});

Deno.test("Europa fixture loads and validates", () => {
  const creature = loadFixture("europa-sample");
  creatureValidate(creature);

  // Dense, shallow topology with UUID-v4 format
  const hiddenNeurons = creature.neurons.filter((n) => n.type === "hidden");
  assert(
    hiddenNeurons.length >= 15,
    `Expected >= 15 hidden neurons, got ${hiddenNeurons.length}`,
  );

  // Has memetic data
  const exported = creature.exportJSON();
  assert(exported.memetic !== undefined, "Europa should have memetic data");

  // UUID-v4 format for hidden neurons
  const uuidV4Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const n of hiddenNeurons) {
    assert(
      uuidV4Pattern.test(n.uuid ?? ""),
      `Europa hidden neuron should use UUID-v4 format, got: ${n.uuid}`,
    );
  }
});

Deno.test("GRQ-25-1 and Europa have same input/output counts", () => {
  const grq = loadFixture("grq-25-1-sample");
  const europa = loadFixture("europa-sample");

  assertEquals(grq.input, europa.input, "Input counts must match for breeding");
  assertEquals(
    grq.output,
    europa.output,
    "Output counts must match for breeding",
  );
});

Deno.test("GRQ-25-1 and Europa have zero genetic compatibility", () => {
  const grq = loadFixture("grq-25-1-sample");
  const europa = loadFixture("europa-sample");

  const compatibility = geneticCompatibility(grq, europa);
  assertEquals(
    compatibility,
    0,
    `Expected zero genetic compatibility, got ${compatibility}`,
  );
});

Deno.test("GRQ-25-1 is sparse and deep relative to Europa", () => {
  const grq = loadFixture("grq-25-1-sample");
  const europa = loadFixture("europa-sample");

  const grqHidden = grq.neurons.filter((n) => n.type === "hidden").length;
  const europaHidden = europa.neurons.filter((n) => n.type === "hidden").length;

  // GRQ has more hidden neurons (deeper topology)
  assert(
    grqHidden > europaHidden,
    `GRQ-25-1 should have more hidden neurons (${grqHidden}) than Europa (${europaHidden})`,
  );

  const grqSynapseCount = grq.synapses.length;
  const europaSynapseCount = europa.synapses.length;

  // Europa is denser: more synapses per neuron
  const grqDensity = grqSynapseCount / grqHidden;
  const europaDensity = europaSynapseCount / europaHidden;

  assert(
    europaDensity > grqDensity,
    `Europa should be denser (${
      europaDensity.toFixed(1)
    } syn/neuron) than GRQ-25-1 (${grqDensity.toFixed(1)} syn/neuron)`,
  );
});
