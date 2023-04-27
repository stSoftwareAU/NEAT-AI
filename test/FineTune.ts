import { fineTuneImprovement } from "../src/architecture/FineTune.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import { assert } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("tune", () => {
  const previousFittest: NetworkInternal = Network.fromJSON({
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
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "score", value: "0.5" },
    ],
  });

  const fittest: NetworkInternal = Network.fromJSON({
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
      "bias": -1.045867615444029,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, { "weight": 0.96764643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
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
  const previousFittest: NetworkInternal = Network.fromJSON({
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
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "score", value: "0.5" },
    ],
  });

  const fittest: NetworkInternal = Network.fromJSON({
    "nodes": [{
      "bias": 0.123,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 0,
    }, {
      "bias": 0.456,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 1,
    }, {
      "bias": -1.845867615444029,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 2,
    }],
    "connections": [{
      "weight": 0.8967556172986067,
      "from": 1,
      "to": 2,
    }, {
      "weight": 0.86764643541,
      "from": 0,
      "to": 2,
    }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "score", value: "0.6" },
    ],
  });

  const fineTuned = fineTuneImprovement(fittest, previousFittest, 7);

  assert(
    fineTuned.length == 7,
    "We should have made 7 changes, was: " + fineTuned.length,
  );
});
