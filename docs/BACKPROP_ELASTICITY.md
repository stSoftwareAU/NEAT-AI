## Elastic back propagation (minimum-change + safe-zone aware)

This project uses a value-solving form of back propagation.

Instead of only using chain-rule gradients everywhere, we often compute a
**target pre-squash value** for a neuron and then adjust **biases and inbound
synapse weights** to move the neuron toward that target.

This works well for many squashes, but it can behave poorly near **saturation**
(or near non-invertible regions) unless we actively avoid “forcing” already
immovable neurons.

### The core problem: saturation and inverse targets

Some squashes have bounded activation ranges:

- **ArcTan**: activation range is \((-\pi/2, +\pi/2)\)
- **TANH**: activation range is \((-1, +1)\)
- **LOGISTIC**: activation range is \((0, 1)\)
- **HARD_TANH / ReLU6 / STEP**: piecewise and/or clipped regions

If a neuron is already saturated and the training target is “at the boundary”,
an inverse (`unSquash`) can imply an _enormous_ change in raw input for only a
tiny change in activation.

That can create large value-space errors which then:

- dominate per-neuron traces in Explorer
- cause discovery focus selection to “chase” meaningless outliers
- slow evolution due to excessive error magnitudes

### The fix: allocate error where it is cheapest to change

When a neuron has many inbound synapses, we treat the neuron’s pre-activation
as:

\[ v = b + \sum_i (w_i \cdot a_i) \]

If we want to change \(v\) by \(\Delta v\), the **minimum overall weight
change** heuristic allocates per-link contribution changes proportional to
\(a_i^2\).

In code, each inbound link gets a score:

- `score_i = (activation_i^2) * safeZoneFactor_i`

Then:

- `share_i = error * score_i / Σ(score)`

This is “elasticity”: links that can move the neuron with smaller weight changes
absorb more of the required value change.

### Safe-zone awareness (don’t push saturated parents further)

Many squashes implement `safeZoneAdjustment(rawInput, error, weight)` which
returns a factor in \([0,1]\). It is designed to:

- **prefer** updates when the neuron is in its strong-gradient region
- **reduce** or **block** updates that push a saturated neuron further into
  saturation
- optionally allow “recovery” when the error would move the neuron back toward
  the centre

Important: `rawInput` here means the neuron’s **pre-squash value**, not a single
synapse contribution.

### Your example (why we prefer changing other parts)

Scenario:

```text
output-0 (error ≈ +0.1)
  ^
  |   ArcTan is already near +π/2 (saturated)
  |
ArcTan(output-0)
  ^
  |
hidden-1
  ^
  |
input-0

Extra path (example):
input-0 ------------------ w:0.5 -----------------> ArcTan(output-0)
```

What we _do not_ want:

```text
Try to “force” ArcTan(output-0) further positive
even though it is already near +π/2.
```

What we _do_ want (elastic backprop):

```text
Prefer adjusting the inbound weights/biases that can change v cheaply,
and de-emphasise parents that are saturated (safeZoneFactor ≈ 0).
```

So, if `ArcTan(output-0)` is saturated, its safe-zone factor reduces the share
of the error that we try to push “through” it. That shifts the learning pressure
toward other inbound synapses or upstream neurons that are _not_ saturated.

### About LeakyReLU (negative region)

LeakyReLU does **not** have a hard saturation like ArcTan/TANH/LOGISTIC. Its
slope is:

- `1` for \(x \ge 0\)
- `α` for \(x < 0\) (eg. 0.01)

So it can still learn in the negative region, but it’s “stiffer” there.

With elastic backprop + safe-zones:

- we can **prefer** moving toward the positive region when appropriate
- we can **resist** updates that push raw input more negative when it is already
  far negative

### Where to look in code

- Elastic distribution helper: `src/propagate/ElasticDistribution.ts`
- Back propagation application: `src/architecture/Neuron.ts`
  (`Neuron.propagate()`)
- Example saturating squash: `src/methods/activations/types/ArcTan.ts`
