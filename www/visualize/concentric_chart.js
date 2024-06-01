// deno-lint-ignore-file no-window no-window-prefix
import { calculateInfluence, loadAliases } from "./influence_calculation.js";

document.addEventListener("DOMContentLoaded", () => {
  const modelList = document.getElementById("modelList");
  const graphContainer = document.getElementById("graph-container");
  const backButton = document.getElementById("backButton");
  const modelSelection = document.getElementById("modelSelection");
  const visualizationContainer = document.getElementById(
    "visualizationContainer",
  );
  let aliases = {};

  // Load aliases if available
  loadAliases((data) => {
    aliases = data;
  });

  // Load models from index.json
  fetch("../models/index.json")
    .then((response) => response.json())
    .then((models) => {
      models.forEach((model) => {
        const li = document.createElement("li");
        li.textContent = model;
        li.classList.add("list-group-item");
        li.addEventListener("click", () => loadModel(model));
        modelList.appendChild(li);
      });

      // Check for URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const modelParam = urlParams.get("MODEL");
      if (modelParam) {
        loadModel(modelParam);
      }
    });

  backButton.addEventListener("click", () => {
    window.history.back();
  });

  function loadModel(modelName) {
    fetch(`../models/${modelName}.json`)
      .then((response) => response.json())
      .then((modelData) => visualizeModel(modelData))
      .catch((error) => console.error("Error loading model:", error));
  }

  function visualizeModel(modelData) {
    modelSelection.classList.add("d-none");
    visualizationContainer.classList.remove("d-none");

    const influences = calculateInfluence(modelData);

    const elements = [];
    const layers = {};
    const inputNeuronsWithSynapses = [];
    const inputNeuronsWithoutSynapses = [];
    let hasConstants = false;

    // Initialize layers for input neurons
    for (let i = 0; i < modelData.input; i++) {
      const id = `input-${i}`;
      const hasSynapses = modelData.synapses.some(
        (synapse) => synapse.fromUUID === id,
      );
      if (hasSynapses) {
        inputNeuronsWithSynapses.push(id);
      } else {
        inputNeuronsWithoutSynapses.push(id);
      }
      layers[id] = hasSynapses ? 2 : 1;
    }

    // Helper function to calculate the layer of a neuron using an iterative approach
    function calculateLayer(neuronId, type) {
      const stack = [neuronId];
      const visited = new Set();

      while (stack.length > 0) {
        const currentNeuron = stack.pop();
        if (visited.has(currentNeuron)) {
          continue;
        }
        visited.add(currentNeuron);

        if (layers[currentNeuron] !== undefined) {
          continue;
        }

        const incomingSynapses = modelData.synapses.filter(
          (synapse) => synapse.toUUID === currentNeuron,
        );

        let maxLayer = Math.max(
          ...incomingSynapses.map((synapse) => {
            if (!visited.has(synapse.fromUUID)) {
              stack.push(synapse.fromUUID);
            }
            return layers[synapse.fromUUID] || 0;
          }),
        );

        if (type === "output" || type === "hidden") {
          if (hasConstants && maxLayer < 4) {
            maxLayer += 1;
          }
        }
        layers[currentNeuron] = maxLayer + 1;
      }

      return layers[neuronId];
    }

    modelData.neurons.forEach((neuron) => {
      if (neuron.type === "constant") {
        hasConstants = true;
        layers[neuron.uuid] = 3;
      }
    });

    // Calculate layers for all neurons
    modelData.neurons.forEach((neuron) => {
      if (neuron.type !== "output") {
        calculateLayer(neuron.uuid, neuron.type);
      }
    });

    // Determine the layer for output neurons
    const outputLayer = Math.max(...Object.values(layers)) + 1;

    modelData.neurons.forEach((neuron) => {
      if (neuron.type === "output") {
        layers[neuron.uuid] = outputLayer;
      }
    });

    const sizeScale = 12;
    const sizeMin = 24;

    // Create elements for Cytoscape
    for (let i = 0; i < modelData.input; i++) {
      const id = `input-${i}`;
      const hasSynapses = modelData.synapses.some(
        (synapse) => synapse.fromUUID === id,
      );
      const classes = hasSynapses ? "input-node" : "input-no-synapse-node";

      const ns = influences[id] ? influences[id] : 1;
      const size = Math.max(ns * sizeScale, sizeMin); // Apply scaling factor to ensure visibility

      elements.push({
        data: {
          id: id,
          label: "",
          width: size,
          height: size,
          type: "input",
          layer: layers[id],
        },
        classes: classes,
      });
    }

    modelData.neurons.forEach((neuron) => {
      const classes = neuron.type === "constant"
        ? "constant-node"
        : `${neuron.type}-node ${neuron.squash}`;

      const size = Math.max(influences[neuron.uuid] * sizeScale, sizeMin); // Apply scaling factor to ensure visibility

      elements.push({
        data: {
          id: neuron.uuid,
          neuron,
          label: "",
          type: neuron.type,
          width: size,
          height: size,
          layer: layers[neuron.uuid],
        },
        classes: classes,
      });
    });

    // Create synapses
    modelData.synapses.forEach((synapse) => {
      elements.push({
        data: {
          id: `${synapse.fromUUID}-${synapse.toUUID}`,
          source: synapse.fromUUID,
          target: synapse.toUUID,
          weight: synapse.weight,
        },
        classes: "synapse",
      });
    });

    const cy = cytoscape({
      container: graphContainer,
      elements: elements,
      style: window.stylesheet,
      layout: {
        name: "concentric",
        concentric: function (node) {
          return node.data("layer");
        },
        levelWidth: function (_nodes) {
          return 0.01;
        },
        padding: 1000,
      },
    });

    cy.on("tap", "node", function (event) {
      const node = event.target;
      if (node.hasClass("highlighted")) {
        cy.elements().removeClass("faded").removeClass("highlighted");
      } else {
        cy.elements().removeClass("highlighted");
        cy.elements().addClass("faded");

        node.removeClass("faded").addClass("highlighted");
        node.predecessors().removeClass("faded").addClass("highlighted");
        node.successors().removeClass("faded").addClass("highlighted");
      }
    });

    cy.ready(() => {
      cy.nodes().forEach((node) => {
        const neuron = node.data("neuron");
        const type = node.data("type");

        const alias = Object.keys(aliases).find(
          (key) => aliases[key] === node.data("id"),
        );

        let content;
        if (type === "input" || type === "input-no-synapse") {
          content = `
            <div>
                <strong>UUID:</strong> ${node.data("id")}<br>
                ${alias ? `<strong>Alias:</strong> ${alias}<br>` : ""}
            </div>
          `;
        } else if (type === "constant") {
          content = `
            <div>
                <strong>UUID:</strong> ${neuron.uuid}<br>
                <strong>Bias:</strong> ${neuron.bias}<br>
            </div>
          `;
        } else {
          content = `
            <div>
                <strong>UUID:</strong> ${neuron.uuid}<br>
                <strong>Bias:</strong> ${neuron.bias}<br>
                <strong>Squash:</strong> ${neuron.squash}<br>
                <strong>Depth:</strong> ${layers[neuron.uuid]}<br>
            </div>
          `;
        }

        const popoverElement = document.createElement("div");
        popoverElement.setAttribute("data-bs-toggle", "tooltip");
        popoverElement.setAttribute("data-bs-html", "true");
        popoverElement.setAttribute("title", content);
        document.body.appendChild(popoverElement);

        const tooltip = new bootstrap.Tooltip(popoverElement, {
          html: true,
          trigger: "manual",
          container: "body",
        });

        node.on("mouseover", (event) => {
          const nodePosition = event.target.renderedPosition();
          popoverElement.style.position = "absolute";
          popoverElement.style.left = `${nodePosition.x + 10}px`;
          popoverElement.style.top = `${nodePosition.y + 10}px`;
          tooltip.show();
        });

        node.on("mouseout", () => {
          tooltip.hide();
        });
      });
    });

    cy.fit();
  }

  function adjustGraphContainerSize() {
    const height = window.innerHeight -
      visualizationContainer.getBoundingClientRect().top - 20;
    graphContainer.style.height = `${height}px`;
  }

  window.addEventListener("resize", adjustGraphContainerSize);
  adjustGraphContainerSize();
});
