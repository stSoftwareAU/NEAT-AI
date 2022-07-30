// const DEBUG=true;

export interface ScorableInterface {
  score: number;
  nodes: { index: number }[];
  connections: { from: undefined | number }[];
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

  // if( DEBUG){
  //   let lastScore=Infinity;
  //   for( let pos=0;pos<population.length;pos++){
  //     const creature=population[pos];
  //     if( creature.score>lastScore){
  //       throw "Unsorted at " + pos + " was: " + lastScore + ", now: " + creature.score;
  //     }
  //     if( isFinite( creature.score)){
  //       if( lastScore!=Infinity)
  //       {
  //         if( !isFinite(lastScore)){
  //           throw "Unsorted (not a number) at " + pos + " was: " + lastScore + ", now: " + creature.score;
  //         }
  //       }
  //     }
  //     lastScore=creature.score;
  //   }
  // }
  const elitists = population.slice(0, elitism);

  return elitists;
}
