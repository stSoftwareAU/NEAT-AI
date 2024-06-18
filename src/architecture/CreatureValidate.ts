import type { Creature } from "../Creature.ts";
import { ValidationError } from "../errors/ValidationError.ts";

/**
 * Validate the creature
 * @param options specific values to check
 */
export function creatureValidate(
  creature: Creature,
  options?: { neurons?: number; connections?: number },
) {
  if (options && options.neurons) {
    if (creature.neurons.length !== options.neurons) {
      throw new ValidationError(
        `Neurons length: ${creature.neurons.length} expected: ${options.neurons}`,
        "OTHER",
      );
    }
  }

  if (Number.isInteger(creature.input) == false || creature.input < 1) {
    throw new ValidationError(
      `Must have at least one input neurons was: ${creature.input}`,
      "OTHER",
    );
  }

  if (Number.isInteger(creature.output) == false || creature.output < 1) {
    throw new ValidationError(
      `Must have at least one output neurons was: ${creature.output}`,
      "OTHER",
    );
  }

  const stats = {
    input: 0,
    constant: 0,
    hidden: 0,
    output: 0,
    connections: 0,
  };

  let outputIndx = 0;
  const UUIDs = new Set<string>();
  creature.neurons.forEach((node, indx) => {
    const uuid = node.uuid;
    if (!uuid) {
      throw new ValidationError(`${node.ID()}) no UUID`, "OTHER");
    }
    if (UUIDs.has(uuid)) {
      if (creature.DEBUG) {
        creature.DEBUG = false;
        Deno.writeTextFileSync(
          ".validate.json",
          JSON.stringify(creature.exportJSON(), null, 2),
        );

        creature.DEBUG = true;
      }
      throw new ValidationError(
        `${node.ID()}) duplicate UUID: ${uuid}`,
        "OTHER",
      );
    }
    if (uuid.startsWith("input-")) {
      if (uuid !== "input-" + indx) {
        if (creature.DEBUG) {
          creature.DEBUG = false;
          Deno.writeTextFileSync(
            ".validate.json",
            JSON.stringify(creature.exportJSON(), null, 2),
          );

          creature.DEBUG = true;
        }
        throw new ValidationError(
          `${node.ID()}) invalid input UUID: ${uuid}`,
          "OTHER",
        );
      }
    } else {
      if (!Number.isFinite(node.bias)) {
        throw new ValidationError(
          `${node.ID()}) invalid bias: ${node.bias}`,
          "OTHER",
        );
      }
    }

    if (node.type == "output") {
      const expectedUUID = `output-${outputIndx}`;
      outputIndx++;
      if (uuid !== expectedUUID) {
        if (creature.DEBUG) {
          creature.DEBUG = false;
          Deno.writeTextFileSync(
            ".validate.json",
            JSON.stringify(creature.exportJSON(), null, 2),
          );

          creature.DEBUG = true;
        }
        throw new ValidationError(
          `${uuid} + ") invalid output UUID: ${uuid}`,
          "OTHER",
        );
      }
    } else if (outputIndx) {
      if (creature.DEBUG) {
        creature.DEBUG = false;
        Deno.writeTextFileSync(
          ".validate.json",
          JSON.stringify(creature.exportJSON(), null, 2),
        );

        creature.DEBUG = true;
      }
      throw new ValidationError(
        `${uuid} + ") type ${node.type} after output neuron`,
        "OTHER",
      );
    }

    if (node.type == "input" && indx > creature.input) {
      if (creature.DEBUG) {
        creature.DEBUG = false;
        Deno.writeTextFileSync(
          ".validate.json",
          JSON.stringify(creature.exportJSON(), null, 2),
        );

        creature.DEBUG = true;
      }
      throw new ValidationError(
        `${uuid} + ") input neuron after the maximum input neurons`,
        "OTHER",
      );
    }
    UUIDs.add(uuid);

    if (node.squash === "IF" && indx > 2) {
      const toList = creature.inwardConnections(indx);
      if (toList.length < 3) {
        throw new ValidationError(
          `${node.ID()}) 'IF' should have at least 3 inward connections was: ${toList.length}`,
          "IF_CONDITIONS",
        );
      }

      let foundPositive = false;
      let foundCondition = false;
      let foundNegative = false;

      for (let i = toList.length; i--;) {
        const c = toList[i];
        if (c.type == "condition") {
          foundCondition = true;
        } else if (c.type == "negative") {
          foundNegative = true;
        } else if (c.type == "positive") {
          foundPositive = true;
        }
      }
      if (!foundCondition || !foundPositive || !foundNegative) {
        if (creature.DEBUG) {
          creature.DEBUG = false;
          console.warn(
            JSON.stringify(creature.exportJSON(), null, 2),
          );
          creature.DEBUG = true;
        }
      }
      if (!foundCondition) {
        throw new ValidationError(
          `${node.ID()}) 'IF' should have a condition(s)`,
          "IF_CONDITIONS",
        );
      }
      if (!foundPositive) {
        throw new ValidationError(
          `${node.ID()}) 'IF' should have a positive connection(s)`,
          "IF_CONDITIONS",
        );
      }
      if (!foundNegative) {
        throw new ValidationError(
          `${node.ID()}) 'IF' should have a negative connection(s)`,
          "IF_CONDITIONS",
        );
      }
    }
    switch (node.type) {
      case "input": {
        stats.input++;
        const toList = creature.inwardConnections(indx);
        if (toList.length > 0) {
          throw new Error(
            `'input' neuron ${node.ID()} has inward connections: ${toList.length}`,
          );
        }
        break;
      }
      case "constant": {
        stats.constant++;
        const toList = creature.inwardConnections(indx);
        if (toList.length > 0) {
          throw new Error(
            `'${node.type}' neuron ${node.ID()}  has inward connections: ${toList.length}`,
          );
        }
        if (node.squash) {
          throw new Error(
            `Node ${node.ID()} '${node.type}' has squash: ${node.squash}`,
          );
        }
        const fromList = creature.outwardConnections(indx);
        if (fromList.length == 0) {
          if (creature.DEBUG) {
            creature.DEBUG = false;
            console.warn(
              JSON.stringify(
                creature.internalJSON(),
                null,
                2,
              ),
            );
            creature.DEBUG = true;
          }
          throw new ValidationError(
            `constants neuron ${node.ID()} has no outward connections`,
            "NO_OUTWARD_CONNECTIONS",
          );
        }
        break;
      }
      case "hidden": {
        stats.hidden++;
        const toList = creature.inwardConnections(indx);
        if (toList.length == 0) {
          throw new ValidationError(
            `hidden neuron ${node.ID()} has no inward connections`,
            "NO_INWARD_CONNECTIONS",
          );
        }
        const fromList = creature.outwardConnections(indx);
        if (fromList.length == 0) {
          if (creature.DEBUG) {
            creature.DEBUG = false;
            console.warn(
              JSON.stringify(
                creature.exportJSON(),
                null,
                2,
              ),
            );
            creature.DEBUG = true;
          }
          throw new ValidationError(
            `hidden neuron ${node.ID()} has no outward connections`,
            "NO_OUTWARD_CONNECTIONS",
          );
        }
        if (node.bias === undefined) {
          throw new Error(
            `hidden neuron ${node.ID()} should have a bias was: ${node.bias}`,
          );
        }
        if (!Number.isFinite(node.bias)) {
          throw new Error(
            `${node.ID()}) hidden neuron should have a finite bias was: ${node.bias}`,
          );
        }

        break;
      }
      case "output": {
        stats.output++;
        const toList = creature.inwardConnections(indx);
        if (toList.length == 0) {
          if (creature.DEBUG) {
            creature.DEBUG = false;
            console.warn(
              JSON.stringify(
                creature.exportJSON(),
                null,
                2,
              ),
            );
            creature.DEBUG = true;
          }
          throw new ValidationError(
            `${node.ID()}) output neuron has no inward connections`,
            "NO_INWARD_CONNECTIONS",
          );
        }
        break;
      }
      default:
        throw new Error(`${node.ID()}) Invalid type: ${node.type}`);
    }

    if (node.index !== indx) {
      throw new ValidationError(
        `${node.ID()}) node.index: ${node.index} does not match expected index ${indx}`,
        "OTHER",
      );
    }

    if (node.creature !== creature) {
      throw new Error(`node ${node.ID()} creature mismatch`);
    }
  });

  if (stats.input !== creature.input) {
    throw new ValidationError(
      `Expected ${creature.input} input neurons found: ${stats.input}`,
      "OTHER",
    );
  }

  if (stats.output !== creature.output) {
    throw new Error(
      `Expected ${creature.output} output neurons found: ${stats.output}`,
    );
  }

  let lastFrom = -1;
  let lastTo = -1;
  creature.synapses.forEach((c, indx) => {
    stats.connections++;
    const toNode = creature.neurons[c.to];

    if (toNode.type === "input") {
      throw new Error(indx + ") connection points to an input node");
    }

    if (c.from < lastFrom) {
      throw new Error(indx + ") synapses not sorted");
    } else if (c.from > lastFrom) {
      lastTo = -1;
    }

    if (c.from == lastFrom && c.to <= lastTo) {
      throw new Error(indx + ") synapses not sorted");
    }

    lastFrom = c.from;
    lastTo = c.to;
  });

  if (options && Number.isInteger(options.connections)) {
    if (creature.synapses.length !== options.connections) {
      throw new ValidationError(
        "Synapses length: " + creature.synapses.length +
          " expected: " +
          options.connections,
        "OTHER",
      );
    }
  }

  return stats;
}
