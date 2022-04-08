import { architect } from "../../NEAT-TS/src/architecture/architect.js";
import { assert } from "https://deno.land/std@0.122.0/testing/asserts.ts";

Deno.test("hypotenuse", async () => {
  const network = architect.Random(2, 2, 1);

  const ts = [];
  for (let i = 100; i--;) {
    for (let j = 100; j--;) {
      if (i == 50) continue;
      const item = {
        input: [i, j],
        output: [Math.sqrt(i * i + j * j)],
      };

      ts.push(item);
    }
  }

  const options = {
    iterations: 1000,
    error: 0.002,
    shuffle: true,
    log: 50,
    elitism: 3,
    rate: 0.3,
    momentum: 0.9,
  };
  await network.evolve(ts, options);
  const check = [50, 10];
  const answer = network.activate(check)[0];

  console.log("Answer: ", answer);
  assert(
    answer > 45 && answer < 55,
    "Correct answer is ~51 but was: " + answer,
  );
  // console.log( network.toJSON());
});

// Deno.test("pie", async () => {
//   const network = architect.Random(100, 2, 1);

//   const ts = [];
//   for (let i = 100; i--;) {
//     const input = [];
//     const output = [];
//     for (let j = 100; j--;) {
//       if (j == 50) {
//         const r = 50 * Math.random();
//         const d = r * 2 * Math.PI; //Circuference
//         input.push(r);
//         output.push(d);
//       } else {
//         const v = 100 * Math.random() - 50; //complete junk
//         input.push(v);
//       }
//     }
//     const item = {
//       input: input,
//       output: output,
//     };

//     ts.push(item);
//   }

//   const options = {
//     iterations: 10000,
//     error: 0.03,
//     shuffle: true,
//     log: 50,
//     elitism: 1,
//     threads: 1,
//   };
//   await network.evolve(ts, options);
//   let expect = -1;
//   const input = [];
//   for (let j = 100; j--;) {
//     if (j == 50) {
//       const r = 50 * Math.random();
//       const d = r * 2 * Math.PI; //Circuference
//       input.push(r);
//       expect = d;
//     } else {
//       const v = 100 * Math.random() - 50; //complete junk
//       input.push(v);
//     }
//   }

//   const answer = network.activate(input)[0];

//   console.log("Answer: ", answer);
//   console.log(network.toJSON());
//   assert(
//     Math.abs(expect - answer) <= expect * 0.03,
//     "Didn't detect pie: " + answer,
//   );
// });
