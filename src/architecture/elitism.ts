// function _shuffleDown(
//   elitists: { score: number }[],
//   pos: number,
//   gene: { score: number },
// ) {
//   for (let k = pos; k < elitists.length; k++) {
//     const check = elitists[k];
//     if (!check ) {
//       elitists[k] = gene;
//       break;
//     } else if (gene.score > check.score) {
//       elitists[k] = gene;
//       _shuffleDown(elitists, k + 1, check);
//       break;
//     }
//   }
// }
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
    if (b.score == a.score) {
      if (b.nodes == a.nodes) {
        return a.connections.length - b.connections.length; //Shorter the better
      } else {
        return a.nodes.length - b.nodes.length; //Shorter the better
      }
    }
    return b.score - a.score;
  });

  const elitists = population.slice(0, elitism);

  return elitists;
}

// export function makeElitistsNew(population: { score: number }[], size = 1) {
//   const elitism = Math.min(Math.max(1, size), population.length);
//   const elitists: { score: number }[] = new Array(elitism);

//   for (let j = population.length; j--;) {
//     const gene = population[j];

//     for (let i = elitism; i--;) {
//       const e = elitists[i];
//       if (!e ) {
//         if (i == 0) {
//           elitists[0] = gene;
//         }
//       } else {
//         if (e.score < gene.score) {
//           if (i == 0 || elitists[i - 1].score >= gene.score) {
//             elitists[i] = gene;
//             _shuffleDown(elitists, i + 1, e);
//             break;
//           }
//         } else {
//           _shuffleDown(elitists, i + 1, gene);

//           break;
//         }
//       }
//     }
//   }

//   return elitists;
// }
