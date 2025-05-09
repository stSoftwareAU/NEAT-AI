import { Activations } from "../src/methods/activations/Activations.ts";
import type { UnSquashInterface } from "../src/methods/activations/UnSquashInterface.ts";

const TEST_INPUTS = [0, 0.5, -0.5, 5, -5, 1e-8, -1e-8];

Activations.NAMES.forEach((name) => {
  const activation = Activations.find(name);

  const unSquashActivation = activation as UnSquashInterface;

  if (unSquashActivation.calculateError) {
    const limitedArgs: { current: number; target: number; value: number }[] =
      TEST_INPUTS.map((input) => {
        const current = Math.max(
          Math.min(input, unSquashActivation.range.high),
          unSquashActivation.range.low,
        );
        let target = current + 0.1;
        if (target >= unSquashActivation.range.high) {
          target = current + -0.1;
        }
        const value = unSquashActivation.unSquash!(current, target);
        return {
          current,
          target: target,
          value: value,
        };
      });
    Deno.bench(name, () => {
      for (const args of limitedArgs) {
        unSquashActivation.calculateError!(
          args.current,
          args.target,
          args.value,
        );
      }
    });
  }
});

/**
 *  9th may 2025.
 *  benchmark         time/iter (avg)        iter/s      (min … max)           p75      p99     p995
    ----------------- ----------------------------- --------------------- --------------------------
    ABSOLUTE                  43.8 ns    22,850,000 ( 28.2 ns …   2.1 µs)  28.4 ns 368.3 ns 660.6 ns
    ArcTan                   172.2 ns     5,807,000 (119.8 ns …   2.2 µs) 123.5 ns   1.1 µs   1.8 µs
    BENT_IDENTITY            227.7 ns     4,391,000 (129.7 ns …   3.1 µs) 136.6 ns   2.0 µs   2.7 µs
    BIPOLAR                  189.8 ns     5,267,000 (125.8 ns …   1.6 µs) 130.9 ns   1.4 µs   1.5 µs
    BIPOLAR_SIGMOID          381.4 ns     2,622,000 (242.2 ns …   2.1 µs) 256.1 ns   1.6 µs   2.1 µs
    COMPLEMENT               161.4 ns     6,194,000 ( 98.0 ns …   2.0 µs) 104.0 ns   1.6 µs   1.9 µs
    Cosine                     5.3 µs       188,900 (  2.8 µs …  13.3 ms)   3.0 µs   8.6 µs  12.8 µs
    Cube                     367.2 ns     2,723,000 (230.8 ns …   3.8 µs) 236.4 ns   1.6 µs   3.8 µs
    ELU                      345.9 ns     2,891,000 (224.5 ns …   2.2 µs) 229.2 ns   2.1 µs   2.2 µs
    Exponential              386.2 ns     2,589,000 (227.1 ns …   4.3 µs) 235.1 ns   3.0 µs   4.3 µs
    GAUSSIAN                 624.9 ns     1,600,000 (393.1 ns …   5.4 µs) 451.3 ns   5.4 µs   5.4 µs
    GELU                       1.1 µs       888,900 (748.0 ns …   3.5 µs)   1.1 µs   3.5 µs   3.5 µs
    HARD_TANH                174.9 ns     5,718,000 (113.5 ns …   3.0 µs) 118.3 ns   1.4 µs   1.5 µs
    IDENTITY                 154.6 ns     6,468,000 ( 99.9 ns …   1.6 µs) 103.5 ns 933.2 ns   1.3 µs
    ISRU                     242.8 ns     4,119,000 (147.9 ns …   3.3 µs) 153.1 ns   2.4 µs   2.4 µs
    LeakyReLU                233.6 ns     4,282,000 (129.3 ns …   2.2 µs) 161.5 ns   1.7 µs   1.9 µs
    LOGISTIC                 729.1 ns     1,372,000 (470.0 ns …   2.7 µs) 833.9 ns   2.7 µs   2.7 µs
    LogSigmoid               698.0 ns     1,433,000 (399.3 ns …   3.3 µs) 790.9 ns   3.3 µs   3.3 µs
    Mish                     744.3 ns     1,343,000 (478.8 ns …   2.6 µs) 744.9 ns   2.6 µs   2.6 µs
    ReLU                     194.5 ns     5,142,000 (117.0 ns …   2.5 µs) 128.1 ns   1.4 µs   1.6 µs
    ReLU6                    222.1 ns     4,502,000 (141.2 ns …   2.3 µs) 145.3 ns   1.8 µs   1.9 µs
    SELU                     344.9 ns     2,900,000 (235.5 ns …   2.5 µs) 239.6 ns   1.6 µs   2.5 µs
    SINE                       4.4 µs       228,400 (  2.7 µs …  10.1 ms)   2.9 µs   8.3 µs  11.2 µs
    SOFTSIGN                 201.1 ns     4,972,000 (136.8 ns …   1.8 µs) 145.6 ns   1.7 µs   1.7 µs
    Softplus                 614.5 ns     1,627,000 (385.9 ns …   2.4 µs) 685.0 ns   2.4 µs   2.4 µs
    StdInverse               210.8 ns     4,745,000 (136.4 ns …   1.8 µs) 142.5 ns   1.7 µs   1.7 µs
    STEP                     225.6 ns     4,432,000 (135.7 ns …   1.7 µs) 174.6 ns   1.4 µs   1.5 µs
    Swish                     10.3 µs -> 196.8 ns
    TAN                      421.5 ns     2,373,000 (320.9 ns …   1.8 µs) 326.7 ns   1.6 µs   1.8 µs
    TANH                     521.3 ns     1,918,000 (336.1 ns …   2.5 µs) 346.3 ns   2.4 µs   2.5 µs
 */
