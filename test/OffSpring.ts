import { NeatUtil } from "../src/NeatUtil.ts";
import { Neat } from "../src/Neat.js";
// import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { Network } from "../src/architecture/network.js";
// import { assert } from "https://deno.land/std@0.146.0/testing/asserts.ts";
import { make as makeConfig } from "../src/config/NeatConfig.ts";
// import { addTag } from "../src/tags/TagsInterface.ts";


((globalThis as unknown ) as {DEBUG:boolean}).DEBUG = true;

Deno.test("OffSpring", async () => {
  const creature = Network.fromJSON({
    "nodes": [{
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 0,
    }, {
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 1,
    }, {
      "bias": -0.49135010426905,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
      "gater": null,
    }, { "weight": 0.96864643541, "from": 0, "to": 2, "gater": null }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "error", value: "0.5" },
    ],
  });

  const config = makeConfig({});
  const util = new NeatUtil(new Neat(1, 1), config);

  await util.populatePopulation(creature);
  for (let i = 0; i < 100; i++) {
    const kid = util.getOffspring();
    await util.populatePopulation(kid);
  }
});
