document.addEventListener("DOMContentLoaded", () => {
  const modelList = document.getElementById("modelList");
  const graphContainer = document.getElementById("graph-container");
  const backButton = document.getElementById("backButton");
  const modelSelection = document.getElementById("modelSelection");
  const visualizationContainer = document.getElementById(
    "visualizationContainer",
  );

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
    const inputNeurons = [];

    // Initialize layers for input neurons
    for (let i = 0; i < modelData.input; i++) {
      inputNeurons.push(`input-${i}`);
      layers[`input-${i}`] = 0;
    }

    // Helper function to calculate the layer of a neuron
    function calculateLayer(neuronId) {
      if (layers[neuronId] !== undefined) {
        return layers[neuronId];
      }

      const incomingSynapses = modelData.synapses.filter((synapse) =>
        synapse.toUUID === neuronId
      );
      if (incomingSynapses.length === 0) {
        layers[neuronId] = 1; // Constants and input neurons without synapses are on layer 1
      } else {
        const maxLayer = Math.max(
          ...incomingSynapses.map((synapse) =>
            calculateLayer(synapse.fromUUID)
          ),
        );
        layers[neuronId] = maxLayer + 1;
      }

      return layers[neuronId];
    }

    // Calculate layers for all neurons
    modelData.neurons.forEach((neuron) => calculateLayer(neuron.uuid));

    // Calculate the maximum layer
    const maxLayer = Math.max(...Object.values(layers)) + 1;

    // Adjust the spacing between layers
    const layerSpacing = 200; // Adjust this value to reduce the gap

    // Group neurons by layer
    const layerGroups = {};
    inputNeurons.forEach((id) => {
      if (!layerGroups[0]) layerGroups[0] = [];
      layerGroups[0].push(id);
    });
    modelData.neurons.forEach((neuron) => {
      const layer = layers[neuron.uuid];
      if (!layerGroups[layer]) layerGroups[layer] = [];
      layerGroups[layer].push(neuron.uuid);
    });

    // Calculate the position of neurons within each layer
    Object.keys(layerGroups).forEach((layer) => {
      const neurons = layerGroups[layer];
      const yOffset = (500 - neurons.length * 100) / 2 + 50; // Center neurons vertically
      neurons.forEach((neuronId, index) => {
        const position = {
          x: layer * layerSpacing + 200,
          y: index * 100 + yOffset,
        };
        neuronPositions[neuronId] = position;

        const neuron = modelData.neurons.find((n) => n.uuid === neuronId) || {};
        elements.push({
          data: {
            id: neuronId,
            neuron,
            label: "",
            type: neuron.type || "input",
          },
          position: position,
          classes: `${neuron.type || "input"}-node`,
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
      style: [
        {
          selector: ".input-node",
          style: {
            "background-color": "blue",
            "label": "data(label)",
            "text-valign": "center",
            "color": "white",
            "text-outline-width": 2,
            "text-outline-color": "blue",
          },
        },
        {
          selector: ".hidden-node",
          style: {
            "background-color": "orange",
          },
        },
        {
          selector: ".output-node",
          style: {
            "background-color": "purple",
          },
        },
        {
          selector: ".synapse",
          style: {
            "width": "mapData(weight, -1, 1, 1, 4)",
            "line-color": (ele) => ele.data("weight") < 0 ? "red" : "green",
            "target-arrow-color": (ele) =>
              ele.data("weight") < 0 ? "red" : "green",
            "target-arrow-shape": "triangle",
          },
        },
      ],
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

        let content;
        if (type === "input") {
          content = `
            <div>
                <strong>UUID:</strong> ${node.data("id")}<br>
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
