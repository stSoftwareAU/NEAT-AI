document.addEventListener("DOMContentLoaded", () => {
  const modelList = document.getElementById("modelList");
  const orientationSelect = document.getElementById("orientationSelect");
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

    // Create input nodes
    for (let i = 0; i < modelData.input; i++) {
      elements.push({
        data: { id: `input-${i}`, label: "", type: "input" },
        classes: "input-node",
      });
    }

    // Create other neurons
    modelData.neurons.forEach((neuron, index) => {
      elements.push({
        data: { id: neuron.uuid, label: "", neuron },
        classes: `${neuron.type}-node`,
      });
    });

    // Create synapses
    modelData.synapses.forEach((synapse) => {
      elements.push({
        data: {
          id: `${synapse.fromUUID}-${synapse.toUUID}`,
          source: synapse.fromUUID,
          target: synapse.toUUID,
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
            "background-color": "red",
          },
        },
        {
          selector: ".synapse",
          style: {
            "width": 2,
            "line-color": "gray",
          },
        },
      ],
      layout: {
        name: "breadthfirst",
        directed: true,
        padding: 10,
        spacingFactor: 1.5,
        animate: true,
        fit: true,
      },
    });

    cy.ready(() => {
      cy.elements().forEach((element) => {
        if (element.isNode()) {
          const neuron = element.data("neuron");
          if (neuron) {
            const content = `
                          <div>
                              <strong>UUID:</strong> ${neuron.uuid}<br>
                              <strong>Bias:</strong> ${neuron.bias}<br>
                              <strong>Squash:</strong> ${neuron.squash}
                          </div>
                      `;
            const el = element.popperRef(); // used only for positioning
            const popper = new bootstrap.Popover(el, {
              content: content,
              title: neuron.uuid,
              trigger: "hover",
              placement: "auto",
            });
            element.on("mouseover", () => {
              popper.show();
            });
            element.on("mouseout", () => {
              popper.hide();
            });
          }
        }
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
