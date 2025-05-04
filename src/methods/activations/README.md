# 🧠 NEAT-AI: Activation Function Backpropagation Strategy

This document is a planning guide for tuning backpropagation in your NEAT-AI system.

---

## 📘 Terminology

- 📐 **Clear Glasses** (*Derivative-based*):  
  Uses the activation's slope to propagate error.  
  ```
  error = (targetActivation - currentActivation) × derivative(currentRawInput)
  ```
  Fast and standard in most neural networks.

- 🔍 **Foggy Glasses** (*UnSquash Delta*):  
  Computes how far the raw input is from the desired activation via inversion:  
  ```
  error = unSquash(target) - unSquash(current)
  ```
  Sometimes more accurate. Name originally coined by my son to explain dad's blurry reasoning 😄 — but in some cases, the foggy method is clearer!

- 🧠 **Invertible**:  
  ✅ = squash function can be reliably inverted (used for Foggy Glasses)  
  ❌ = inversion undefined, unreliable, or non-existent

- 🔁 **Priority**:  
  How often the squash function is chosen during **random mutation** in NEAT evolution.  
  Consider lowering 🧊 expensive or underperforming squashes.

---

## 🧪 Performance Strategy

- Use 🚀 **Derivative** when it's fast + accurate  
- Use 🔍 **Foggy** when inversion is cheap + accurate  
- Avoid 🐌 **expensive unsquash functions** (Newton-Raphson, etc.) unless truly needed  
- Use ⚠️ fallback logic for step-wise or flat squashes with unreliable gradients

---

## 📊 Squash Function Summary

| Activation         | Invertible | Derivative-Based Error         | Foggy Glasses Error     | Original Recommendation   | Priority | Final Recommendation       |
|:----------------|:-------------|:---------------------------------|:-----------------------------|:--------------------------|-----------:|:--------------------------------|
| RELU            | ❌           | ⚠️ Fails (0 slope if x ≤ 0)      | ✅ Works (unSquash possible) | 🧊 Prefer Foggy fallback  |         10 | 🔍 Foggy (fast + accurate)      |
| LeakyReLU       | ❌           | ✅ Works (non-zero slope)        | ✅ Works                     | 🟰 Either is fine         |          9 | 🟰 Either (balanced)            |
| GELU            | ✅           | ✅ Smooth, non-zero slope        | ⚠️ Expensive                 | ✅ Prefer Derivative      |          9 | 🚀 Derivative (fast + accurate) |
| Swish           | ❌           | ✅ Works well                    | ❌ Inversion is undefined    | ✅ Derivative only        |          8 | 🚀 Derivative (fast + accurate) |
| TANH            | ✅           | ✅ Good except at ±1             | ⚠️ Unstable near ±1          | 🟰 Hybrid                 |          8 | 🚀 Derivative (fast + accurate) |
| LOGISTIC        | ✅           | ✅ OK, fades at edges            | ⚠️ Expensive to invert       | ✅ Prefer Derivative      |          7 | 🚀 Derivative (fast + accurate) |
| Softplus        | ✅           | ✅ Smooth, good slope            | ⚠️ Inversion tricky          | ✅ Prefer Derivative      |          7 | 🚀 Derivative (fast + accurate) |
| Mish            | ❌           | ✅ Stable and smooth             | ❌ Very hard to invert       | ✅ Derivative only        |          6 | 🚀 Derivative (fast + accurate) |
| ELU             | ✅           | ✅ Continuous and differentiable | ⚠️ Inversion edge cases      | 🟰 Prefer Derivative      |          6 | 🚀 Derivative (fast + accurate) |
| SELU            | ✅           | ✅ Good for normalized flows     | ⚠️ Tricky to invert          | ✅ Prefer Derivative      |          5 | 🚀 Derivative (fast + accurate) |
| HARD_TANH       | ❌           | ⚠️ Flat at edges                 | ✅ Can estimate raw          | 🟰 Hybrid                 |          5 | 🔍 Foggy (fast + accurate)      |
| BENT_IDENTITY   | ✅           | ✅ Works well                    | ✅ Easy to invert            | 🟰 Either                 |          4 | 🟰 Either (balanced)            |
| SOFTSIGN        | ✅           | ✅ Derivative good               | ⚠️ Steep near 0              | 🟰 Either                 |          4 | 🚀 Derivative (fast + accurate) |
| ArcTan          | ✅           | ✅ Stable                        | ✅ Invertible                | 🟰 Either                 |          4 | 🟰 Either (balanced)            |
| ReLU6           | ❌           | ⚠️ Dead zones                    | ✅ UnSquash possible         | 🧊 Prefer Foggy fallback  |          4 | 🔍 Foggy (fast + accurate)      |
| SINE            | ✅           | ⚠️ Oscillating slope             | ✅ Works                     | ⚠️ Case-by-case           |          3 | 🔍 Foggy (fast + accurate)      |
| ABSOLUTE        | ❌           | ❌ Derivative undefined at 0     | ✅ Can guess raw             | 🧊 Foggy if bounded       |          2 | 🔍 Foggy (fast + accurate)      |
| Cosine          | ✅           | ⚠️ Oscillates                    | ✅ Works                     | ⚠️ Depends                |          2 | 🔍 Foggy (fast + accurate)      |
| Cube            | ✅           | ✅ Easy                          | ✅ Exact                     | 🟰 Either                 |          2 | 🟰 Either (balanced)            |
| Exponential     | ✅           | ✅ Derivative stable             | ⚠️ Inversion dangerous       | ✅ Prefer Derivative      |          2 | 🚀 Derivative (fast + accurate) |
| GAUSSIAN        | ✅           | ⚠️ Derivative fades              | ✅ Inversion tough           | 🧊 Prefer Foggy fallback  |          2 | 🔍 Foggy (fast + accurate)      |
| ISRU            | ✅           | ✅ Good with normalization       | ⚠️ Expensive                 | 🟰 Derivative preferred   |          2 | 🚀 Derivative (fast + accurate) |
| LogSigmoid      | ✅           | ✅ Stable                        | ⚠️ Inversion hard            | ✅ Prefer Derivative      |          2 | 🚀 Derivative (fast + accurate) |
| STEP            | ❌           | ❌ Derivative is 0               | ⚠️ Foggy guesstimate         | 🧊 Use Foggy only         |          2 | 🟰 Either                       |
| TAN             | ✅           | ⚠️ Wild slopes                   | ✅ Works in range            | ⚠️ Derivative for safety  |          2 | 🔍 Foggy (fast + accurate)      |
| COMPLEMENT      | ❌           | ✅ Simple inverse                | ✅ Works                     | 🟰 Either                 |          1 | 🟰 Either (balanced)            |
| StdInverse      | ✅           | ✅ Fine                          | ✅ Cheap                     | 🟰 Either                 |          1 | 🟰 Either (balanced)            |
| IDENTITY        | ✅           | ✅ Deriv = 1                     | ✅ Exact                     | 🟰 Either                 |          1 | 🟰 Either (balanced)            |
| IF              | ❌           | ❌ Not differentiable            | ✅ Works if stable           | 🧊 Foggy only             |          1 | 🔍 Foggy (fast + accurate)      |
| HYPOT           | ❌           | ⚠️ Conditional                   | ⚠️ Inversion unknown         | 🧊 Needs testing          |          1 | 🟰 Either                       |
| HYPOTv2         | ❌           | ⚠️ Same                          | ⚠️ Same                      | 🧊 Needs testing          |          1 | 🟰 Either                       |
| MAXIMUM         | ❌           | ❌ Flat in some regions          | ⚠️ Needs guessing            | 🧊 Foggy if possible      |          1 | 🟰 Either                       |
| MINIMUM         | ❌           | ❌ Flat                          | ⚠️ Needs guessing            | 🧊 Foggy if possible      |          1 | 🟰 Either                       |
| BIPOLAR         | ❌           | ❌ Often flat                    | ⚠️ Roughly invertible        | 🧊 Foggy only             |          1 | 🟰 Either                       |
| BIPOLAR_SIGMOID | ✅           | ✅ Good                          | ⚠️ Steep                     | 🟰 Either                 |          1 | 🚀 Derivative (fast + accurate) |

---

## ✅ Planning Notes

- Migrate `calculateError()` into each squash class.
- Default to Derivative when slope is stable and unSquash is slow.
- Use fast UnSquash only when precise and inexpensive.
- Reduce `RELU` priority; increase `LeakyReLU`, `GELU`, and `Swish`.
- Benchmark back propagation vs evolution: optimize to reduce training time bottlenecks.

> Continue evolving this file as your activations evolve! 🧬

