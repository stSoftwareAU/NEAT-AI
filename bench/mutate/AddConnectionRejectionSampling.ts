import { Creature } from "@creature";
import { AddConnection } from "@mutate/AddConnection.ts";

/**
 * Benchmark for Issue #1587: Rejection sampling optimisation for AddConnection.
 *
 * Measures AddConnection.mutate() performance on sparse forward-only creatures,
 * where rejection sampling should provide the greatest speedup by avoiding
 * the O(N²) available-connections list construction.
 *
 * Each iteration creates a fresh creature to ensure the available-connections
 * cache is not pre-populated — this is the scenario where rejection sampling
 * provides the greatest benefit.
 */

Deno.bench(
  "AddConnection: sparse (5i, 3o, 5h)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(5, 3, { layers: [{ count: 5 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection: medium (10i, 5o, 15h)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(10, 5, { layers: [{ count: 15 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection: large (20i, 10o, 30h)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(20, 10, { layers: [{ count: 30 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection: very large (50i, 20o, 80h)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(50, 20, { layers: [{ count: 80 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);
