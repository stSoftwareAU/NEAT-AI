import { Costs } from "../src/Costs.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("calculate cost", () => {
  const checks = [
    { target: [0.8], output: [1.9] },
    { target: [0.8], output: [1] },
    { target: [0.8], output: [0.9] },
    { target: [0.9], output: [0.8] },
    { target: [-0.8], output: [-0.9] },
    { target: [-0.9], output: [-0.8] },

    { target: [0.5], output: [0.5] },
    { target: [-0.5], output: [0.5] },
  ];

  const names = [
    "CROSS_ENTROPY",
    "HINGE",
    "MAE",
    "MAPE",
    "MSE",
    "MSLE",
  ];

  checks.forEach((check) => {
    for (let i = names.length; i--;) {
      const name = names[i];
      if (
        name === "CROSS_ENTROPY" && (check.output[0] < 0 || check.output[0] > 1)
      ) {
        continue;
      }
      const r = Costs.find(name).calculate(
        new Float32Array(check.target),
        new Float32Array(check.output),
      );

      console.info(name, check, r);
    }
  });
});
