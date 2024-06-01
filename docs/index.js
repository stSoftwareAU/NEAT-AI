document.addEventListener("DOMContentLoaded", () => {
  const modelList = document.getElementById("modelList");

  // Load models from index.json
  fetch("models/index.json")
    .then((response) => response.json())
    .then((models) => {
      models.forEach((model) => {
        const row = document.createElement("div");
        row.classList.add("row", "mb-3");

        const colModel = document.createElement("div");
        colModel.classList.add("col-3", "d-flex", "align-items-center");
        colModel.textContent = model;

        const colLinks = document.createElement("div");
        colLinks.classList.add("col-9");

        const concentricLink = document.createElement("a");
        concentricLink.href = `visualize.html?MODEL=${model}`;
        concentricLink.textContent = "Concentric";
        concentricLink.classList.add("btn", "btn-primary", "me-2");

        const barLink = document.createElement("a");
        barLink.href = `bar_chart_visualization.html?MODEL=${model}`;
        barLink.textContent = "Bar";
        barLink.classList.add("btn", "btn-secondary");

        colLinks.appendChild(concentricLink);
        colLinks.appendChild(barLink);

        row.appendChild(colModel);
        row.appendChild(colLinks);

        modelList.appendChild(row);
      });
    });
});
