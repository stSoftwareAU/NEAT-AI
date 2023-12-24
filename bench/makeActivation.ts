import { Network } from "../src/architecture/Network.ts";
import { NetworkState } from "../src/architecture/NetworkState.ts";

const inputs: number[] = [];
for (let i = 0; i < 1000; i++) {
  inputs[i] = Math.random();
}

const creature=new Network(inputs.length, 3, { layers:[{count: 1000}]});

const ns = new NetworkState(creature);

Deno.bench( "makeActivation",
  ()=> {
    ns.makeActivation(inputs, false);
  }
);