# 🧠 NEAT-AI: Activation Function Backpropagation Strategy

## ✅ Summary

This README captures:

- Which squash functions should use derivative vs unSquash for error propagation
- Priority weights for evolution
- Expert and beginner-friendly notes

---

## 📘 Terminology

- 📐 **Clear Glasses** (_Derivative-based_):\
  Uses the activation's slope to back out the raw input error.\
  Appropriate when you know the **output activation** and want to estimate how
  much to change the raw input.

  ```
  error = (currentActivation - targetActivation) / derivative(currentRawInput)
  ```
  Fast and standard in most neural networks.\
  ⚠️ Be careful: multiplying by the derivative is incorrect when computing the
  raw input delta.

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

| Activation      | Invertible | Derivative-Based Error              | Foggy Glasses Error            | Priority | Recommendation | Why?                                                                                             | 🐇🦥 |
| :-------------- | :--------- | :---------------------------------- | :----------------------------- | :------: | :------------- | :----------------------------------------------------------------------------------------------- | :--- |
| LeakyReLU       | ✅         | ❌ Overshoots easily if slope small | ✅ Inversion is trivial        |    10    | 🎯 UnSquash    | Always use unSquash — it's fast, safe, and avoids giant updates from small slopes.               | 🟩   |
| GELU            | ❌         | ✅ Smooth, fast, always defined     | 🐌 UnSquash Slower than most   |    9     | 🚀 Derivative  | Derivative is smooth and stable; no inverse fallback possible. Always use derivative.            | 🟩   |
| Swish           | ❌         | ✅ Works well                       | ❌ Inversion is undefined      |   8 📈   | 🚀 Derivative  | Widely used in deep learning; derivative is stable and avoids undefined inversion.               | 🟩   |
| TANH            | ✅         | ✅ Smooth & stable across range     | ⚠️ Inversion unstable near ±1  |    8     | 🚀 Derivative  | Fast, stable gradient. Inversion works but becomes numerically unstable near ±1.                 | 🟩   |
| LOGISTIC        | ✅         | ⚠️ Fades in tails (0,1)             | ✅ Exact, cheap fallback       |    7     | 🟰 Either      | Use derivative near center; fall back to unSquash when slope is too small.                       | 🟩   |
| Softplus        | ✅         | ✅ Smooth, good slope               | ⚠️ Inversion tricky            |    7     | 🚀 Derivative  | Clean sigmoid-like behaviour; derivative is stable and inversion is avoidable.                   | 🟩   |
| Mish            | ❌         | ✅ Stable and smooth                | ❌ Very hard to invert         |    6     | 🚀 Derivative  | Ideal for deep models; smooth derivative, expensive unSquash.                                    | 🟩   |
| ELU             | ✅         | ✅ Stable, smooth, and fast         | ❌ UnSquash unnecessary        |    6     | 🚀 Derivative  | Always use derivative — slope never zero, fallback not needed.                                   | 🟩   |
| SELU            | ✅         | ✅ Good for normalized flows        | ⚠️ Tricky to invert            |    5     | 🚀 Derivative  | Stable and fast for deep self-normalising networks; derivative preferred.                        | 🟩   |
| HARD_TANH       | ❌         | ⚠️ Dead zones at ±1                 | ❌ Not invertible              |    5     | 🟰 Either      | Use derivative in center; fallback to raw difference outside range.                              | 🟩   |
| ReLU            | ❌         | ⚠️ 0 slope if x ≤ 0 — stuck zone    | ✅ Fast & clear when active    |   5📉    | 🔍 Foggy       | Derivative fails at zero; unSquash is accurate. Deprioritise in favour of LeakyReLU.             | 🟩   |
| BENT_IDENTITY   | ✅         | ✅ Always smooth and > 0            | ✅ Invertible                  |    4     | 🚀 Derivative  | Fully differentiable and always sloped — use derivative only. No fallback needed.                | 🟩   |
| SOFTSIGN        | ✅         | ✅ Derivative good                  | ⚠️ Steep near 0                |    4     | 🚀 Derivative  | Smooth and fast; derivative is stable and avoids unSquash edge cases.                            | 🟩   |
| ArcTan          | ✅         | ✅ Stable, always nonzero slope     | ✅ Invertible                  |    4     | 🚀 Derivative  | Smooth, no dead zones — always use derivative. No fallback needed.                               | 🟩   |
| ReLU6           | ❌         | ⚠️ Dead zones (0 slope outside 0–6) | ✅ UnSquash works              |    4     | 🔍 Foggy       | Derivative fails at edges; unSquash gives stable, fast error. Prefer foggy in dead zones.        | 🟩   |
| SINE            | ✅         | ⚠️ Oscillating slope                | ✅ Works                       |    3     | 🔍 Foggy       | Derivative unstable near ±π/2; unSquash gives accurate fallback. Use foggy when slope is flat.   | 🟩   |
| ABSOLUTE        | ❌         | ❌ Derivative undefined at 0        | ✅ Choose closest raw input    |    2     | 🔍 Foggy       | Output loses sign — estimate closest valid raw input (`±targetActivation`). Derivative unusable. | 🟩   |
| Cosine          | ✅         | ⚠️ Fails near ±π, use fallback      | ✅ Fast acos fallback          |    2     | 🟰 Either      | Use derivative when slope ≠ 0, fallback to unSquash elsewhere.                                   | 🟩   |
| Cube            | ✅         | ✅ Fast except near zero slope      | ✅ Cheap unSquash fallback     |    2     | 🟰 Either      | Use derivative for most x; fall back to unSquash when x ≈ 0.                                     | 🟩   |
| Exponential     | ✅         | ⚠️ Grows/shrinks fast, capped slope | ✅ Fast ln fallback            |    2     | 🟰 Either      | Use derivative in mid-range; fallback to unSquash if slope too extreme.                          | 🟩   |
| GAUSSIAN        | ✅         | ⚠️ Zero slope near center and tails | ✅ Fallback picks closest root |    2     | 🟰 Either      | Use derivative when slope present; fallback to ±sqrt(-ln(y)) nearest current value.              | 🟩   |
| ISRU            | ✅         | ✅ Smooth, fades in tails           | ✅ Fast inverse fallback       |    2     | 🟰 Either      | Use derivative when stable; fallback to unSquash if slope near zero.                             | 🟩   |
| LogSigmoid      | ✅         | ⚠️ Derivative fades for large x     | ✅ Safe fallback for y < 0     |    2     | 🟰 Either      | Use derivative in normal range; fallback to unSquash when slope is too small.                    | 🟩   |
| STEP            | ❌         | ❌ Derivative is 0                  | ⚠️ Foggy guesstimate           |   ⬇ 0    | 🔍 Foggy       | ❌ Derivative is zero everywhere (no learning), foggy works well with a hint.                    | 🟩   |
| TAN             | ✅         | ⚠️ Wild slopes                      | ✅ Works in range              |    2     | 🔍 Foggy       | (fast + accurate)                                                                                | 🟩   |
| Complement      | ✅         | ✅ Constant slope (−1), fast        | ✅ Invertible                  |   ⬇ 0    | 🚀 Derivative  | Linear, exact, and fast. Use derivative always.                                                  | 🟩   |
| StdInverse      | ✅         | ✅ Fine                             | ✅ Cheap                       |    1     | 🟰 Either      | (balanced), low priority Custom logic                                                            | 🟩   |
| IDENTITY        | ✅         | ✅ Derivative = 1                   | ✅ Exact                       |    1     | 🟰 Either      | (balanced)                                                                                       | 🟩   |
| IF              | ❌         | ❌ Not differentiable               | ✅ Works if stable             |   ⬇ 0    | 🔍 Foggy       | ❌ Hard conditional logic — breaks continuity and gradient assumptions                           | ❓   |
| HYPOT           | ❌         | ⚠️ Conditional                      | ⚠️ Inversion unknown           |   ⬇ 0    | 🟰 Either      | ❌ Not suitable as squash; expensive and odd behaviour                                           | ❓   |
| HYPOTv2         | ❌         | ⚠️ Same                             | ⚠️ Same                        |   ⬇ 0    | 🟰 Either      | ❌ Not suitable as squash; expensive and odd behaviour                                           | ❓   |
| MAXIMUM         | ❌         | ❌ Flat in some regions             | ⚠️ Needs guessing              |   ⬇ 0    | 🟰 Either      | ❌ Flat plateaus, no gradient flow                                                               | ❓   |
| MINIMUM         | ❌         | ❌ Flat                             | ⚠️ Needs guessing              |   ⬇ 0    | 🟰 Either      | ❌ Flat plateaus, no gradient flow                                                               | ❓   |
| BIPOLAR         | ❌         | ❌ Often flat                       | ⚠️ Roughly invertible          |   ⬇ 0    | 🟰 Either      | ❌ Harsh transition, poor learning, rarely used in practice                                      | 🟩   |
| BIPOLAR_SIGMOID | ✅         | ✅ Stable in center, fades at edges | ✅ Invertible                  |    1     | 🟰 Either      | Use derivative for mid-range; fallback to unSquash + clamp to avoid huge errors near ±1.         | 🟩   |

---

## 📋 Planning

- Migrate `calculateError()` into each squash class.
- Default to Derivative when slope is stable and unSquash is slow.
- Use fast UnSquash only when precise and inexpensive.
- Reduce `ReLU` priority; increase `LeakyReLU`, `GELU`, and `Swish`.
- Benchmark back propagation vs evolution: optimize to reduce training time
  bottlenecks.

### 🏁 Legend for Performance

- 🟩 Derivative significantly faster
- 🟨 Similar performance
- 🟥 UnSquash faster than derivative (unexpected)
- ❓ Not benchmarked

### 📌 Notes

- “Priority” controls how often a squash is picked during evolution mutation.
  Still allowed to for mutation or legacy models — just reduce the chance of
  selection.
- “Foggy Glasses” was coined jokingly by the author’s son — but in some cases,
  it's clearer than derivatives!

> This document evolves with your AI — keep it fun, fast, and factual! 🎨🧬
