import { Creature } from "../src/Creature.ts";
import { CreatureState } from "../src/architecture/CreatureState.ts";

const inputs: number[] = [];
for (let i = 0; i < 1000; i++) {
  inputs[i] = Math.random();
}

const creature=new Creature(inputs.length, 3, { layers:[{count: 1000}]});

const ns = new CreatureState(creature);

Deno.bench( "makeActivation",
  ()=> {
    ns.makeActivation(inputs, false);
  }
);