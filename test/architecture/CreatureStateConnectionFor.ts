/**
 * Unit tests for CreatureState.connectionFor (Issue #3089).
 *
 * connectionFor memoises the SynapseState reference on the Synapse instance,
 * skipping the nested-Map double lookup after the first resolution. The cache
 * is validated against a generation counter that is bumped on every reset of
 * the connection map (CreatureState.clear), so a stale cache is detected in
 * O(1).
 */

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureState } from "@architecture/CreatureState.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { SynapseState } from "@propagate/SynapseState.ts";

Deno.test("connectionFor - resolves the same SynapseState as connection()", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const synapse = new Synapse(0, 1, 0.5);

  const viaMap = state.connection(0, 1);
  const viaCache = state.connectionFor(synapse);

  assert(viaCache instanceof SynapseState);
  assertStrictEquals(viaCache, viaMap);
});

Deno.test("connectionFor - returns the cached reference on repeated calls", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const synapse = new Synapse(0, 1, 0.5);

  const first = state.connectionFor(synapse);
  const second = state.connectionFor(synapse);

  assertStrictEquals(first, second);
  // The reference is memoised on the synapse itself.
  assertStrictEquals(synapse.stateCache, first);
});

Deno.test("connectionFor - mutations via the cached state are visible through connection()", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const synapse = new Synapse(0, 1, 0.5);

  const cached = state.connectionFor(synapse);
  cached.count = 7;

  // Same underlying object, so connection() sees the mutation.
  assertEquals(state.connection(0, 1).count, 7);
  assertEquals(state.connectionFor(synapse).count, 7);
});

Deno.test("connectionFor - independent state per synapse pair", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const a = new Synapse(0, 1, 0.5);
  const b = new Synapse(0, 2, 0.5);

  const csA = state.connectionFor(a);
  const csB = state.connectionFor(b);

  assert(csA !== csB);
  csA.count = 3;
  assertEquals(csB.count, 0);
});

Deno.test("connectionFor - clear() invalidates the cache via the generation tag", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const synapse = new Synapse(0, 1, 0.5);

  const before = state.connectionFor(synapse);
  before.count = 5;

  state.clear();

  // After a reset, a fresh SynapseState must be returned — not the stale one.
  const after = state.connectionFor(synapse);
  assert(after !== before, "expected a fresh SynapseState after clear()");
  assertEquals(after.count, 0);
});

Deno.test("connectionFor - re-resolves after clear() even if the synapse still holds an old reference", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const synapse = new Synapse(0, 1, 0.5);

  // Prime the cache, then reset.
  state.connectionFor(synapse);
  const staleRef = synapse.stateCache;
  assert(staleRef !== undefined);

  state.clear();

  // The synapse still carries the stale reference, but the generation tag no
  // longer matches, so connectionFor must resolve a new one.
  const resolved = state.connectionFor(synapse);
  assert(resolved !== staleRef);
  assertStrictEquals(synapse.stateCache, resolved);
});

Deno.test("connectionFor - tracks the connection map across multiple clears", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);
  const synapse = new Synapse(0, 1, 0.5);

  const refs = new Set<SynapseState>();
  for (let i = 0; i < 4; i++) {
    const cs = state.connectionFor(synapse);
    refs.add(cs);
    // Repeated calls in the same generation return the cached reference.
    assertStrictEquals(state.connectionFor(synapse), cs);
    state.clear();
  }

  // Each clear() produced a distinct fresh SynapseState.
  assertEquals(refs.size, 4);
});

Deno.test("connectionFor - topology mutation then re-activation yields fresh state (Issue #3089)", () => {
  // Train-shaped flow: build, run state through clear (as clearState does on
  // topology change), and confirm the synapse cache is invalidated so the
  // re-resolved state is fresh rather than the stale pre-mutation reference.
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  const synapse = creature.synapses[0];
  const state = creature.state;

  const pre = state.connectionFor(synapse);
  pre.count = 11;
  assertEquals(state.connectionFor(synapse).count, 11);

  // clearState() resets the connection map on topology change.
  creature.clearState();

  const post = state.connectionFor(synapse);
  assert(post !== pre, "expected fresh SynapseState after clearState()");
  assertEquals(post.count, 0);
});
