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
  })
  // Add styles for each squash function here
  // Squash function styles
  .selector(".ABSOLUTE")
  .css({ "background-color": "#f4a261" })
  .selector(".BENT_IDENTITY")
  .css({ "background-color": "#e76f51" })
  .selector(".BIPOLAR")
  .css({ "background-color": "#e9c46a" })
  .selector(".BIPOLAR_SIGMOID")
  .css({ "background-color": "#2a9d8f" })
  .selector(".CLIPPED")
  .css({ "background-color": "#264653" })
  .selector(".Cosine")
  .css({ "background-color": "#6d6875" })
  .selector(".ELU")
  .css({ "background-color": "#4a4e69" })
  .selector(".Exponential")
  .css({ "background-color": "#d4a373" })
  .selector(".GAUSSIAN")
  .css({ "background-color": "#e5989b" })
  .selector(".HARD_TANH")
  .css({ "background-color": "#b5838d" })
  .selector(".IDENTITY")
  .css({ "background-color": "#a5a58d" })
  .selector(".COMPLEMENT")
  .css({ "background-color": "#6b705c" })
  .selector(".LOGISTIC")
  .css({ "background-color": "#3a0ca3" })
  .selector(".LeakyReLU")
  .css({ "background-color": "#4361ee" })
  .selector(".LogSigmoid")
  .css({ "background-color": "#4cc9f0" })
  .selector(".Mish")
  .css({ "background-color": "#ffbe0b" })
  .selector(".RELU")
  .css({ "background-color": "#fb5607" })
  .selector(".SELU")
  .css({ "background-color": "#ff006e" })
  .selector(".SINUSOID")
  .css({ "background-color": "#8338ec" })
  .selector(".SOFTSIGN")
  .css({ "background-color": "#3a86ff" })
  .selector(".STEP")
  .css({ "background-color": "#06d6a0" })
  .selector(".Softplus")
  .css({ "background-color": "#118ab2" })
  .selector(".StdInverse")
  .css({ "background-color": "#073b4c" })
  .selector(".Swish")
  .css({ "background-color": "#ffd166" })
  .selector(".TANH")
  .css({ "background-color": "#06d6a0" })
  .selector(".ReLU6")
  .css({ "background-color": "#ef476f" })
  .selector(".GELU")
  .css({ "background-color": "#118ab2" })
  .selector(".HYPOT")
  .css({ "background-color": "#1d3557" })
  .selector(".IF")
  .css({ "background-color": "#457b9d" })
  .selector(".MAXIMUM")
  .css({ "background-color": "#a8dadc" })
  .selector(".MEAN")
  .css({ "background-color": "#f1faee" })
  .selector(".MINIMUM")
  .css({ "background-color": "#e63946" });
