document.addEventListener("DOMContentLoaded", () => {
  const modelList = document.getElementById("modelList");

  // Load models from index.json
  fetch("models/index.json")
    .then((response) => response.json())
    .then((models) => {
      models.forEach((model) => {
        const li = document.createElement("li");
        li.classList.add("list-group-item");

        const concentricLink = document.createElement("a");
        concentricLink.href = `visualize.html?MODEL=${model}`;
        concentricLink.textContent = `${model} - Concentric`;
        concentricLink.classList.add("btn", "btn-primary", "me-2");

        const barLink = document.createElement("a");
        barLink.href = `bar_chart_visualization.html?MODEL=${model}`;
        barLink.textContent = `${model} - Bar`;
        barLink.classList.add("btn", "btn-secondary");

        li.appendChild(concentricLink);
        li.appendChild(barLink);
        modelList.appendChild(li);
      });
    });
});
