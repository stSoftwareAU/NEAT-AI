document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("backButton");
  const barChartContainer = document.getElementById("barChartContainer");

  backButton.addEventListener("click", () => {
    window.history.back();
  });

  const urlParams = new URLSearchParams(window.location.search);
  const modelParam = urlParams.get("MODEL");

  if (modelParam) {
    loadModel(modelParam);
  }

  function loadModel(modelName) {
    fetch(`models/${modelName}.json`)
      .then((response) => response.json())
      .then((modelData) => visualizeModel(modelData))
      .catch((error) => console.error("Error loading model:", error));
  }

  function calculateInfluence(modelData) {
    const influences = {};
    const aliases = {};
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

    function propagateInfluence(neuronId, influence) {
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
        propagateInfluence(synapse.fromUUID, influence * proportion);
      });
    }

    const outputNeurons = modelData.neurons.filter(
      (neuron) => neuron.type === "output",
    );
    outputNeurons.forEach((neuron) => {
      propagateInfluence(neuron.uuid, 1);
    });

    fetch("models/Aliases.json")
      .then((response) => response.json())
      .then((data) => {
        Object.assign(aliases, data);
        renderBarChart(influences, modelData.input, aliases);
      })
      .catch((error) => {
        console.error("Error loading Aliases.json:", error);
        renderBarChart(influences, modelData.input, aliases);
      });

    return influences;
  }

  function renderBarChart(influences, inputCount, aliases) {
    const labels = [];
    const data = [];
    const colors = [];

    for (let i = 0; i < inputCount; i++) {
      const id = `input-${i}`;
      const alias = Object.keys(aliases).find(
        (key) => aliases[key] === id,
      );

      if (alias) {
        labels.push(alias);
      } else {
        labels.push(id);
      }
      const influence = influences[id] || 0;
      data.push(influence);

      // Highlight observations without synapses
      if (influence === 0) {
        colors.push("rgba(255, 165, 0, 0.5)"); // Light orange
      } else {
        colors.push("rgba(54, 162, 235, 0.7)"); // Default blue
      }
    }

    console.log(labels); // Debugging line
    console.log(data); // Debugging line

    const trace = {
      x: data,
      y: labels,
      type: "bar",
      orientation: "h",
      marker: {
        color: colors,
      },
    };

    const layout = {
      title: "Input Influence on Output Neurons",
      yaxis: {
        automargin: true,
        autorange: "reversed", // Reverse the order of the labels
      },
      xaxis: {
        title: "Influence",
      },
      height: labels.length * 20, // Adjust height based on the number of labels
    };

    Plotly.newPlot(barChartContainer, [trace], layout);
  }

  function visualizeModel(modelData) {
    calculateInfluence(modelData);
  }
});
