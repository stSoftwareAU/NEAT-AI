// import { assert } from "https://deno.land/std@0.210.0/assert/mod.ts";

import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkExport } from "../../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Trace", () => {
  const creature = Network.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  console.info("TODO");

  const json = creature.exportJSON();

  const config = new BackPropagationConfig();
  creature.applyLearnings(config);
  const json2 = creature.exportJSON();
  compare(json, json2);
  // assert(false, "TODO");
});

function compare(json: NetworkExport, json2: NetworkExport) {
  json.nodes.forEach((node) => {
    const node2 = json2.nodes.find((node2) => node2.uuid == node.uuid);
    if (!node2) {
      console.info(`Node not found: ${node.uuid}`);
    } else {
      if (node.bias != node2.bias) {
        const msg = `Bias mismatch: ${node.bias} vs ${node.bias}`;
        console.info(msg);
        // throw new Error(msg);
      }
      if (node.squash != node2.squash) {
        throw new Error(`Squash mismatch: ${node.squash} vs ${node2.squash}`);
      }
    }
  });
}
