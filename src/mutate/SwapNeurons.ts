import { assert } from "@std/assert";
import { AbstractMutationOperator } from "./AbstractMutationOperator.ts";

export class SwapNeurons extends AbstractMutationOperator {
  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;

    // Need at least 2 hidden neurons to swap
    if (
      creature.neurons.length - creature.input - creature.output < 2
    ) {
      return false;
    }

    const idx1 = this.selectRandomHiddenNeuronIndex(focusList);
    if (idx1 === -1) return false;
    const node1 = creature.neurons[idx1];

    // Find a second hidden neuron that differs from the first
    let node2 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const idx2 = this.selectRandomHiddenNeuronIndex(focusList);
      if (idx2 === -1) continue;

      const tmpNode = creature.neurons[idx2];
      if (tmpNode.index !== node1.index) {
        if (tmpNode.squash !== node1.squash || tmpNode.bias !== node1.bias) {
          node2 = tmpNode;
          break;
        }
      }
    }

    if (!node2) return false;

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

    const changed = squash1 !== squash2 || bias1 !== bias2;
    if (changed) {
      delete creature.memetic;
    }
    return changed;
  }
}
