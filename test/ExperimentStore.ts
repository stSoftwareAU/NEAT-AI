import { NeatUtil } from "../src/NeatUtil.ts";
import { Neat } from "../src/Neat.js";
import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";
import { assert } from "https://deno.land/std@0.150.0/testing/asserts.ts";
import { make as makeConfig } from "../src/config/NeatConfig.ts";
import { addTag } from "../src/tags/TagsInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("previous", async () => {
  const creature: NetworkInterface = NetworkUtil.fromJSON({
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

  creature.score = 0.1234;

  const config = makeConfig({ experimentStore: ".testExperiments" });
  const util = new NeatUtil(new Neat(1, 1), config);

  const p = [creature];
  util.writeScores(p);

  const flag = await util.previousExperiment(creature);

  assert(flag, "should have detected itself just written");

  delete creature.score;
  const flag2 = await util.previousExperiment(creature);

  assert(flag2, "Don't look at score");

  addTag(creature, "hello", "world");

  const flag3 = await util.previousExperiment(creature);

  assert(flag3, "Don't care about tags");
});
