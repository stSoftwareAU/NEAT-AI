import { fineTuneImprovement } from "../src/architecture/FineTune.ts";
import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { Network } from "../src/architecture/network.js";
import { assert } from "https://deno.land/std@0.137.0/testing/asserts.ts";

// Compact form: name and function
Deno.test("tune", () => {
  const previousFittest: NetworkInterface = Network.fromJSON({
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
    }, { "weight": 0.96864643541, "from": 0, "to": 2, "gater": null }],
    "input": 2,
    "output": 1,
    "dropout": 0,
    tags: [
      { name: "score", value: "0.5" },
    ],
  });

  const fittest: NetworkInterface = Network.fromJSON({
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
      "squash": "BIPOLAR_SIGMOID",
      "mask": 1,
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
      "gater": null,
    }, { "weight": 0.96764643541, "from": 0, "to": 2, "gater": null }],
    "input": 2,
    "output": 1,
    "dropout": 0,
    tags: [
      { name: "score", value: "0.6" },
    ],
  });

  const fineTuned = fineTuneImprovement(fittest, previousFittest);

  assert(
    fineTuned.length == 10,
    "We should have made ten changes, was: " + fineTuned.length,
  );

  const fineTuned2 = fineTuneImprovement(fittest, previousFittest, 3);

  assert(
    fineTuned2.length == 3,
    "We should have detected THREE changes was: " + fineTuned2.length,
  );
});

Deno.test("many", () => {
  const previousFittest: NetworkInterface = Network.fromJSON({
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
    }, { "weight": 0.96864643541, "from": 0, "to": 2, "gater": null }],
    "input": 2,
    "output": 1,
    "dropout": 0,
    tags: [
      { name: "score", value: "0.5" },
    ],
  });

  const fittest: NetworkInterface = Network.fromJSON({
    "nodes": [{
      "bias": 0.123,
      "type": "input",
      "squash": "LOGISTIC",
      "mask": 1,
      "index": 0,
    }, {
      "bias": 0.456,
      "type": "input",
      "squash": "LOGISTIC",
      "mask": 1,
      "index": 1,
    }, {
      "bias": -1.845867615444029,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "mask": 1,
      "index": 2,
    }],
    "connections": [{
      "weight": 0.8967556172986067,
      "from": 1,
      "to": 2,
      "gater": null,
    }, {
      "weight": 0.86764643541,
      "from": 0,
      "to": 2,
      "gater": null,
    }],
    "input": 2,
    "output": 1,
    "dropout": 0,
    tags: [
      { name: "score", value: "0.6" },
    ],
  });

  const fineTuned = fineTuneImprovement(fittest, previousFittest, 5);

  assert(
    fineTuned.length == 5,
    "We should have made 5 changes, was: " + fineTuned.length,
  );
});
