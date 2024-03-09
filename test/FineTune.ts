import { assert } from "https://deno.land/std@0.219.1/assert/mod.ts";
import { addTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../src/Creature.ts";
import { fineTuneImprovement } from "../src/architecture/FineTune.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("tune", async () => {
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
  addTag(fittest, "score", "-0.4");
  fittest.neurons[2].bias = 0.001;
  fittest.synapses[0].weight = 0.011;

  const fineTuned = await fineTuneImprovement(fittest, previousFittest);

  assert(
    fineTuned.length == 10,
    "We should have made ten changes, was: " + fineTuned.length,
  );

  const fineTuned2 = await fineTuneImprovement(fittest, previousFittest, 3);

  assert(
    fineTuned2.length == 3,
    "We should have detected THREE changes was: " + fineTuned2.length,
  );
});

Deno.test("many", async () => {
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
  addTag(fittest, "score", "-0.4");
  fittest.neurons[2].bias = 0.001;
  fittest.synapses[0].weight = 0.011;

  const fineTuned = await fineTuneImprovement(fittest, previousFittest, 7);

  assert(
    fineTuned.length == 7,
    "We should have made 7 changes, was: " + fineTuned.length,
  );
});
