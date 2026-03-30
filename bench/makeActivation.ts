import { Creature } from "@creature";
import { CreatureState } from "@architecture/CreatureState.ts";

const tmp: number[] = [];
for (let i = 0; i < 1000; i++) {
  tmp[i] = Math.random();
}
const inputs = new Float32Array(tmp);
const creature = new Creature(inputs.length, 3, { layers: [{ count: 1000 }] });

const ns = new CreatureState(creature);

Deno.bench("makeActivation", () => {
  ns.makeActivation(inputs, false);
});
