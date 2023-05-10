import { assertEquals } from "https://deno.land/std@0.186.0/testing/asserts.ts";

import { CRISPR } from "../src/reconstruct/CRISPR.ts";
import { Network } from "../src/architecture/Network.ts";
import { getTag } from "../src/tags/TagsInterface.ts";
import { Node } from "../src/architecture/Node.ts";
import { Mutation } from "../src/methods/mutation.ts";
import { assert } from "https://deno.land/std@0.186.0/_util/asserts.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("CRISPR", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Network.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF = crispr.apply(JSON.parse(dnaTXT));
  (networkIF as Network).validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-IF.json"),
  );

  const expectedTXT = JSON.stringify(
    Network.fromJSON(expectedJSON).internalJSON(),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-IF.json", expectedTXT);
  const actualJSON = (networkIF as Network).internalJSON();

  const actualTXT = JSON.stringify(
    actualJSON,
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-IF.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR_twice", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Network.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF1 = crispr.apply(JSON.parse(dnaTXT));
  (networkIF1 as Network).validate();
  const crispr2 = new CRISPR(networkIF1);
  const networkIF2 = crispr2.apply(JSON.parse(dnaTXT));
  (networkIF2 as Network).validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-IF.json"),
  );
  const expectedTXT = JSON.stringify(expectedJSON, null, 2);
  const actualTXT = JSON.stringify(
    (networkIF2 as Network).exportJSON(),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-IF.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR-Volume", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Network.fromJSON(JSON.parse(networkTXT));
  Deno.writeTextFileSync(
    "test/data/CRISPR/.network.json",
    JSON.stringify(network.internalJSON(), null, 2),
  );
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-VOLUME.json");

  const networkIF = crispr.apply(JSON.parse(dnaTXT));

  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-VOLUME.json"),
  );

  const expectedTXT = JSON.stringify(
    Network.fromJSON(expectedJSON).internalJSON(),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-VOLUME.json", expectedTXT);

  const actualTXT = JSON.stringify(
    (networkIF as Network).internalJSON(),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-VOLUME.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("REMOVE", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Network.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF = crispr.apply(JSON.parse(dnaTXT)) as Network;
  (networkIF as Network).validate();

  console.info(networkIF.internalJSON());

  for (let pos = networkIF.nodes.length; pos--;) {
    const node = networkIF.nodes[pos] as Node;
    const tag = getTag(node, "CRISPR");
    if (tag) {
      for (let attempts = 0; attempts < 10; attempts++) {
        node.mutate(Mutation.MOD_ACTIVATION.name);
      }

      const tag = getTag(node, "CRISPR");
      if (tag) {
        assert(false, "Should have removed CRISPER");
      }
    }
  }
});

Deno.test("CRISPR-multi-outputs", () => {
  const json: NetworkInternal = {
    nodes: [
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
    connections: [
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
  const network = Network.fromJSON(json);
  Deno.writeTextFileSync(
    "test/data/CRISPR/.network-sane.json",
    JSON.stringify(network.internalJSON(), null, 2),
  );
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-SANE.json");

  const networkSANE = Network.fromJSON(crispr.apply(JSON.parse(dnaTXT)));
  networkSANE.validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-sane.json"),
  );

  const expectedTXT = JSON.stringify(
    Network.fromJSON(expectedJSON).internalJSON(),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.expected-sane.json", expectedTXT);

  const actualTXT = JSON.stringify(
    networkSANE.internalJSON(),
    null,
    2,
  );

  Deno.writeTextFileSync("test/data/CRISPR/.actual-sane.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});
