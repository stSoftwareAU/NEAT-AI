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
 *  benchmark                   9 May     10 May
 *  -----------------       ---------   --------
 *  ABSOLUTE                  43.8 ns      19 ns
 *  ArcTan                   172.2 ns    72.1 ns
 *  BENT_IDENTITY            227.7 ns    99.0 ns
 *  BIPOLAR                  127.5 ns   101.8 ns
 *  BIPOLAR_SIGMOID          245.1 ns   196.3 ns
 *  COMPLEMENT               101.5 ns   101.6 ns
 *  Cosine                     5.3 µs   768.8 ns
 *  Cube                     238.4 ns   176.2 ns
 *  ELU                      230.5 ns   173.4 ns
 *  Exponential              233.1 ns   233.5 ns
 *  GAUSSIAN                 400.5 ns   438.8 ns
 *  GELU                     753.2 ns   442.7 ns
 *  HARD_TANH                120.0 ns   139.6 ns
 *  IDENTITY                 102.0 ns
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
