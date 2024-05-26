document.addEventListener("DOMContentLoaded", function () {
  const modelList = document.getElementById("modelList");
  const orientationSelect = document.getElementById("orientationSelect");
  const backButton = document.getElementById("backButton");
  const visualizationContainer = document.getElementById(
    "visualizationContainer",
  );
  const modelSelection = document.getElementById("modelSelection");
  const graphContainer = document.getElementById("graph-container");

  fetch("models/index.json")
    .then((response) => response.json())
    .then((models) => {
      models.forEach((model) => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.textContent = model;
        li.onclick = () => loadModel(model);
        modelList.appendChild(li);
      });
    })
    .catch((error) => console.error("Error loading models:", error));

  function loadModel(modelName) {
    fetch(`models/${modelName}.json`)
      .then((response) => response.json())
      .then((modelData) => {
        visualizeModel(modelData);
        modelSelection.classList.add("d-none");
        visualizationContainer.classList.remove("d-none");
      })
      .catch((error) => console.error("Error loading model:", error));
  }

  backButton.addEventListener("click", () => {
    modelSelection.classList.remove("d-none");
    visualizationContainer.classList.add("d-none");
  });

  function visualizeModel(modelData) {
    const nodes = [];
    const edges = [];

    // Create input nodes
    for (let i = 0; i < modelData.input; i++) {
      nodes.push({
        data: {
          id: `input-${i}`,
          type: "input",
        },
        classes: "input",
      });
    }

    // Create hidden and output nodes
    modelData.neurons.forEach((neuron) => {
      nodes.push({
        data: {
          id: neuron.uuid,
          type: neuron.type,
        },
        classes: neuron.type,
      });
    });

    // Create synapses (edges)
    modelData.synapses.forEach((synapse) => {
      edges.push({
        data: {
          id: `${synapse.fromUUID}-${synapse.toUUID}`,
          source: synapse.fromUUID,
          target: synapse.toUUID,
          weight: synapse.weight,
        },
      });
    });

    // Initialize Cytoscape
    const cy = cytoscape({
      container: graphContainer,
      elements: {
        nodes: nodes,
        edges: edges,
      },
      style: [
        {
          selector: "node.input",
          style: {
            "background-color": "blue",
          },
        },
        {
          selector: "node.hidden",
          style: {
            "background-color": "orange",
          },
        },
        {
          selector: "node.output",
          style: {
            "background-color": "red",
          },
        },
        {
          selector: "edge",
          style: {
            "width": 2,
            "line-color": "#ccc",
            "target-arrow-color": "#ccc",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
      ],
      layout: {
        name: orientationSelect.value === "horizontal"
          ? "breadthfirst"
          : "breadthfirst",
        directed: true,
        padding: 10,
        spacingFactor: 2,
      },
    });

    // Initialize Bootstrap tooltips
    cy.nodes().forEach((node) => {
      if (node.data("type") !== "input") {
        const neuron = modelData.neurons.find((n) => n.uuid === node.id()) ||
          { uuid: node.id(), bias: "N/A", squash: "N/A" };
        const tooltipContent = `
                <div>
                    <strong>UUID:</strong> ${neuron.uuid}<br>
                    <strong>Bias:</strong> ${neuron.bias}<br>
                    <strong>Squash:</strong> ${neuron.squash}
                </div>
            `;
        const el = document.createElement("div");
        el.innerHTML = tooltipContent;
        el.setAttribute("data-bs-toggle", "tooltip");
        el.setAttribute("data-bs-placement", "top");
        el.setAttribute("title", tooltipContent);
        document.body.appendChild(el);
        new bootstrap.Tooltip(el);
      }
    });
  }
});
