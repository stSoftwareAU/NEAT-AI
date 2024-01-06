import {
  assertAlmostEquals,
  assertEquals,
  fail,
} from "https://deno.land/std@0.211.0/assert/mod.ts";
import { fineTuneImprovement } from "../src/architecture/FineTune.ts";
import { Network } from "../src/architecture/Network.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("tune", async () => {
  const previousFittest: Network = Network.fromJSON({
    nodes: [
      {
        type: "hidden",
        uuid: "previous-0001",
        bias: -0.5,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        bias: 0.1,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        bias: 0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        bias: 0.3,
        squash: "LOGISTIC",
      },
      {
        type: "output",
        uuid: "74d01774-086b-4ddb-bb18-367abb63a75a",
        bias: -0.49135010426905,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    connections: [
      {
        weight: -0.67556172986067,
        fromUUID: "input-0",
        toUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
      },
      {
        weight: -0.29860676755617,
        fromUUID: "input-1",
        toUUID: "previous-0001",
      },

      {
        weight: -0.06729866176755,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
      },
      {
        weight: -0.012398765,
        fromUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },

      {
        weight: -0.00000012,
        fromUUID: "previous-0001",
        toUUID: "74d01774-086b-4ddb-bb18-367abb63a75a",
      },
      {
        weight: 0.9867556172986067,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },
      {
        weight: 0.96764643541,
        fromUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        toUUID: "74d01774-086b-4ddb-bb18-367abb63a75a",
      },
    ],
    input: 2,
    output: 1,
    tags: [{ name: "score", value: "0.5" }],
  });

  previousFittest.validate();

  const fittest: Network = Network.fromJSON({
    nodes: [
      {
        type: "hidden",
        uuid: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        bias: 0.1,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        bias: 0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        bias: 0.32,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "fittest-0001",
        bias: -0.3,
        squash: "IDENTITY",
      },
      {
        type: "output",
        uuid: "74d01774-086b-4ddb-bb18-367abb63a75a",
        bias: -0.49135010426905,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    connections: [
      {
        weight: -0.67556172986067,
        fromUUID: "input-0",
        toUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
      },
      {
        weight: -0.67556172986067,
        fromUUID: "input-1",
        toUUID: "fittest-0001",
      },
      {
        weight: 0.9967556172986067,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },
      {
        weight: -0.06729866176755,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
      },
      {
        weight: -0.012398765,
        fromUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },

      {
        weight: -0.00000067,
        fromUUID: "fittest-0001",
        toUUID: "74d01774-086b-4ddb-bb18-367abb63a75a",
      },
      {
        weight: 0.96864643541,
        fromUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        toUUID: "74d01774-086b-4ddb-bb18-367abb63a75a",
      },
    ],
    input: 2,
    output: 1,
    tags: [{ name: "score", value: "0.51" }],
  });

  fittest.validate();

  const fineTuned = await fineTuneImprovement(fittest, previousFittest);

  fineTuned.forEach((n) => {
    const en = n.exportJSON();

    en.nodes.forEach((node) => {
      if (node.uuid == "41a4f3dd-f253-491e-b04f-c9651b72eaaa") {
        assertAlmostEquals(node.bias ? node.bias : 0, 0.1, 0.0000001, n.uuid);
      }

      if (node.uuid == "74d01774-086b-4ddb-bb18-367abb63a75a") {
        assertAlmostEquals(
          node.bias ? node.bias : 0,
          -0.49135010426905,
          0.0000001,
          n.uuid,
        );
      }
      if (node.uuid == "0a858bc2-3bdc-417c-85b0-e9c513828d29") {
        if (Math.abs(node.bias ? node.bias : 0 - 0.32) < 0.000001) {
          fail("Should have changed bias from 0.32");
        }
      }
    });

    en.connections.forEach((c) => {
      if (
        c.fromUUID == "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff" &&
        c.toUUID == "0a858bc2-3bdc-417c-85b0-e9c513828d29"
      ) {
        assertAlmostEquals(c.weight, -0.012398765, 0.000001, JSON.stringify(c));
      }

      if (
        c.fromUUID == "41a4f3dd-f253-491e-b04f-c9651b72eaaa" &&
        c.toUUID == "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff"
      ) {
        assertAlmostEquals(
          c.weight,
          -0.06729866176755,
          0.000001,
          JSON.stringify(c),
        );
      }
    });
  });

  assertEquals(
    fineTuned.length,
    10,
    "We should have made changes, was: " + fineTuned.length,
  );
});
