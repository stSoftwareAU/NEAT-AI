import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";
import { Network } from "../src/architecture/network.js";
import {
  assertEquals,
  fail,
} from "https://deno.land/std@0.161.0/testing/asserts.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";
import { DataRecordInterface } from "../src/architecture/DataSet.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Learn", () => {
  const nn = NetworkUtil.fromJSON(
    {
      nodes: [
        {
          bias: -0.05601433047338172,
          index: 2,
          type: "hidden",
          squash: "LOGISTIC"
        },
        {
          bias: -0.03918215964297005,
          index: 3,
          type: "hidden",
          squash: "BIPOLAR"
        },
        {
          bias: 0.5402230858136775,
          index: 4,
          type: "output",
          squash: "IDENTITY"
        },
        {
          bias: -1.2019708378892324,
          index: 5,
          type: "output",
          squash: "IDENTITY"
        }
      ],
      connections: [
        { weight: 2.0458515029017104, from: 0, to: 2 },
        { weight: -0.07677399122336755, from: 1, to: 3 },
        { weight: -0.5014045264238365, from: 1, to: 4 },
        { weight: 0.17748749525130925, from: 1, to: 5 },
        { weight: 0.0359712181205063, from: 2, to: 3 },
        { weight: -1.0963423331951507, from: 2, to: 4 },
        { weight: 2.2532403719566836, from: 2, to: 5 },
        { weight: -0.4016561292244124, from: 3, to: 5 }
      ],
      input: 2,
      output: 2
    }
  );

  nn.util.fix();
  nn.util.validate();
  
  const options: NeatOptions = {
    iterations: 10000,
    // error: 0.002,
    log: 50,
    elitism: 3,
  };

  const dataSet: DataRecordInterface[]=[];
  for( let i=0;i<10;i++){
    const input=[Math.random() * 2 -1, Math.random() * 2 -1];
    const dr={
      input:input,
      output: [(input[0]+input[1])/-2,input[0]+input[1]]
    };

    dataSet.push(dr);
  }

  const answersA=nn.util.noTraceActivate( [0.1, 0.2]);
  console.info( answersA);
  nn.util.train(dataSet, options);

  // console.info( nn.util.toJSON());

  const answersB=nn.util.noTraceActivate( [0.1, 0.2]);
  console.info( answersB);
});
