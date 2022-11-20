import { assert } from "https://deno.land/std@0.165.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("hidden", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const network = Network.fromJSON(json);

  let positiveCount = 0;
  let negativeCount = 0;

  const startPos = network.input;
  const endPos = network.nodes.length - network.output;

  for (let pos = startPos; pos < endPos; pos++) {
    const n = network.nodes[pos];

    if (network.inFocus(n.index, [1])) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }

  assert(positiveCount > 0, "No positives");
  assert(negativeCount > 0, "No negatives");
});

Deno.test("input", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const network = Network.fromJSON(json);

  let positiveCount = 0;
  let negativeCount = 0;

  const startPos = 0;
  const endPos = network.input;

  for (let pos = startPos; pos < endPos; pos++) {
    const n = network.nodes[pos];

    if (network.inFocus(n.index, [1])) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }

  assert(positiveCount > 0, "No positives");
  assert(negativeCount > 0, "No negatives");
});
