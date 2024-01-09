import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkExport } from "../../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Trace", () => {
  const creature = Network.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );

  const json = creature.exportJSON();

  const config = new BackPropagationConfig();
  creature.applyLearnings(config);
  const json2 = creature.exportJSON();
  compare(json, json2);
});

function compare(json: NetworkExport, json2: NetworkExport) {
  json.nodes.forEach((node) => {
    const node2 = json2.nodes.find((node2) => node2.uuid == node.uuid);
    if (!node2) {
      console.info(`Node not found: ${node.uuid}`);
    } else {
      const b1 = node.bias ? node.bias : 0;
      const b2 = node2.bias ? node2.bias : 0;

      if (Math.abs(b1 - b2) > 0.0001) {
        const msg = `${node.uuid} Bias mismatch: ${b1.toFixed(4)} vs ${
          b2.toFixed(4)
        }`;
        console.info(msg);
        // throw new Error(msg);
      }
      // if (node.squash != node2.squash) {
      //   throw new Error(
      //     `${node.uuid} Squash mismatch: ${node.squash} vs ${node2.squash}`,
      //   );
      // }
    }
  });
}
