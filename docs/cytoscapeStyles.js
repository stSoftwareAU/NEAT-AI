window.stylesheet = cytoscape.stylesheet()
  .selector(".input-no-synapse-node")
  .css({
    "background-color": "grey",
    "label": "data(label)",
    "text-valign": "center",
    "color": "white",
    "text-outline-width": 2,
    "text-outline-color": "grey",
    "shape": "triangle",
  })
  .selector(".input-node")
  .css({
    "background-color": "blue",
    "label": "data(label)",
    "text-valign": "center",
    "color": "white",
    "text-outline-width": 2,
    "text-outline-color": "blue",
    "shape": "ellipse",
  })
  .selector(".hidden-node")
  .css({
    "background-color": "orange",
    "shape": "rectangle",
  })
  .selector(".output-node")
  .css({
    "background-color": "purple",
    "shape": "hexagon",
  })
  .selector(".constant-node")
  .css({
    "background-color": "SkyBlue",
    "shape": "round-rectangle",
  })
  .selector(".synapse")
  .css({
    "width": (ele) => {
      const weight = ele.data("weight");
      const normalized = Math.log(Math.abs(weight) + 1);
      const squashed = normalized / (normalized + 1);
      const width = squashed * 12 + 1;
      //   console.log(
      //     `Weight: ${weight}, Normalized: ${normalized}, Squashed: ${squashed} => Width: ${width}`,
      //   );
      return width;
    },
    "line-color": (ele) => {
      const weight = ele.data("weight");
      return weight > 0 ? "green" : "red";
    },
    "target-arrow-color": (ele) => {
      const weight = ele.data("weight");
      return weight > 0 ? "green" : "red";
    },
    "target-arrow-shape": "triangle",
  })
  .selector(".highlighted")
  .css({
    "border-width": 2,
    "border-color": "yellow",
  })
  .selector(".faded")
  .css({
    "opacity": 0.1,
  });
