import { calculateInfluence, loadAliases } from "./influence_calculation.js";

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
    fetch(`../models/${modelName}.json`)
      .then((response) => response.json())
      .then((modelData) => visualizeModel(modelData))
      .catch((error) => console.error("Error loading model:", error));
  }

  function renderBarChart(influences, inputCount, aliases) {
    const labels = [];
    const data = [];

    for (let i = 0; i < inputCount; i++) {
      const id = `input-${i}`;
      const alias = Object.keys(aliases).find(
        (key) => aliases[key] === id,
      );

      let label = alias || id;
      const influence = influences[id] || 0;

      if (influence === 0) {
        label += "*"; // Append asterisk to labels with no synapses
      }

      labels.push(label);
      data.push(influence * 100); // Convert to percentage
    }

    const trace = {
      x: data,
      y: labels,
      type: "bar",
      orientation: "h",
      text: data.map((value) => `${value.toFixed(2)}%`),
      textposition: "auto",
    };

    const layout = {
      yaxis: {
        automargin: true,
        autorange: "reversed", // Reverse the order of the labels
      },
      xaxis: {
        title: "Influence (%)",
      },
      height: Math.max(labels.length * 20, 250),
    };

    Plotly.newPlot(barChartContainer, [trace], layout);
  }

  function visualizeModel(modelData) {
    const influences = calculateInfluence(modelData);
    loadAliases((aliases) => {
      renderBarChart(influences, modelData.input, aliases);
    });
  }
});
