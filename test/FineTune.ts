import { fineTuneImprovement } from "../src/architecture/FineTune.ts";
import { FitnessInterface } from "../src/architecture/FitnessInterface.ts";
import { assert } from "https://deno.land/std@0.122.0/testing/asserts.ts";

// Compact form: name and function
Deno.test("tune", () => {
  const previousFittest: FitnessInterface = {
    "nodes": [{
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "mask": 1,
      "index": 0,
    }, {
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "mask": 1,
      "index": 1,
    }, {
      "bias": -0.49135010426905,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "mask": 1,
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
      "gater": null,
    }, { "weight": 0.9686464354110709, "from": 0, "to": 2, "gater": null }],
    "input": 2,
    "output": 1,
    "dropout": 0,
    calculatedScore: 0.5,
    toJSON: function () {
      return this;
    },
  };

  const fittest: FitnessInterface = {
    "nodes": [{
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "mask": 1,
      "index": 0,
    }, {
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "mask": 1,
      "index": 1,
    }, {
      "bias": -1.045867615444029,
      "type": "output",
      "squash": "RELU",
      "mask": 1,
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
      "gater": null,
    }, { "weight": 0.9686464354110709, "from": 0, "to": 2, "gater": null }],
    "input": 2,
    "output": 1,
    "dropout": 0,
    calculatedScore: 0.6,
    toJSON: function () {
      return this;
    },
  };

  const fineTuned = fineTuneImprovement(fittest, previousFittest);

  assert(fineTuned.length > 0, "We should have detected a change");
});
