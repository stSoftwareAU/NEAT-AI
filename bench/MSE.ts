import { Costs } from "../src/Costs.ts";

const samples: number[] = [];
for (let i = 0; i < 1000; i++) {
  samples[i] = Math.random();
}

const mse = Costs.find("MSE");

Deno.bench( "MSE",
  ()=> {
    mse.calculate(samples, samples);
  }
);