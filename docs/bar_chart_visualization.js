document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("backButton");
  const barChartCanvas = document.getElementById("barChart");

  backButton.addEventListener("click", () => {
    window.history.back();
  });

  const urlParams = new URLSearchParams(window.location.search);
  const modelParam = urlParams.get("MODEL");

  if (modelParam) {
    loadModel(modelParam);
  }

  let barChart; // Variable to hold the chart instance

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
    const backgroundColors = [];

    for (let i = 0; i < inputCount; i++) {
      const id = `input-${i}`;
      const alias = aliases[id] || id;
      labels.push(alias);
      const influence = influences[id] || 0;
      data.push(influence);
      backgroundColors.push(
        influence === 0 ? "lightyellow" : "rgba(54, 162, 235, 0.2)",
      );
    }

    if (barChart) {
      barChart.destroy(); // Destroy the existing chart if it exists
    }

    barChart = new Chart(barChartCanvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Influence on Output Neurons",
          data: data,
          backgroundColor: backgroundColors,
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y", // Horizontal bar chart
        scales: {
          x: {
            beginAtZero: true,
          },
        },
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  }

  function visualizeModel(modelData) {
    calculateInfluence(modelData);
  }
});
