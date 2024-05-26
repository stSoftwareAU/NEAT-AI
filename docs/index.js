$(document).ready(function () {
  const models = [];
  $.getJSON("models/index.json", function (data) {
    data.forEach((model) => models.push(model));
    models.forEach((model) => {
      $("#modelList").append(`<li class="list-group-item">${model}</li>`);
    });
  });

  $("#modelList").on("click", ".list-group-item", function () {
    const modelName = $(this).text();
    loadModel(modelName);
  });

  $("#orientationSelect").change(function () {
    const orientation = $(this).val();
    visualizeModel(currentModel, orientation);
  });

  $("#backButton").click(function () {
    $("#visualizationContainer").addClass("d-none");
    $("#modelSelection").removeClass("d-none");
  });

  let currentModel;

  function loadModel(modelName) {
    $.getJSON(`models/${modelName}.json`, function (data) {
      currentModel = data;
      visualizeModel(currentModel, $("#orientationSelect").val());
      $("#modelSelection").addClass("d-none");
      $("#visualizationContainer").removeClass("d-none");
    }).fail(function () {
      alert("Error loading model: " + modelName);
    });
  }

  function visualizeModel(model, orientation) {
    const elements = [];

    for (let i = 0; i < model.input; i++) {
      elements.push({
        data: { id: `input-${i}`, label: "" },
        classes: "input",
      });
    }

    model.neurons.forEach((neuron) => {
      elements.push({
        data: { id: neuron.uuid, label: "" },
        classes: neuron.type,
      });
    });

    model.synapses.forEach((synapse) => {
      elements.push({
        data: {
          id: `${synapse.fromUUID}-${synapse.toUUID}`,
          source: synapse.fromUUID,
          target: synapse.toUUID,
        },
      });
    });

    const cy = cytoscape({
      container: document.getElementById("graph-container"),
      elements: elements,
      style: [
        {
          selector: ".input",
          style: {
            "background-color": "blue",
          },
        },
        {
          selector: ".hidden",
          style: {
            "background-color": "orange",
          },
        },
        {
          selector: ".output",
          style: {
            "background-color": "red",
          },
        },
        {
          selector: "edge",
          style: {
            "line-color": "gray",
            "target-arrow-color": "gray",
            "target-arrow-shape": "triangle",
          },
        },
      ],
      layout: {
        name: orientation === "horizontal" ? "breadthfirst" : "grid",
        directed: true,
        padding: 10,
        spacingFactor: 2,
        animate: true,
      },
    });

    cy.on("tap", "node", function (evt) {
      const node = evt.target;
      const content = `
              <div>
                  <p>UUID: ${node.data("id")}</p>
                  <p>Bias: ${node.data("bias") || "N/A"}</p>
                  <p>Squash: ${node.data("squash") || "N/A"}</p>
              </div>
          `;

      const popover = new bootstrap.Popover(node.popperRef(), {
        container: "body",
        content: content,
        html: true,
        trigger: "focus",
      });

      popover.show();
    });
  }
});
