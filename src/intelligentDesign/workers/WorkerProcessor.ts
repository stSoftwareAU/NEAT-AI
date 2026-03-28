/**
 * Worker processor for Intelligent Design scoring operations.
 *
 * Issue #1600: Uses shared WASM init from src/workers/WasmWorkerInit.ts.
 *
 * @module
 */

import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../Creature.ts";
import { initialiseWasmActivationFromPayload } from "../../workers/WasmWorkerInit.ts";
import type { RequestData } from "./WorkerHandler.ts";
import type { ResponseData } from "./ResponseData.ts";

/**
 * Processes scoring requests in a worker thread.
 */
export class WorkerProcessor {
  private wasmInitAttempted = false;

  /**
   * Processes a scoring request.
   *
   * @param data - The request data containing the creature and scoring parameters
   * @returns The scoring result including the score, error, and updated creature JSON
   */
  async process(data: RequestData): Promise<ResponseData> {
    const start = Date.now();
    if (data.initialize) {
      // Issue #1600: Use shared WASM init utility.
      if (!this.wasmInitAttempted) {
        this.wasmInitAttempted = true;
        await initialiseWasmActivationFromPayload(
          data.initialize.wasmActivation,
          true,
        );
      }
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        initialize: {
          status: "OK",
        },
      };
    } else if (data.score) {
      const { uuid, creature, dataDir, options } = data.score;
      const json = JSON.parse(creature);
      const adjustedCreature = Creature.fromJSON(json);
      adjustedCreature.fix();
      const result = await adjustedCreature.scoreDir(dataDir, options);
      const exported = adjustedCreature.exportJSON();
      addTag(exported, "score", `${result.score}`);
      addTag(exported, "error", `${result.error}`);

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        score: {
          uuid: uuid,
          score: result.score,
          creature: JSON.stringify(exported, null, 1),
          error: result.error,
        },
      };
    } else {
      throw new Error("unknown message");
    }
  }
}
