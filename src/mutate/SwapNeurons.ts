import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { RadioactiveInterface } from "./RadioactiveInterface.ts";

export class SwapNeurons implements RadioactiveInterface {
  private creature: Creature;
  constructor(creature: Creature) {
    this.creature = creature;
  }

  private randomIndx(): number {
    const hiddenCount = this.creature.neurons.length -
      this.creature.input - this.creature.output;

    const hiddenIndex = Math.floor(
      Math.random() *
        hiddenCount,
    );

    const index = hiddenIndex + this.creature.input;

    return index;
  }

  mutate(focusList?: number[] | undefined): boolean {
    // Has no effect on input node, so they are excluded
    if (
      (this.creature.neurons.length - this.creature.input < 2) ||
      (this.creature.neurons.length - this.creature.input -
          this.creature.output < 2)
    ) {
      return false;
    }

    let node1 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const indx = this.randomIndx();

      if (this.creature.inFocus(indx, focusList)) {
        const tmpNode = this.creature.neurons[indx];
        if (tmpNode.type == "hidden") {
          node1 = tmpNode;
          break;
        }
      }
    }
    let changed = false;
    if (node1 !== null) {
      let node2 = null;
      for (let attempts = 0; attempts < 12; attempts++) {
        const indx = this.randomIndx();

        if (this.creature.inFocus(indx, focusList)) {
          const tmpNode = this.creature.neurons[indx];
          if (tmpNode.type == "hidden") {
            if (tmpNode.index !== node1.index) {
              if (
                tmpNode.squash !== node1.squash ||
                tmpNode.bias !== node1.bias
              ) {
                node2 = tmpNode;
                break;
              }
            }
          }
        }
      }

      if (node1 && node2) {
        const bias1 = node1.bias;
        const squash1 = node1.squash;
        assert(squash1);

        const squash2 = node2.squash;
        const bias2 = node2.bias;
        assert(squash2);
        node1.bias = bias2;
        node1.setSquash(squash2);

        node2.bias = bias1;
        node2.setSquash(squash1);

        node1.fix();
        node2.fix();

        changed = squash1 !== squash2 || bias1 !== bias2;
      }
    }

    return changed;
  }
}
