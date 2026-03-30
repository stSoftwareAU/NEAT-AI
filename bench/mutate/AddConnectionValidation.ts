import { Creature } from "@creature";
import { AddConnection } from "@mutate/AddConnection.ts";

/**
 * Benchmark for Issue #1584: Remove redundant validation in AddConnection.
 *
 * Measures AddConnection.mutate() performance on forward-only creatures,
 * where the redundant validate() calls have the most impact.
 */

Deno.bench(
  "AddConnection: forward-only creature (sparse)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(5, 3, { layers: [{ count: 5 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection: forward-only creature (medium)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(10, 5, { layers: [{ count: 15 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);

Deno.bench(
  "AddConnection: forward-only creature (large)",
  { group: "addConnection" },
  () => {
    const creature = new Creature(20, 10, { layers: [{ count: 30 }] });
    creature.forwardOnly = true;
    const addConn = new AddConnection(creature);
    addConn.mutate();
  },
);
