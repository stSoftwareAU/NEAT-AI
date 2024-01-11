import { Creature } from "../Creature.ts";

export function makeElitists(
  population: Creature[],
  size = 1,
) {
  const elitism = Math.min(Math.max(1, size), population.length);

  population.sort((a, b) => {
    if (Number.isFinite(a.score)) {
      if (Number.isFinite(b.score)) {
        if (b.score == a.score) {
          if (b.nodes == a.nodes) {
            return a.connections.length - b.connections.length; //Shorter the better
          } else {
            return a.nodes.length - b.nodes.length; //Shorter the better
          }
        }
        return (b.score as number) - (a.score as number);
      } else {
        return -1;
      }
    } else if (Number.isFinite(b.score)) {
      return 1;
    } else {
      return 0;
    }
  });

  const elitists = population.slice(0, elitism);

  return elitists;
}
