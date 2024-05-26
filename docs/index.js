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
    fetch(modelPath)
      .then((response) => response.json())
      .then((data) => {
        modelSelection.classList.add("d-none");
        visualizationContainer.classList.remove("d-none");

        const svg = d3.select("#graph");
        svg.selectAll("*").remove();

        const width = svg.node().getBoundingClientRect().width;
        const height = svg.node().getBoundingClientRect().height;

        const g = svg.append("g");

        // Add zoom and pan
        const zoom = d3.zoom()
          .scaleExtent([0.1, 10])
          .on("zoom", (event) => {
            g.attr("transform", event.transform);
          });

        svg.call(zoom);

        // Generate input nodes based on the "input" attribute
        const inputNodes = Array.from({ length: data.input }, (_, i) => ({
          type: "input",
          uuid: `input-${i}`,
        }));

        const outputNodes = data.neurons.filter((d) =>
          d.uuid.startsWith("output-")
        );
        const hiddenNodes = data.neurons.filter((d) =>
          !d.uuid.startsWith("input-") && !d.uuid.startsWith("output-")
        );

        const nodes = [
          ...inputNodes,
          ...hiddenNodes,
          ...outputNodes,
        ];

        const links = data.synapses.map((d) => ({
          source: d.fromUUID,
          target: d.toUUID,
          weight: d.weight,
        }));

        const link = g.append("g")
          .attr("class", "links")
          .selectAll("line")
          .data(links)
          .enter().append("line")
          .attr("class", "link");

        const node = g.append("g")
          .attr("class", "nodes")
          .selectAll("g")
          .data(nodes)
          .enter().append("g")
          .attr("class", "node");

        node.append("circle")
          .attr("r", 5);

        node.append("text")
          .attr("x", 6)
          .attr("y", 3)
          .text((d) => d.uuid);

        const simulation = d3.forceSimulation(nodes)
          .force("link", d3.forceLink(links).id((d) => d.uuid).strength(0.1))
          .force("charge", d3.forceManyBody().strength(-30))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force(
            "x",
            d3.forceX((d) => {
              if (d.type === "input") return 100;
              if (d.uuid.startsWith("output-")) return width - 100;
              return width / 2;
            }).strength(1),
          )
          .force("y", d3.forceY(height / 2).strength(0.1));

        simulation.on("tick", () => {
          link
            .attr("x1", (d) => d.source.x)
            .attr("y1", (d) => d.source.y)
            .attr("x2", (d) => d.target.x)
            .attr("y2", (d) => d.target.y);

          node
            .attr("transform", (d) => `translate(${d.x},${d.y})`);
        });
      });
  }
});
