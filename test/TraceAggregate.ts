import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TraceAggregate", () => {
  const json: NetworkInterface = {
    nodes: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "MINIMUM", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    connections: [
      { weight: 0.1, from: 0, to: 2 },
      { weight: -0.2, from: 1, to: 3 },
      { weight: 0.3, from: 2, to: 4 },
      { weight: -0.4, from: 3, to: 4 },
      { weight: -0.5, from: 4, to: 5 },
      { weight: 0.6, from: 4, to: 6 },
    ],
    input: 2,
    output: 2,
  };
  const network = NetworkUtil.fromJSON(json);
  network.util.validate();

  const input = [0.1, 0.2];
  const startOut = network.util.activate(input);

  console.info(
    "START",
    "output",
    startOut,
  );
});
