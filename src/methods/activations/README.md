# 🧠 NEAT-AI: Activation Function Backpropagation Strategy

## ✅ Summary

This README captures:

- Which squash functions should use derivative vs unSquash for error propagation
- Priority weights for evolution
- Expert and beginner-friendly notes

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
  error = unSquash(targetActivation) - unSquash(currentActivation)
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

| Activation      | Invertible | Derivative-Based Error              | Foggy Glasses Error           | Priority | Recommendation | Why?                                                                                             |
| :-------------- | :--------- | :---------------------------------- | :---------------------------- | :------: | :------------- | :----------------------------------------------------------------------------------------------- |
| LeakyReLU       | ✅         | ✅ Fast & stable (slope never 0)    | ✅ Inversion is trivial       |    10    | 🚀 Derivative  | Both methods are valid, but derivative is faster and widely accepted in practice.                |
| GELU            | ✅         | ✅ Smooth, non-zero slope           | ⚠️ Expensive                  |    9     | 🚀 Derivative  | 🐌 UnSquash Slower than most (due to tanh, pow, Newton-Raphson),Derivative (accurate and common) |
| Swish           | ❌         | ✅ Works well                       | ❌ Inversion is undefined     |   8 📈   | 🚀 Derivative  | Widely used in deep learning; derivative is stable and avoids undefined inversion.               |
| TANH            | ✅         | ✅ Smooth & stable across range     | ⚠️ Inversion unstable near ±1 |    8     | 🚀 Derivative  | Fast, stable gradient. Inversion works but becomes numerically unstable near ±1.                 |
| LOGISTIC        | ✅         | ✅ OK, fades at edges               | ⚠️ Expensive to invert        |    7     | 🚀 Derivative  | Fast, smooth gradient; accurate. Inversion possible but slows near 0 or 1.                       |
| Softplus        | ✅         | ✅ Smooth, good slope               | ⚠️ Inversion tricky           |    7     | 🚀 Derivative  | Clean sigmoid-like behaviour; derivative is stable and inversion is avoidable.                   |
| Mish            | ❌         | ✅ Stable and smooth                | ❌ Very hard to invert        |    6     | 🚀 Derivative  | Ideal for deep models; smooth derivative, expensive unSquash.                                    |
| ELU             | ✅         | ✅ Continuous and differentiable    | ⚠️ Inversion edge cases       |    6     | 🚀 Derivative  | Fast and reliable; derivative form is accurate across all input ranges.                          |
| SELU            | ✅         | ✅ Good for normalized flows        | ⚠️ Tricky to invert           |    5     | 🚀 Derivative  | Stable and fast for deep self-normalising networks; derivative preferred.                        |
| HARD_TANH       | ❌         | ⚠️ Flat at edges                    | ✅ Can estimate raw           |    5     | 🔍 Foggy       | Use unSquash for edge cases where derivative is 0. Derivative is only helpful in center.         |
| ReLU            | ❌         | ⚠️ 0 slope if x ≤ 0 — stuck zone    | ✅ Fast & clear when active   |   5📉    | 🔍 Foggy       | Derivative fails at zero; unSquash is accurate. Deprioritise in favour of LeakyReLU.             |
| BENT_IDENTITY   | ✅         | ✅ Works well                       | ✅ Easy to invert             |    4     | 🟰 Either      | Both derivative and unSquash are fast and accurate — use derivatives.                            |
| SOFTSIGN        | ✅         | ✅ Derivative good                  | ⚠️ Steep near 0               |    4     | 🚀 Derivative  | Smooth and fast; derivative is stable and avoids unSquash edge cases.                            |
| ArcTan          | ✅         | ✅ Stable                           | ✅ Invertible                 |    4     | 🟰 Either      | Fast, well-behaved on both squash and inverse. Use derivative unless hint is better.             |
| ReLU6           | ❌         | ⚠️ Dead zones (0 slope outside 0–6) | ✅ UnSquash works             |    4     | 🔍 Foggy       | Derivative fails at edges; unSquash gives stable, fast error. Prefer foggy in dead zones.        |
| SINE            | ✅         | ⚠️ Oscillating slope                | ✅ Works                      |    3     | 🔍 Foggy       | Derivative unstable near ±π/2; unSquash gives accurate fallback. Use foggy when slope is flat.   |
| ABSOLUTE        | ❌         | ❌ Derivative undefined at 0        | ✅ Can guess raw              |    2     | 🔍 Foggy       | No sign in output → unSquash is safe fallback; use foggy only.                                   |
| Cosine          | ❌         | ⚠️ Oscillates                       | ✅ Works                      |    2     | 🔍 Foggy       | Derivative fades at ±π/2; unSquash works reliably. Use foggy fallback.                           |
| Cube            | ✅         | ✅ Easy                             | ✅ Exact                      |    2     | 🟰 Either      | Fully invertible and simple; derivative and foggy both reliable. Use either.                     |
| Exponential     | ✅         | ✅ Derivative stable                | ⚠️ Inversion dangerous        |    2     | 🚀 Derivative  | (fast + accurate)                                                                                |
| GAUSSIAN        | ✅         | ⚠️ Derivative fades                 | ✅ Inversion tough            |    2     | 🔍 Foggy       | (fast + accurate)                                                                                |
| ISRU            | ✅         | ✅ Good with normalization          | ⚠️ Expensive                  |    2     | 🚀 Derivative  | (fast + accurate)                                                                                |
| LogSigmoid      | ✅         | ✅ Stable                           | ⚠️ Inversion hard             |    2     | 🚀 Derivative  | (fast + accurate)                                                                                |
| ABSOLUTE        | ❌         | ❌ Derivative undefined at 0        | ✅ Symmetric, invertible-ish  |    2     | 🔍 Foggy       | Derivative is undefined at 0; unSquash is fast and gives useful symmetric error signal.          |
| STEP            | ❌         | ❌ Derivative is 0                  | ⚠️ Foggy guesstimate          |   ⬇ 0    | 🟰 Either      | ❌ Derivative is zero everywhere (no learning), foggy also unreliable                            |
| TAN             | ✅         | ⚠️ Wild slopes                      | ✅ Works in range             |    2     | 🔍 Foggy       | (fast + accurate)                                                                                |
| Complement      | ❌         | ✅ Simple inverse                   | ✅ Works                      |   ⬇ 0    | 🟰 Either      | ❌ Not an activation function in any known framework                                             |
| StdInverse      | ✅         | ✅ Fine                             | ✅ Cheap                      |    1     | 🟰 Either      | (balanced), low priority Custom logic                                                            |
| IDENTITY        | ✅         | ✅ Derivative = 1                   | ✅ Exact                      |    1     | 🟰 Either      | (balanced)                                                                                       |
| IF              | ❌         | ❌ Not differentiable               | ✅ Works if stable            |   ⬇ 0    | 🔍 Foggy       | ❌ Hard conditional logic — breaks continuity and gradient assumptions                           |
| HYPOT           | ❌         | ⚠️ Conditional                      | ⚠️ Inversion unknown          |   ⬇ 0    | 🟰 Either      | ❌ Not suitable as squash; expensive and odd behaviour                                           |
| HYPOTv2         | ❌         | ⚠️ Same                             | ⚠️ Same                       |   ⬇ 0    | 🟰 Either      | ❌ Not suitable as squash; expensive and odd behaviour                                           |
| MAXIMUM         | ❌         | ❌ Flat in some regions             | ⚠️ Needs guessing             |   ⬇ 0    | 🟰 Either      | ❌ Flat plateaus, no gradient flow                                                               |
| MINIMUM         | ❌         | ❌ Flat                             | ⚠️ Needs guessing             |   ⬇ 0    | 🟰 Either      | ❌ Flat plateaus, no gradient flow                                                               |
| BIPOLAR         | ❌         | ❌ Often flat                       | ⚠️ Roughly invertible         |   ⬇ 0    | 🟰 Either      | ❌ Harsh transition, poor learning, rarely used in practice                                      |
| BIPOLAR_SIGMOID | ✅         | ✅ Good                             | ⚠️ Steep                      |    1     | 🚀 Derivative  | (fast + accurate),low priority, Non-standard behaviour                                           |

---

## 📋 Planning

- Migrate `calculateError()` into each squash class.
- Default to Derivative when slope is stable and unSquash is slow.
- Use fast UnSquash only when precise and inexpensive.
- Reduce `ReLU` priority; increase `LeakyReLU`, `GELU`, and `Swish`.
- Benchmark back propagation vs evolution: optimize to reduce training time
  bottlenecks.

### 📌 Notes

- “Priority” controls how often a squash is picked during evolution mutation.
  Still allowed to for mutation or legacy models — just reduce the chance of
  selection.
- “Foggy Glasses” was coined jokingly by the author’s son — but in some cases,
  it's clearer than derivatives!

> This document evolves with your AI — keep it fun, fast, and factual! 🎨🧬
