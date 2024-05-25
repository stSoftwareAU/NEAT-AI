import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import type { Neuron } from "../../src/architecture/Neuron.ts";
import { Mutation } from "../../src/methods/Mutation.ts";
import { CRISPR } from "../../src/reconstruct/CRISPR.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("CRISPR", async () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Creature.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF = await crispr.cleaveDNA(JSON.parse(dnaTXT));
  (networkIF as Creature).validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-IF.json"),
  );

  const expectedTXT = JSON.stringify(
    clean(Creature.fromJSON(expectedJSON).internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-IF.json", expectedTXT);
  const actualJSON = (networkIF as Creature).internalJSON();

  const actualTXT = JSON.stringify(
    clean(actualJSON),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-IF.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR_twice", async () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Creature.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF1 = await crispr.cleaveDNA(JSON.parse(dnaTXT));
  assert(networkIF1);
  (networkIF1 as Creature).validate();
  const crispr2 = new CRISPR(networkIF1);
  const networkIF2 = await crispr2.cleaveDNA(JSON.parse(dnaTXT));
  (networkIF2 as Creature).validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-IF.json"),
  );
  const expectedTXT = JSON.stringify(clean(expectedJSON), null, 2);
  const actualTXT = JSON.stringify(
    clean((networkIF2 as Creature).exportJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-IF.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR-Volume", async () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Creature.fromJSON(JSON.parse(networkTXT));
  Deno.writeTextFileSync(
    "test/data/CRISPR/.network.json",
    JSON.stringify(network.internalJSON(), null, 2),
  );
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-VOLUME.json");

  const networkIF = await crispr.cleaveDNA(JSON.parse(dnaTXT));

  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-VOLUME.json"),
  );

  const expectedTXT = JSON.stringify(
    clean(Creature.fromJSON(expectedJSON).internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-VOLUME.json", expectedTXT);

  const actualTXT = JSON.stringify(
    clean((networkIF as Creature).internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-VOLUME.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("REMOVE", async () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Creature.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF = await crispr.cleaveDNA(JSON.parse(dnaTXT)) as Creature;
  (networkIF as Creature).validate();

  for (let pos = networkIF.neurons.length; pos--;) {
    const node = networkIF.neurons[pos] as Neuron;
    const tag = getTag(node, "CRISPR");
    if (tag) {
      for (let attempts = 0; attempts < 10; attempts++) {
        node.mutate(Mutation.MOD_ACTIVATION.name);
      }

      const tag = getTag(node, "CRISPR");
      assert(!tag, "Should have removed CRISPER");
    }
  }

  networkIF.fix();
  const crispr2 = new CRISPR(networkIF);

  const networkIF2 = await crispr2.cleaveDNA(JSON.parse(dnaTXT)) as Creature;

  (networkIF2 as Creature).validate();
});

Deno.test("CRISPR-multi-outputs1", async () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },
      { type: "hidden", squash: "LOGISTIC", bias: -0.5, index: 4, uuid: "h2" },
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 5, uuid: "h3" },
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 6, uuid: "h4" },
      { type: "hidden", squash: "MEAN", bias: -0.25, index: 7, uuid: "h5" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 8,
        uuid: "h6",
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 9,
        uuid: "h7",
        bias: 0,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 10,
        uuid: "h8",
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 3, to: 8, weight: 0.2 },
      { from: 0, to: 8, weight: 0.25 },
      { from: 3, to: 4, weight: 0.3 },
      { from: 2, to: 5, weight: 0.4 },
      { from: 5, to: 10, weight: 0.4 },
      { from: 1, to: 6, weight: 0.5 },
      { from: 4, to: 7, weight: 0.7 },
      { from: 6, to: 8, weight: 0.8 },
      { from: 7, to: 9, weight: 0.9 },
    ],
    input: 3,
    output: 3,
  };
  const network = Creature.fromJSON(json);
  Deno.writeTextFileSync(
    "test/data/CRISPR/.network-sane.json",
    JSON.stringify(network.internalJSON(), null, 2),
  );
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-SANE.json");

  const tmpCreature = await crispr.cleaveDNA(JSON.parse(dnaTXT));
  assert(tmpCreature);
  const networkSANE = Creature.fromJSON(tmpCreature);
  networkSANE.validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-sane.json"),
  );

  const expectedTXT = JSON.stringify(
    clean(Creature.fromJSON(expectedJSON).internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-sane.json", expectedTXT);

  const actualTXT = JSON.stringify(
    clean(networkSANE.internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-sane.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

function clean(
  networkJSON: { neurons?: { uuid?: string }[]; nodes?: { uuid?: string }[] },
) {
  const neurons = networkJSON.neurons
    ? networkJSON.neurons
    : networkJSON.nodes
    ? networkJSON.nodes
    : [];
  neurons.forEach((n) => {
    if (n.uuid && !n.uuid.startsWith("output-")) {
      delete n.uuid;
    }
  });
}

Deno.test("CRISPR-multi-outputs2", async () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },
      // { type: "hidden", squash: "LOGISTIC", bias: -0.5, index: 4, uuid: "h2" },
      // { type: "hidden", squash: "LOGISTIC", bias: 0, index: 5, uuid: "h3" },
      // { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 6, uuid: "h4" },
      // { type: "hidden", squash: "MEAN", bias: -0.25, index: 7, uuid: "h5" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 4,
        uuid: "h6",
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 5,
        uuid: "h7",
        bias: 0,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 6,
        uuid: "h8",
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 2, to: 4, weight: 0.2 },
      { from: 3, to: 5, weight: 0.3 },
      // { from: 3, to: 4, weight: 0.3 },
      { from: 2, to: 6, weight: 0.4 },
      // { from: 5, to: 10, weight: 0.4 },
      // { from: 1, to: 6, weight: 0.5 },
      // { from: 4, to: 7, weight: 0.7 },
      // { from: 6, to: 8, weight: 0.8 },
      // { from: 7, to: 9, weight: 0.9 },
    ],
    input: 3,
    output: 3,
  };
  const network = Creature.fromJSON(json);
  Deno.writeTextFileSync(
    "test/data/CRISPR/.network-sane2.json",
    JSON.stringify(network.internalJSON(), null, 2),
  );
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-SANE.json");

  const tmpCreature = await crispr.cleaveDNA(JSON.parse(dnaTXT));
  assert(tmpCreature);
  const networkSANE = Creature.fromJSON(tmpCreature);
  networkSANE.validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-sane2.json"),
  );

  const expectedTXT = JSON.stringify(
    clean(Creature.fromJSON(expectedJSON).internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-sane2.json", expectedTXT);

  const actualTXT = JSON.stringify(
    clean(networkSANE.internalJSON()),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-sane2.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR-uuid", async () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 4,
        bias: 0.1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 5,
        bias: 0.2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 6,
        bias: 0.3,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 2, to: 4, weight: 0.2 },
      { from: 3, to: 5, weight: 0.3 },
      { from: 2, to: 6, weight: 0.4 },
    ],
    input: 3,
    output: 3,
  };
  const creature = Creature.fromJSON(json);
  Deno.writeTextFileSync(
    "test/data/CRISPR/.network-proximity-to-delisting.json",
    JSON.stringify(creature.internalJSON(), null, 2),
  );
  creature.validate();
  const crispr = new CRISPR(creature);
  const dna = JSON.parse(Deno.readTextFileSync(
    "test/data/CRISPR/DNA-proximity-to-delisting.json",
  ));
  const tmpCreature = await crispr.cleaveDNA(dna);
  assert(tmpCreature);
  const networkSANE = Creature.fromJSON(tmpCreature);
  networkSANE.validate();
  const synapseWithComment = networkSANE.synapses.find((s) =>
    "Negative weight to trigger on ≤ 0" == getTag(s, "comment")
  );
  assert(synapseWithComment, "Should have comment");
});
