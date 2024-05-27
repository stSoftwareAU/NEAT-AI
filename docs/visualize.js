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
  fetch("models/Aliases.json")
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else {
        console.warn("Aliases.json not found. Proceeding without aliases.");
        return {};
      }
    })
    .then((data) => {
      aliases = data;
    })
    .catch((error) => {
      console.error("Error loading Aliases.json:", error);
    });

  // Load models from index.json
  fetch("models/index.json")
    .then((response) => response.json())
    .then((models) => {
      models.forEach((model) => {
        const li = document.createElement("li");
        li.textContent = model;
        li.classList.add("list-group-item");
        li.addEventListener("click", () => loadModel(model));
        modelList.appendChild(li);
      });
    });

  backButton.addEventListener("click", () => {
    modelSelection.classList.remove("d-none");
    visualizationContainer.classList.add("d-none");
  });

  function loadModel(modelName) {
    fetch(`models/${modelName}.json`)
      .then((response) => response.json())
      .then((modelData) => visualizeModel(modelData))
      .catch((error) => console.error("Error loading model:", error));
  }

  function visualizeModel(modelData) {
    modelSelection.classList.add("d-none");
    visualizationContainer.classList.remove("d-none");

    const elements = [];
    const layers = {};
    const neuronPositions = {};
    const inputNeuronsWithSynapses = [];
    const inputNeuronsWithoutSynapses = [];
    let hasConstants = false;

    // Initialize layers for input neurons
    for (let i = 0; i < modelData.input; i++) {
      const id = `input-${i}`;
      const hasSynapses = modelData.synapses.some((synapse) =>
        synapse.fromUUID === id
      );
      if (hasSynapses) {
        inputNeuronsWithSynapses.push(id);
      } else {
        inputNeuronsWithoutSynapses.push(id);
      }
      layers[id] = hasSynapses ? 1 : 0;
    }

    // Helper function to calculate the layer of a neuron
    function calculateLayer(neuronId, type) {
      if (layers[neuronId] !== undefined) {
        return layers[neuronId];
      }

      const incomingSynapses = modelData.synapses.filter((synapse) =>
        synapse.toUUID === neuronId
      );
      let maxLayer = Math.max(
        ...incomingSynapses.map((synapse) => calculateLayer(synapse.fromUUID)),
      );

      if (type && (type === "output" || type === "hidden")) {
        if (hasConstants && maxLayer) {
          maxLayer += 1;
        }
      }
      layers[neuronId] = maxLayer + 1;

      return layers[neuronId];
    }

    modelData.neurons.forEach((neuron) => {
      if (neuron.type === "constant") hasConstants = true;
    });

    // Calculate layers for all neurons
    modelData.neurons.forEach((neuron) =>
      calculateLayer(neuron.uuid, neuron.type)
    );

    // Adjust the spacing between layers
    const layerSpacing = 200; // Adjust this value to reduce the gap

    // Group neurons by layer
    const layerGroups = {};
    inputNeuronsWithoutSynapses.forEach((id) => {
      if (!layerGroups[0]) layerGroups[0] = [];
      layerGroups[0].push(id);
    });
    inputNeuronsWithSynapses.forEach((id) => {
      if (!layerGroups[1]) layerGroups[1] = [];
      layerGroups[1].push(id);
    });

    if (hasConstants) {
      modelData.neurons.forEach((neuron) => {
        if (neuron.type === "constant") {
          if (!layerGroups[2]) layerGroups[2] = [];
          layerGroups[2].push(neuron.uuid);
        }
      });
    }
    modelData.neurons.forEach((neuron) => {
      const layer = layers[neuron.uuid];
      if (!layerGroups[layer]) layerGroups[layer] = [];
      layerGroups[layer].push(neuron.uuid);
    });

    // Calculate the position of neurons within each layer
    Object.keys(layerGroups).forEach((layer) => {
      const neurons = layerGroups[layer];
      const xOffset = (graphContainer.clientWidth - neurons.length * 100) / 2 +
        50; // Center neurons horizontally
      neurons.forEach((neuronId, index) => {
        const position = {
          x: index * 100 + xOffset,
          y: layer * layerSpacing + 50,
        };
        neuronPositions[neuronId] = position;

        const neuron = modelData.neurons.find((n) => n.uuid === neuronId) || {};
        const classes = (layer == 0 && !modelData.synapses.some((synapse) =>
            synapse.fromUUID === neuronId
          ))
          ? "input-no-synapse-node"
          : neuron.type === "constant"
          ? "constant-node"
          : `${neuron.type || "input"}-node`;

        elements.push({
          data: {
            id: neuronId,
            neuron,
            label: "",
            type: neuron.type || "input",
          },
          position: position,
          classes: classes,
        });
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
        name: "preset",
        animate: true,
        fit: true,
        padding: 10,
      },
    });

    cy.ready(() => {
      cy.nodes().forEach((node) => {
        const neuron = node.data("neuron");
        const type = node.data("type");
        const alias = Object.keys(aliases).find((key) =>
          aliases[key] === node.data("id")
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
                <strong>Squash:</strong> ${neuron.squash}
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
