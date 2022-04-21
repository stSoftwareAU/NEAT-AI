export interface ScorableInterface {
  score: number;
  nodes: { index: number }[];
  connections: { from: (undefined | number) }[];
}

export function makeElitists(
  population: ScorableInterface[],
  size = 1,
) {
  const elitism = Math.min(Math.max(1, size), population.length);

  population.sort((a, b) => {
    if (isFinite(a.score)) {
      if (isFinite(b.score)) {
        if (b.score == a.score) {
          if (b.nodes == a.nodes) {
            return a.connections.length - b.connections.length; //Shorter the better
          } else {
            return a.nodes.length - b.nodes.length; //Shorter the better
          }
        }
        return b.score - a.score;
      } else {
        return -1;
      }
    } else if (isFinite(b.score)) {
      return 1;
    } else {
      return 0;
    }
  });

  const elitists = population.slice(0, elitism);

  return elitists;
}
