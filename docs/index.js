document.addEventListener("DOMContentLoaded", function () {
  const modelSelection = document.getElementById("modelSelection");
  const visualizationContainer = document.getElementById(
    "visualizationContainer",
  );
  const backButton = document.getElementById("backButton");

  // Fetch and list available models
  fetch("models/index.json")
    .then((response) => response.json())
    .then((data) => {
      const modelList = document.getElementById("modelList");
      data.forEach((model) => {
        const li = document.createElement("li");
        li.className = "list-group-item list-group-item-action";
        li.textContent = model;
        li.addEventListener(
          "click",
          () => visualizeModel(`models/${model}.json`),
        );
        modelList.appendChild(li);
      });
    });

  backButton.addEventListener("click", () => {
    visualizationContainer.classList.add("d-none");
    modelSelection.classList.remove("d-none");
  });

  // Function to visualize the selected model
  function visualizeModel(modelPath) {
    console.log(`Visualizing model: ${modelPath}`);
    fetch(modelPath)
      .then((response) => response.json())
      .then((data) => {
        console.log("Model data:", data);
        modelSelection.classList.add("d-none");
        visualizationContainer.classList.remove("d-none");

        const elements = [];

        // Generate input nodes based on the "input" attribute
        const inputNodes = Array.from({ length: data.input }, (_, i) => ({
          data: { id: `input-${i}`, type: "input", label: `input-${i}` },
        }));

        console.log("Input nodes:", inputNodes);

        const outputNodes = data.neurons.filter((d) => d.type === "output").map(
          (d) => ({
            data: {
              id: d.uuid,
              type: "output",
              label: "",
              bias: d.bias,
              squash: d.squash,
            },
          }),
        );

        const hiddenNodes = data.neurons.filter((d) =>
          d.type === "hidden" || d.type === "constant"
        ).map((d) => ({
          data: {
            id: d.uuid,
            type: d.type,
            label: "",
            bias: d.bias,
            squash: d.squash,
          },
        }));

        console.log("Output nodes:", outputNodes);
        console.log("Hidden nodes:", hiddenNodes);

        const nodes = [
          ...inputNodes,
          ...hiddenNodes,
          ...outputNodes,
        ];

        nodes.forEach((node) => elements.push(node));

        const links = data.synapses.map((d) => ({
          data: {
            id: `${d.fromUUID}-${d.toUUID}`,
            source: d.fromUUID,
            target: d.toUUID,
            weight: d.weight,
          },
        }));

        links.forEach((link) => elements.push(link));

        console.log("Elements:", elements);

        const cy = cytoscape({
          container: document.getElementById("graph-container"),
          elements: elements,
          style: [
            {
              selector: "node",
              style: {
                "background-color": "data(color)",
                "label": "data(label)",
              },
            },
            {
              selector: 'node[type="input"]',
              style: {
                "background-color": "blue",
              },
            },
            {
              selector: 'node[type="constant"]',
              style: {
                "background-color": "green",
              },
            },
            {
              selector: 'node[type="hidden"]',
              style: {
                "background-color": "orange",
              },
            },
            {
              selector: 'node[type="output"]',
              style: {
                "background-color": "red",
              },
            },
            {
              selector: "edge",
              style: {
                "width": "mapData(weight, 0, 1, 1, 5)",
                "line-color": "#ccc",
              },
            },
          ],
          layout: {
            name: "breadthfirst",
            directed: true,
            padding: 10,
            spacingFactor: 2,
            nodeDimensionsIncludeLabels: true,
            roots: inputNodes.map((n) => n.data.id),
          },
        });

        cy.on("mouseover", "node", function (event) {
          const node = event.target;
          const type = node.data("type");
          let content = `UUID: ${node.id()}`;
          if (type === "constant" || type === "hidden" || type === "output") {
            content += `<br>Bias: ${node.data("bias")}<br>Squash: ${
              node.data("squash")
            }`;
          }
          node.qtip({
            content: content,
            show: {
              event: event.type,
              ready: true,
            },
            hide: {
              event: "mouseout unfocus",
            },
            style: {
              classes: "qtip-bootstrap",
              tip: {
                width: 16,
                height: 8,
              },
            },
            position: {
              my: "top center",
              at: "bottom center",
            },
          }, event);
        });

        cy.on("mouseout", "node", function (event) {
          event.target.qtip("api").destroy(true);
        });
      });
  }
});
