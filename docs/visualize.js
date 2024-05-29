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

      // Check for URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const modelParam = urlParams.get("MODEL");
      if (modelParam) {
        loadModel(modelParam);
      }
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

  function calculateNeuronSizes(modelData) {
    const neuronSizes = {};
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

    function propagateSize(neuronId, size) {
      if (neuronSizes[neuronId] === undefined) {
        neuronSizes[neuronId] = 0;
      }
      neuronSizes[neuronId] += size;

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
        propagateSize(synapse.fromUUID, size * proportion);
      });
    }

    const outputNeurons = modelData.neurons.filter(
      (neuron) => neuron.type === "output",
    );
    const outputSize = 12 / outputNeurons.length;
    outputNeurons.forEach((neuron) => {
      propagateSize(neuron.uuid, outputSize);
    });

    return neuronSizes;
  }

  function visualizeModel(modelData) {
    modelSelection.classList.add("d-none");
    visualizationContainer.classList.remove("d-none");

    const neuronSizes = calculateNeuronSizes(modelData);

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

    // Helper function to calculate the layer of a neuron
    function calculateLayer(neuronId, type) {
      if (layers[neuronId] !== undefined) {
        return layers[neuronId];
      }

      const incomingSynapses = modelData.synapses.filter(
        (synapse) => synapse.toUUID === neuronId,
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
      if (neuron.type === "constant") {
        hasConstants = true;
        layers[neuron.uuid] = 3;
      }
    });

    // Calculate layers for all neurons
    modelData.neurons.forEach((neuron) =>
      calculateLayer(neuron.uuid, neuron.type)
    );

    // Determine the layer for output neurons
    const outputLayer = Math.max(...Object.values(layers)) + 1;

    modelData.neurons.forEach((neuron) => {
      if (neuron.type === "output") {
        layers[neuron.uuid] = outputLayer;
      }
    });
    console.info( layers);
    const sizeScale=10;
    const sizeMin=20;
    // Create elements for Cytoscape
    for (let i = 0; i < modelData.input; i++) {
      const id = `input-${i}`;
      const hasSynapses = modelData.synapses.some(
        (synapse) => synapse.fromUUID === id,
      );
      const classes = hasSynapses ? "input-node" : "input-no-synapse-node";

      const ns=neuronSizes[id]?neuronSizes[id]:1;
      const size = Math.max( ns * sizeScale, sizeMin); // Apply scaling factor to ensure visibility

      elements.push({
        data: {
          id: id,
          label: "",
          width: size,
          height: size,
          layer: layers[id],
        },
        classes: classes,
      });
    }

    modelData.neurons.forEach((neuron) => {
      const classes = neuron.type === "constant"
        ? "constant-node"
        : `${neuron.type || "input"}-node ${neuron.squash}`;

      const size = Math.max(neuronSizes[neuron.uuid] * sizeScale, sizeMin); // Apply scaling factor to ensure visibility

      elements.push({
        data: {
          id: neuron.uuid,
          neuron,
          label: "",
          type: neuron.type || "input",
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
        levelWidth: function (nodes) {
          // console.log(nodes.length);
          return 1;
        },
        padding: 10,
      },
    });

    cy.on("tap", "node", function (event) {
      const node = event.target;
      // console.log("Node clicked:", node.id());
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
        if (!neuron){
          console.info( `Node: ${node}`);
          return;
        }
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
