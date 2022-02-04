/*******************************************************************************
                                  WORKERS
*******************************************************************************/
import {Holder} from "./holder.ts";

export const Workers = {
  // export default Workers = {
  // evaluate= function( converted, cost){
  //   console.log( converted, cost);
  // }

  create: Holder,
  // node: {
  //   TestWorker: require('./node/testworker')
  // },
  // browser: {
  //   TestWorker: require('./browser/testworker')
  // }
  // deno() {
  // TestWorker: (function (){ return new Worker(new URL("workers/worker.js", import.meta.url).href, { type: "module" })})
  // }
};
