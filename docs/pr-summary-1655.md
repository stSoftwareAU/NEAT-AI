## Summary

Negative result: Investigated alternative generational inertia schedules for
backpropagation training (issue #1655). Benchmarked logarithmic and square-root
growth against the current linear schedule (`base + iteration`) on a
production-sized creature (960 neurons, 18,300 synapses) over 60 iterations.

**Conclusion**: The existing linear schedule with the #1436 effective-generations
cap (`Math.min(rawGenerations, totalActivationCount * 2)`) already prevents
excessive inertia. Alternative schedules provided no meaningful improvement.

Closes #1655.

## Evidence

### Benchmark Results (960 neurons, 18,300 synapses, 20 samples/iteration)

```
Iter | Linear (base+iter)        | Log2 (base+log2)          | Sqrt (base+sqrt)
     | Error       (generations) | Error       (generations) | Error       (generations)
-----|---------------------------|---------------------------|---------------------------
   0 | 5.44892311  (g=  6)      | 5.44892311  (g=  6)      | 5.44892311  (g=  6)
   5 | 5.44186185  (g= 11)      | 5.44178016  (g=  8)      | 5.44176358  (g=  8)
  10 | 5.43360599  (g= 16)      | 5.43330667  (g=  9)      | 5.43327222  (g=  9)
  20 | 5.41949317  (g= 26)      | 5.41900616  (g= 10)      | 5.41897523  (g= 10)
  30 | 5.41068751  (g= 36)      | 5.41036587  (g= 10)      | 5.41034206  (g= 11)
  40 | 5.40563189  (g= 46)      | 5.40561345  (g= 11)      | 5.40559313  (g= 12)
  50 | 5.40316367  (g= 56)      | 5.40368648  (g= 11)      | 5.40366809  (g= 13)
  59 | 5.40352185  (g= 65)      | 5.40459145  (g= 11)      | 5.40456718  (g= 13)
```

### Summary

| Schedule | Final Error | Improvement |
|----------|-------------|-------------|
| Linear (current) | 5.4035218501 | 0.8507% |
| Logarithmic | 5.4045914507 | 0.8310% |
| Square root | 5.4045671824 | 0.8315% |

### Key Finding

The log/sqrt schedules converge marginally faster at iterations 5-40 but the
linear schedule provides slightly better final convergence. The differences are
negligible (~0.02%). The #1436 `effectiveGenerations` cap already limits inertia
to `2x totalActivationCount`, preventing the linear growth from overwhelming
gradient signals regardless of iteration count.

No code changes warranted. This is a negative result.

## Test Plan

- No code changes, so no new tests needed
- All 4,326 existing tests pass
- Benchmark script added: `bench/GenerationalInertiaSchedule.ts`
