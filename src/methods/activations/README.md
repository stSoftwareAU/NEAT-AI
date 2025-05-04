# 🧠 NEAT-AI: Activation Function Backpropagation Strategy

This document is a planning guide for tuning backpropagation.

---

## 📘 Terminology

- 📐 **Clear Glasses** (_Derivative-based_):\
  Uses the activation's slope to propagate error.
  ```
  error = (targetActivation - currentActivation) × derivative(currentRawInput)
  ```
  Fast and standard in most neural networks.

- 🔍 **Foggy Glasses** (_UnSquash Delta_):\
  Computes how far the raw input is from the desired activation via inversion:
  ```
  error = unSquash(target) - unSquash(current)
  ```
  Sometimes more accurate. Name originally coined by my son to explain dad's
  blurry reasoning 😄 — but in some cases, the foggy method is clearer!

- 🧠 **Invertible**:\
  ✅ = squash function can be reliably inverted (used for Foggy Glasses)\
  ❌ = inversion undefined, unreliable, or non-existent

- 🔁 **Priority**:\
  How often the squash function is chosen during **random mutation** in NEAT
  evolution.\
  Consider lowering 🧊 expensive or underperforming squashes.

---

## 🧪 Performance Strategy

- Use 🚀 **Derivative** when it's fast + accurate
- Use 🔍 **Foggy** when inversion is cheap + accurate
- Avoid 🐌 **expensive unsquash functions** (Newton-Raphson, etc.) unless truly
  needed
- Use ⚠️ fallback logic for step-wise or flat squashes with unreliable gradients

---

## 📊 Squash Function Summary

| Activation      | Invertible | Derivative-Based Error           | Foggy Glasses Error          | Priority | Recommendation                  |
| :-------------- | :--------- | :------------------------------- | :--------------------------- | -------: | :------------------------------ |
| RELU            | ❌         | ⚠️ Fails (0 slope if x ≤ 0)      | ✅ Works (unSquash possible) |       10 | 🔍 Foggy (fast + accurate)      |
| LeakyReLU       | ❌         | ✅ Works (non-zero slope)        | ✅ Works                     |        9 | 🟰 Either (balanced)            |
| GELU            | ✅         | ✅ Smooth, non-zero slope        | ⚠️ Expensive                 |        9 | 🚀 Derivative (fast + accurate) |
| Swish           | ❌         | ✅ Works well                    | ❌ Inversion is undefined    |        8 | 🚀 Derivative (fast + accurate) |
| TANH            | ✅         | ✅ Good except at ±1             | ⚠️ Unstable near ±1          |        8 | 🚀 Derivative (fast + accurate) |
| LOGISTIC        | ✅         | ✅ OK, fades at edges            | ⚠️ Expensive to invert       |        7 | 🚀 Derivative (fast + accurate) |
| Softplus        | ✅         | ✅ Smooth, good slope            | ⚠️ Inversion tricky          |        7 | 🚀 Derivative (fast + accurate) |
| Mish            | ❌         | ✅ Stable and smooth             | ❌ Very hard to invert       |        6 | 🚀 Derivative (fast + accurate) |
| ELU             | ✅         | ✅ Continuous and differentiable | ⚠️ Inversion edge cases      |        6 | 🚀 Derivative (fast + accurate) |
| SELU            | ✅         | ✅ Good for normalized flows     | ⚠️ Tricky to invert          |        5 | 🚀 Derivative (fast + accurate) |
| HARD_TANH       | ❌         | ⚠️ Flat at edges                 | ✅ Can estimate raw          |        5 | 🔍 Foggy (fast + accurate)      |
| BENT_IDENTITY   | ✅         | ✅ Works well                    | ✅ Easy to invert            |        4 | 🟰 Either (balanced)            |
| SOFTSIGN        | ✅         | ✅ Derivative good               | ⚠️ Steep near 0              |        4 | 🚀 Derivative (fast + accurate) |
| ArcTan          | ✅         | ✅ Stable                        | ✅ Invertible                |        4 | 🟰 Either (balanced)            |
| ReLU6           | ❌         | ⚠️ Dead zones                    | ✅ UnSquash possible         |        4 | 🔍 Foggy (fast + accurate)      |
| SINE            | ✅         | ⚠️ Oscillating slope             | ✅ Works                     |        3 | 🔍 Foggy (fast + accurate)      |
| ABSOLUTE        | ❌         | ❌ Derivative undefined at 0     | ✅ Can guess raw             |        2 | 🔍 Foggy (fast + accurate)      |
| Cosine          | ✅         | ⚠️ Oscillates                    | ✅ Works                     |        2 | 🔍 Foggy (fast + accurate)      |
| Cube            | ✅         | ✅ Easy                          | ✅ Exact                     |        2 | 🟰 Either (balanced)            |
| Exponential     | ✅         | ✅ Derivative stable             | ⚠️ Inversion dangerous       |        2 | 🚀 Derivative (fast + accurate) |
| GAUSSIAN        | ✅         | ⚠️ Derivative fades              | ✅ Inversion tough           |        2 | 🔍 Foggy (fast + accurate)      |
| ISRU            | ✅         | ✅ Good with normalization       | ⚠️ Expensive                 |        2 | 🚀 Derivative (fast + accurate) |
| LogSigmoid      | ✅         | ✅ Stable                        | ⚠️ Inversion hard            |        2 | 🚀 Derivative (fast + accurate) |
| STEP            | ❌         | ❌ Derivative is 0               | ⚠️ Foggy guesstimate         |        2 | 🟰 Either                       |
| TAN             | ✅         | ⚠️ Wild slopes                   | ✅ Works in range            |        2 | 🔍 Foggy (fast + accurate)      |
| COMPLEMENT      | ❌         | ✅ Simple inverse                | ✅ Works                     |        1 | 🟰 Either (balanced)            |
| StdInverse      | ✅         | ✅ Fine                          | ✅ Cheap                     |        1 | 🟰 Either (balanced)            |
| IDENTITY        | ✅         | ✅ Deriv = 1                     | ✅ Exact                     |        1 | 🟰 Either (balanced)            |
| IF              | ❌         | ❌ Not differentiable            | ✅ Works if stable           |        1 | 🔍 Foggy (fast + accurate)      |
| HYPOT           | ❌         | ⚠️ Conditional                   | ⚠️ Inversion unknown         |        1 | 🟰 Either                       |
| HYPOTv2         | ❌         | ⚠️ Same                          | ⚠️ Same                      |        1 | 🟰 Either                       |
| MAXIMUM         | ❌         | ❌ Flat in some regions          | ⚠️ Needs guessing            |        1 | 🟰 Either                       |
| MINIMUM         | ❌         | ❌ Flat                          | ⚠️ Needs guessing            |        1 | 🟰 Either                       |
| BIPOLAR         | ❌         | ❌ Often flat                    | ⚠️ Roughly invertible        |        1 | 🟰 Either                       |
| BIPOLAR_SIGMOID | ✅         | ✅ Good                          | ⚠️ Steep                     |        1 | 🚀 Derivative (fast + accurate) |

---

## ✅ Planning Notes

- Migrate `calculateError()` into each squash class.
- Default to Derivative when slope is stable and unSquash is slow.
- Use fast UnSquash only when precise and inexpensive.
- Reduce `RELU` priority; increase `LeakyReLU`, `GELU`, and `Swish`.
- Benchmark back propagation vs evolution: optimize to reduce training time
  bottlenecks.
