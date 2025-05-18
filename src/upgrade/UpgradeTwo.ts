import { assert } from "@std/assert/assert";
import type {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";

export function upgradeTwo(
  json: CreatureInternal | CreatureExport,
): CreatureInternal | CreatureExport {
  assert(
    json.semanticVersion && json.semanticVersion.startsWith("1."),
    `Already upgraded ${json.semanticVersion}`,
  );

  if ("index" in json.neurons[0]) {
    return json as CreatureInternal;
  }
  const exported = json as CreatureExport;

  const updated = removeHYPOT(exported);

  // CreatureExport
  return {
    ...updated as CreatureExport,
    semanticVersion: "2.0.0",
  } as CreatureExport;
}

function removeHYPOT(json: CreatureExport) {
  const neurons = json.neurons;
  const synapses = json.synapses;
  const changed = false;
  for (let i = 0; i < neurons.length; i++) {
    const neuron = neurons[i];
    if (neuron.squash === "HYPOT") {
      console.log("removing HYPOT neuron", neuron.uuid);
    }
  }

  if (changed) {
    return removeHYPOT(json);
  }

  // Preserve the original types from json to avoid type errors
  const updated = {
    ...json,
    neurons,
    synapses,
  };
  return updated;
}
