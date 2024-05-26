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
      $("#modelSelection").addClass("d-none");
      $("#visualizationContainer").removeClass("d-none");
      visualizeModel(currentModel, $("#orientationSelect").val());
    }).fail(function () {
      alert("Error loading model: " + modelName);
    });
  }

  function visualizeModel(model, orientation) {
    const elements = [];

    for (let i = 0; i < model.input; i++) {
      elements.push({
        data: { id: `input-${i}`, label: `input-${i}` },
        classes: "input",
      });
    }

    model.neurons.forEach((neuron) => {
      elements.push({
        data: {
          id: neuron.uuid,
          label: "",
          bias: neuron.bias,
          squash: neuron.squash,
        },
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

    const layout = {
      name: "breadthfirst",
      directed: true,
      padding: 10,
      roots: elements.filter((ele) => ele.classes === "input").map((ele) =>
        ele.data.id
      ),
    };

    if (orientation === "vertical") {
      layout["nodeDimensionsIncludeLabels"] = true;
      layout["spacingFactor"] = 1.5;
      layout["transform"] = function (node, pos) {
        return { x: pos.y, y: pos.x };
      };
    }

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
      layout: layout,
    });

    cy.ready(function () {
      cy.fit();
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
