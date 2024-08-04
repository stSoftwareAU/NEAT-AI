import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags";
import { Creature } from "../../src/Creature.ts";
import { fineTuneImprovement } from "../../src/blackbox/FineTune.ts";
import type { Approach } from "../../src/NEAT/LogApproach.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("tune", () => {
  const previousFittest: Creature = Creature.fromJSON({
    "neurons": [{
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
    "synapses": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "score", value: "-0.5" },
    ],
  });

  const fittest = Creature.fromJSON(
    previousFittest.exportJSON(),
  );
  fittest.score = -0.4;

  previousFittest.score = -0.5;
  addTag(fittest, "approach", "trained" as Approach);
  fittest.neurons[2].bias = 0.001;
  fittest.synapses[0].weight = 0.011;

  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    10,
  );

  assert(
    fineTuned.length == 10,
    "We should have made ten changes, was: " + fineTuned.length,
  );
  addTag(fittest, "approach", "trained");
  const approach = getTag(fittest, "approach") as Approach;
  assert(approach == "trained", "Approach was: " + approach);
  const fineTuned2 = fineTuneImprovement(
    fittest,
    previousFittest,
    3,
  );

  assert(
    fineTuned2.length == 3,
    "We should have detected THREE changes was: " + fineTuned2.length,
  );
  addTag(fittest, "approach", "compact" as Approach);
  const fineTuned3 = fineTuneImprovement(
    fittest,
    previousFittest,
    4,
  );

  assert(
    fineTuned3.length == 4,
    "We should have detected FOUR changes was: " + fineTuned3.length,
  );
});

Deno.test("many", () => {
  const previousFittest = Creature.fromJSON({
    "neurons": [{
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
    "synapses": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "score", value: "-0.5" },
    ],
  });
  const fittest = Creature.fromJSON(
    previousFittest.exportJSON(),
  );

  fittest.score = -0.4;
  previousFittest.score = -0.5;

  addTag(fittest, "approach", "fine" as Approach);
  fittest.neurons[2].bias = 0.001;
  fittest.synapses[0].weight = 0.011;

  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    7,
  );

  assert(
    fineTuned.length == 7,
    "We should have made 7 changes, was: " + fineTuned.length,
  );
});
