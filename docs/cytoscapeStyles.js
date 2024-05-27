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
    "width": "mapData(weight, 0, 1, 1, 12)",
    "line-color": "mapData(weight, -1, 1, red, green)",
    "target-arrow-color": "mapData(weight, -1, 1, red, green)",
    "target-arrow-shape": "triangle",
  });
