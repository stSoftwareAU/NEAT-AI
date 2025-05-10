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
 *  IDENTITY                 102.0 ns   102.0 ns
 *  ISRU                     152.0 ns   210.7 ns*
 *  LeakyReLU                132.6 ns   117.1 ns
 *  LOGISTIC                 479.2 ns   324.8 ns
 *  LogSigmoid               698.0 ns   223.2 ns
 *  Mish                     489.2 ns   486.3 ns
 *  ReLU                     123.5 ns   127.6 ns
 *  ReLU6                    148.9 ns   204.7 ns
 *  SELU                     244.2 ns   167.3 ns
 *  SINE                       2.9 µs   738.7 ns
 *  SOFTSIGN                 140.8 ns   134.5 ns
 *  Softplus                 389.5 ns   216.4 ns
 *  StdInverse               143.0 ns
    STEP                     225.6 ns     4,432,000 (135.7 ns …   1.7 µs) 174.6 ns   1.4 µs   1.5 µs
    Swish                     10.3 µs -> 196.8 ns
    TAN                      421.5 ns     2,373,000 (320.9 ns …   1.8 µs) 326.7 ns   1.6 µs   1.8 µs
    TANH                     521.3 ns     1,918,000 (336.1 ns …   2.5 µs) 346.3 ns   2.4 µs   2.5 µs
 */
