export function calculateInfluence(modelData) {
  const influences = {};
  const incomingSynapsesMap = new Map();

  modelData.neurons.forEach((neuron) => {
    incomingSynapsesMap.set(neuron.uuid, []);
  });

  modelData.synapses.forEach((synapse) => {
    if (incomingSynapsesMap.has(synapse.toUUID)) {
      incomingSynapsesMap.get(synapse.toUUID).push(synapse);
    } else {
      console.warn(`Neuron ${synapse.toUUID} not found in map.`);
    }
  });

  function propagateInfluence(neuronId, influence, visited = new Set()) {
    if (visited.has(neuronId)) {
      return;
    }
    visited.add(neuronId);

    if (influences[neuronId] === undefined) {
      influences[neuronId] = 0;
    }
    influences[neuronId] += influence;

    const incomingSynapses = incomingSynapsesMap.get(neuronId);
    if (!incomingSynapses || incomingSynapses.length === 0) {
      return;
    }

    const totalIncomingWeight = incomingSynapses.reduce(
      (sum, synapse) => sum + Math.abs(synapse.weight),
      0,
    );

    if (totalIncomingWeight === 0) {
      return;
    }

    incomingSynapses.forEach((synapse) => {
      const proportion = Math.abs(synapse.weight) / totalIncomingWeight;
      propagateInfluence(synapse.fromUUID, influence * proportion, visited);
    });
  }

  const outputNeurons = modelData.neurons.filter(
    (neuron) => neuron.type === "output",
  );

  const initialInfluence = 1 / outputNeurons.length; // Use range 0..1
  outputNeurons.forEach((neuron) => {
    propagateInfluence(neuron.uuid, initialInfluence);
  });

  // Influence for input neurons should add up to 1
  const inputInfluences = Object.keys(influences).filter((key) =>
    key.startsWith("input-")
  );
  const inputTotalInfluence = inputInfluences.reduce(
    (sum, key) => sum + influences[key],
    0,
  );

  // Normalize input neuron influences to 1 if they don't add up correctly
  if (inputTotalInfluence !== 1) {
    inputInfluences.forEach((key) => {
      influences[key] /= inputTotalInfluence;
    });
  }

  return influences;
}

export function loadAliases(callback) {
  fetch("../models/Aliases.json")
    .then((response) => response.json())
    .then((data) => {
      callback(data);
    })
    .catch((error) => {
      console.error("Error loading Aliases.json:", error);
      callback({});
    });
}
