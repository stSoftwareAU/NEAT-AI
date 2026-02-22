import { Creature } from "../../src/Creature.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";

/**
 * Benchmark for Issue #1587: Rejection sampling optimisation for AddConnection.
 *
 * Measures AddConnection.mutate() performance on sparse forward-only creatures,
 * where rejection sampling should provide the greatest speedup by avoiding
 * the O(N²) available-connections list construction.
 *
 * Each iteration creates a fresh creature to ensure the available-connections
 * cache is not pre-populated.
 */

Deno.bench(
  "AddConnection rejection sampling: sparse (5i, 3o, 5h)",
  { group: "rejectionSampling" },
  () => {
    const creature = new Creature(5, 3, { layers: [{ count: 5 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection rejection sampling: medium (10i, 5o, 15h)",
  { group: "rejectionSampling" },
  () => {
    const creature = new Creature(10, 5, { layers: [{ count: 15 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection rejection sampling: large (20i, 10o, 30h)",
  { group: "rejectionSampling" },
  () => {
    const creature = new Creature(20, 10, { layers: [{ count: 30 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection rejection sampling: very large (50i, 20o, 80h)",
  { group: "rejectionSampling" },
  () => {
    const creature = new Creature(50, 20, { layers: [{ count: 80 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);
