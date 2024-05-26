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
        li.addEventListener("click", () => visualizeModel(`models/${model}`));
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

        const svg = d3.select("svg");
        svg.selectAll("*").remove();
        const width = svg.node().getBoundingClientRect().width;
        const height = svg.node().getBoundingClientRect().height;

        const simulation = d3.forceSimulation()
          .force("link", d3.forceLink().id((d) => d.uuid))
          .force("charge", d3.forceManyBody())
          .force("center", d3.forceCenter(width / 2, height / 2));

        const nodes = [
          ...data.neurons,
          ...Array(data.input).fill().map((_, i) => ({
            type: "input",
            uuid: `input-${i}`,
          })),
        ];

        const links = data.synapses.map((d) => ({
          source: d.fromUUID,
          target: d.toUUID,
          weight: d.weight,
        }));

        const link = svg.append("g")
          .attr("class", "links")
          .selectAll("line")
          .data(links)
          .enter().append("line")
          .attr("class", "link");

        const node = svg.append("g")
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

        simulation
          .nodes(nodes)
          .on("tick", ticked);

        simulation.force("link")
          .links(links);

        function ticked() {
          link
            .attr("x1", (d) => d.source.x)
            .attr("y1", (d) => d.source.y)
            .attr("x2", (d) => d.target.x)
            .attr("y2", (d) => d.target.y);

          node
            .attr("transform", (d) => `translate(${d.x},${d.y})`);
        }
      });
  }
});
