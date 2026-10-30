// The hash table is an authored model, so the promises are checked here:
// explicit hashing, every collision strategy, tombstones, resizing, and the
// invariant that a stored key can always be retrieved.
//
//   node --test src/datastructures/hashTable.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { applyOperation, initialState } from "./model.js";
import {
  CANDIDATE_KEYS,
  GOLDEN_FRACTION,
  HASH_PRESETS,
  HASH_START,
  HASH_STRATEGIES,
  MAX_CAPACITY,
  bucketIndex,
  compareStrategies,
  findCollision,
  hashBreakdown,
  hashStep,
  nextCapacity,
  rawHash,
} from "./hashTable.js";

const TYPE = "hash-table";

const fresh = (extra = {}) => ({ ...initialState(TYPE), threshold: 0.95, ...extra });
const run = (state, op, input = {}) => applyOperation(TYPE, state, op, input);
const ok = (state, op, input = {}) => {
  const result = run(state, op, input);
  assert.ok(!result.error, `${op} ${JSON.stringify(input)}: ${result.error}`);
  assert.ok(result.frames.length > 0, `${op} records at least one frame`);
  assert.deepEqual(result.frames.at(-1).state, result.state, `${op} ends on its returned state`);
  return result;
};

/** Every key in the table, read back with the real search operation. */
function assertEveryKeyReadable(state, pairs) {
  for (const { key, value } of pairs) {
    const found = ok(state, "search", { key });
    assert.match(found.frames.at(-1).text, new RegExp(`Found ${key}`), `search ${key}`);
    assert.equal(found.frames.at(-1).state.count, state.count, "a search does not change the count");
    assert.ok(
      found.frames.at(-1).text.includes(value),
      `search ${key} reports its value ${value}: ${found.frames.at(-1).text}`,
    );
  }
}

const entriesOf = (state) =>
  state.strategy === "chaining"
    ? state.table.flat().map((entry) => ({ key: entry.key, value: entry.value }))
    : state.table.filter((slot) => slot && !slot.tombstone).map((entry) => ({ key: entry.key, value: entry.value }));

test("the empty table has a valid shape and every strategy starts empty", () => {
  assert.equal(HASH_START.count, 0);
  assert.equal(HASH_START.tombstones, 0);
  assert.equal(HASH_START.table.length, HASH_START.capacity);
  assert.ok(HASH_START.table.every((bucket) => Array.isArray(bucket)));
  assert.equal(initialState(TYPE).count, 0);

  for (const { id } of HASH_STRATEGIES) {
    const start = fresh({ strategy: id, table: undefined });
    const empty = run({ ...HASH_START, ...start, strategy: id }, "clear", {});
    assert.ok(!empty.error);
    assert.equal(empty.state.count, 0);
    assert.equal(empty.state.tombstones, 0);
  }
});

test("every hash function is deterministic and normalises into the table", () => {
  const keys = ["apple", "ab", "ba", "7", "-3", "42", "a much longer key"];
  for (const capacity of [5, 7, 11, 13, 16]) {
    for (const key of keys) {
      const first = bucketIndex("division", key, capacity);
      assert.equal(first, bucketIndex("division", key, capacity), "division is deterministic");
      for (const fn of ["division", "multiplication", "polynomial", "first-char"]) {
        const index = bucketIndex(fn, key, capacity);
        assert.ok(Number.isInteger(index), `${fn}/${key}/${capacity} is an integer index`);
        assert.ok(index >= 0 && index < capacity, `${fn}/${key} -> ${index} is inside 0..${capacity - 1}`);
        assert.equal(index, bucketIndex(fn, key, capacity), `${fn} is deterministic`);
      }
    }
  }
});

test("the documented hash functions produce the documented raw values", () => {
  assert.equal(rawHash("division", "42"), 42);
  assert.equal(bucketIndex("division", "42", 7), 0);
  assert.equal(rawHash("division", "ab"), 97 + 98);
  assert.equal(bucketIndex("division", "ab", 7), 195 % 7);
  assert.equal(rawHash("first-char", "ab"), 97);
  assert.equal(rawHash("polynomial", "ab"), 97 * 31 + 98);
  assert.equal(rawHash("polynomial", "ab"), rawHash("polynomial", "ab"));

  // Raw hash and bucket index are different numbers, on purpose.
  assert.equal(rawHash("division", "apple"), 97 + 112 + 112 + 108 + 101);
  assert.equal(bucketIndex("division", "apple", 7), rawHash("division", "apple") % 7);

  // Multiplication scales the fraction instead of taking a remainder.
  const index = bucketIndex("multiplication", "12345", 7);
  assert.ok(index >= 0 && index < 7);
  assert.equal(index, bucketIndex("multiplication", "12345", 7));
});

test("a single insert records the hash, the bucket and the final placement", () => {
  const result = ok(fresh(), "insert", { key: "apple", value: "4" });
  assert.equal(result.state.count, 1);
  assert.equal(result.frames.length, 2);
  assert.match(result.frames[0].text, /raw hash/);
  assert.match(result.frames[0].text, /mod 7 = 5/);
  assert.match(result.frames[1].text, /append apple=4/i);
  assert.deepEqual(result.frames[1].marks.inserted, ["e:apple"]);
  assert.equal(entriesOf(result.state).length, 1);
});

test("inserting an existing key updates it and never creates a duplicate", () => {
  const first = ok(fresh(), "insert", { key: "apple", value: "4" });
  const second = ok(first.state, "insert", { key: "apple", value: "9" });
  assert.equal(second.state.count, 1);
  assert.match(second.frames.at(-1).text, /already in bucket/);
  assert.match(second.frames.at(-1).text, /update its value from 4 to 9/);
  assert.deepEqual(entriesOf(second.state), [{ key: "apple", value: "9" }]);

  const missing = run(second.state, "update", { key: "pear", value: "1" });
  assert.match(missing.error, /not in the table; insert it instead/);
});

test("update changes only the value, and search/contains report the real path", () => {
  let state = ok(fresh(), "insert", { key: "apple", value: "4" }).state;
  const updated = ok(state, "update", { key: "apple", value: "5" });
  assert.deepEqual(entriesOf(updated.state), [{ key: "apple", value: "5" }]);
  assert.match(updated.frames.at(-1).text, /key set is unchanged/);
  state = updated.state;

  const found = ok(state, "search", { key: "apple" });
  assert.match(found.frames.at(-1).text, /Found apple=5/);
  assert.deepEqual(found.frames.at(-1).marks.found, ["e:apple"]);

  const missing = ok(state, "search", { key: "pear" });
  assert.match(missing.frames.at(-1).text, /not in the table/);
  assert.equal(missing.state.count, 1);

  const yes = ok(state, "contains", { key: "apple" });
  assert.match(yes.frames.at(-1).text, /contains\(apple\) is true/);
  const no = ok(state, "contains", { key: "pear" });
  assert.match(no.frames.at(-1).text, /contains\(pear\) is false/);
  assert.equal(no.state.count, 1, "contains is observational");
});

test("separate chaining keeps chains, searches every entry and deletes from the middle", () => {
  let state = fresh();
  for (const [key, value] of [["ab", "1"], ["ba", "2"], ["ac", "3"]]) {
    state = ok(state, "insert", { key, value }).state;
  }
  assert.equal(state.table[195 % 7].length, 2, "ab and ba collide in one chain");
  assert.equal(state.table[196 % 7].length, 1);

  const search = ok(state, "search", { key: "ba" });
  assert.ok(search.frames.some((entry) => entry.marks.compare.includes("e:ab")), "the chain is walked");
  assert.match(search.frames.at(-1).text, /Found ba=2/);

  const removed = ok(state, "delete", { key: "ab" });
  assert.equal(removed.state.count, 2);
  assert.equal(removed.state.table[195 % 7].length, 1);
  assert.match(removed.frames.at(-1).text, /Delete ab from bucket/);
  assert.doesNotMatch(removed.frames.at(-1).text, /tombstone/);

  const again = ok(removed.state, "delete", { key: "ab" });
  assert.match(again.frames.at(-1).text, /not in the table/);
  assert.equal(again.state.count, 2);
});

test("linear probing shows the collision, the next slot, and a correct lookup", () => {
  const probe = fresh({ strategy: "linear", table: Array(7).fill(null) });
  const first = ok(probe, "insert", { key: "ab", value: "1" });
  assert.equal(first.state.table[6].key, "ab");

  const second = ok(first.state, "insert", { key: "ba", value: "2" });
  assert.equal(second.state.table[6].key, "ab");
  assert.equal(second.state.table[0].key, "ba");
  assert.match(second.frames[1].text, /collision/i);
  assert.match(second.frames[2].text, /Bucket 0 is empty/);

  const found = ok(second.state, "search", { key: "ba" });
  assert.ok(found.frames.some((entry) => entry.marks.collision.includes("b6")));
  assert.match(found.frames.at(-1).text, /Found ba=2 in bucket 0/);

  const missing = ok(second.state, "search", { key: "zz" });
  assert.match(missing.frames.at(-1).text, /empty, so the probe stops/);
});

test("deletion in open addressing leaves a tombstone that lookup must pass", () => {
  let state = fresh({ strategy: "linear", table: Array(7).fill(null) });
  state = ok(state, "insert", { key: "ab", value: "1" }).state;
  state = ok(state, "insert", { key: "ba", value: "2" }).state;
  state = ok(state, "insert", { key: "ac", value: "3" }).state;
  assert.equal(state.count, 3);

  const deleted = ok(state, "delete", { key: "ba" });
  assert.equal(deleted.state.count, 2);
  assert.equal(deleted.state.tombstones, 1);
  assert.ok(deleted.state.table[0].tombstone);
  assert.match(deleted.frames.at(-1).text, /tombstone at bucket 0/);

  const stillThere = ok(deleted.state, "search", { key: "ac" });
  assert.ok(
    stillThere.frames.some((entry) => entry.marks.tombstone.includes("b0")),
    "the lookup steps through the tombstone",
  );
  assert.match(stillThere.frames.at(-1).text, /Found ac=3/);

  const reuse = ok(deleted.state, "insert", { key: "zz", value: "9" });
  assert.equal(reuse.state.tombstones, 0, "the tombstone is reused");
  assert.equal(reuse.state.table[0].key, "zz");
  assert.match(reuse.frames.at(-1).text, /reuse it/);

  const rebuilt = ok(reuse.state, "rehash", {});
  assert.equal(rebuilt.state.tombstones, 0);
  assert.equal(rebuilt.state.count, 3);
});

test("quadratic probing terminates, detects a repeated sequence and never loops", () => {
  let state = fresh({ strategy: "quadratic", capacity: 5, table: Array(5).fill(null), threshold: 0.99 });
  const placed = [];
  for (const key of ["5", "10", "15"]) {
    const result = ok(state, "insert", { key, value: key });
    state = result.state;
    placed.push(result);
  }
  assert.equal(state.count, 3);
  assert.ok(placed.some((result) => result.frames.some((entry) => entry.marks.collision.length)));

  const fourth = ok(state, "insert", { key: "20", value: "20" });
  assert.equal(fourth.state.count, 3, "the impossible insertion changes nothing");
  assert.match(fourth.frames.at(-1).text, /cannot be inserted/);
  assert.deepEqual(fourth.frames.at(-1).state, state, "a failed insert is not a partial mutation");
});

test("double hashing uses a non-zero, coprime step and reaches every slot", () => {
  assert.ok(hashStep("division", "7", 7) >= 1);
  const state = fresh({ strategy: "double", capacity: 7, table: Array(7).fill(null), threshold: 0.99 });
  let current = state;
  for (const key of ["7", "14", "21", "35", "42", "49"]) {
    const result = ok(current, "insert", { key, value: key });
    assert.ok(
      result.frames.some((entry) => entry.detail?.kind === "hash"),
      "the second hash is shown",
    );
    current = result.state;
  }
  assert.equal(current.count, 6, "six colliding keys still fit a seven-slot prime table");
  assert.equal(new Set(current.table.filter(Boolean).map((slot) => slot.key)).size, 6);
  assertEveryKeyReadable(current, ["7", "14", "21", "35", "42", "49"].map((key) => ({ key, value: key })));
});

test("crossing the load threshold rehashes every key into a bigger table", () => {
  let state = fresh({ capacity: 7, threshold: 0.75 });
  const pairs = [];
  for (const key of ["ant", "bee", "cat", "dog", "eel", "fox"]) {
    pairs.push({ key, value: key });
    const result = ok(state, "insert", { key, value: key });
    state = result.state;
    if (key === "fox") {
      assert.equal(state.capacity, 14, "the sixth key crosses 6/7 > 0.75");
      assert.ok(result.frames.some((entry) => entry.detail?.kind === "resize-start"));
      assert.ok(result.frames.some((entry) => entry.detail?.kind === "resize-alloc"));
      assert.equal(result.frames.filter((entry) => entry.detail?.kind === "rehash").length, 6);
      assert.match(result.frames.at(-1).text, /Rebuild complete/);
      assert.equal(result.frames.at(-1).state.previous, null);
      assert.ok(
        result.frames.filter((entry) => entry.detail?.kind === "rehash").every((entry) => entry.state.previous),
        "the old table stays available while keys move",
      );
    }
  }
  assert.equal(state.count, 6);
  assertEveryKeyReadable(state, pairs);

  const intermediate = ok(fresh({ capacity: 7, threshold: 0.75 }), "load", { preset: "resize" });
  const moving = intermediate.frames.filter((entry) => entry.detail?.kind === "rehash");
  assert.ok(moving.length >= 6, "every key is rehashed, one frame each");
  assert.ok(moving[0].state.previous, "the old table stays available during the move");
  assert.equal(intermediate.frames.at(-1).state.previous, null, "the completed table has no stale old copy");
});

test("manual resize validates capacity and preserves every entry", () => {
  let state = fresh();
  for (const [key, value] of [["apple", "4"], ["pear", "8"], ["plum", "3"], ["fig", "6"], ["kiwi", "2"]]) {
    state = ok(state, "insert", { key, value }).state;
  }

  const small = run(state, "resize", { capacity: 1 });
  assert.match(small.error, /must be a whole number/);
  assert.match(run(state, "resize", { capacity: 4 }).error, /cannot hold/);
  assert.match(run(state, "resize", { capacity: 7 }).error, /already has capacity/);

  const grown = ok(state, "resize", { capacity: 14 });
  assert.equal(grown.state.capacity, 14);
  assert.equal(grown.state.count, 5);
  assertEveryKeyReadable(grown.state, [
    { key: "apple", value: "4" },
    { key: "pear", value: "8" },
    { key: "plum", value: "3" },
    { key: "fig", value: "6" },
    { key: "kiwi", value: "2" },
  ]);

  const doubleHashed = fresh({ strategy: "double", capacity: 7, table: Array(7).fill(null) });
  assert.match(run(doubleHashed, "resize", { capacity: 8 }).error, /prime capacity/);
});

test("configuration changes rehash rather than keeping stale bucket indices", () => {
  let state = fresh();
  for (const key of ["apple", "pear", "plum"]) state = ok(state, "insert", { key, value: key }).state;

  const switched = ok(state, "configure", { strategy: "linear", hashFn: "polynomial", threshold: 0.7 });
  assert.equal(switched.state.strategy, "linear");
  assert.equal(switched.state.hashFn, "polynomial");
  assert.equal(switched.state.count, 3);
  assert.equal(switched.state.table.length, 7);
  assertEveryKeyReadable(switched.state, ["apple", "pear", "plum"].map((key) => ({ key, value: key })));

  assert.match(run(switched.state, "configure", {
    strategy: "linear",
    hashFn: "polynomial",
    threshold: 0.7,
  }).error, /already the table configuration/);
  assert.match(run(switched.state, "configure", {
    strategy: "linear",
    hashFn: "polynomial",
    threshold: 2.5,
  }).error, /between 0.10 and 2.00/);
  assert.match(run(switched.state, "configure", {
    strategy: "linear",
    hashFn: "polynomial",
    threshold: 1.2,
  }).error, /0.95 or below/);

  const onlyThreshold = ok(switched.state, "configure", { strategy: "linear", hashFn: "polynomial", threshold: 0.5 });
  assert.equal(onlyThreshold.frames.length, 1);
  assert.equal(onlyThreshold.state.capacity, switched.state.capacity);
  assert.match(onlyThreshold.frames[0].text, /No key moves/);
});

test("switching a crowded chain table to open addressing grows the capacity", () => {
  let state = fresh({ threshold: 1.5 });
  for (let i = 0; i < 10; i += 1) state = ok(state, "insert", { key: `k${i}`, value: String(i) }).state;
  assert.equal(state.count, 10);
  assert.equal(state.capacity, 7, "chains may hold more keys than buckets");

  const opened = ok(state, "configure", { strategy: "linear", hashFn: "division", threshold: 0.75 });
  assert.ok(opened.state.capacity > 10, `open addressing needs an empty slot: ${opened.state.capacity}`);
  assert.equal(opened.state.count, 10);
  assertEveryKeyReadable(opened.state, Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, value: String(i) })));
});

test("clear empties the table but keeps its configuration", () => {
  let state = fresh({ strategy: "linear", table: Array(7).fill(null), hashFn: "polynomial" });
  state = ok(state, "insert", { key: "apple", value: "4" }).state;
  state = ok(state, "insert", { key: "pear", value: "8" }).state;
  state = ok(state, "delete", { key: "apple" }).state;
  assert.equal(state.tombstones, 1);

  const cleared = ok(state, "clear", {});
  assert.equal(cleared.state.count, 0);
  assert.equal(cleared.state.tombstones, 0);
  assert.equal(cleared.state.capacity, 7);
  assert.equal(cleared.state.strategy, "linear");
  assert.equal(cleared.state.hashFn, "polynomial");
  assert.ok(cleared.state.table.every((slot) => slot === null));
});

test("every playground dataset loads deterministically and keeps its keys", () => {
  for (const [id, preset] of Object.entries(HASH_PRESETS)) {
    const first = ok(fresh(), "load", { preset: id });
    const second = ok(fresh(), "load", { preset: id });
    assert.deepEqual(first, second, `${id} is deterministic`);
    assert.ok(first.state.capacity >= preset.capacity, `${id} keeps at least its configured capacity`);
    assert.equal(
      first.state.count,
      new Set(preset.pairs.map(([key]) => key)).size - (preset.deletes?.length ?? 0),
    );
    assertEveryKeyReadable(
      first.state,
      [...new Map(preset.pairs.map(([key, value]) => [key, value])).entries()]
        .filter(([key]) => !(preset.deletes ?? []).includes(key))
        .map(([key, value]) => ({ key, value })),
    );
  }
  assert.match(run(fresh(), "load", { preset: "nope" }).error, /Unknown dataset/);
});

test("the hash step carries the numbers the journey draws", () => {
  const result = ok(fresh(), "insert", { key: "apple", value: "4" });
  const hash = result.frames[0];
  assert.equal(hash.detail.kind, "hash");
  assert.equal(hash.detail.key, "apple");
  assert.equal(hash.detail.raw, rawHash("division", "apple"));
  assert.equal(hash.detail.index, bucketIndex("division", "apple", 7));
  assert.deepEqual(hash.detail.breakdown, hashBreakdown("division", "apple", 7));
});

test("the formula breakdown reproduces the engine's raw hash and index", () => {
  const keys = ["apple", "ab", "42", "-3", "a much longer key", "zzz"];
  for (const fn of ["division", "multiplication", "polynomial", "first-char"]) {
    for (const capacity of [5, 7, 13]) {
      for (const key of keys) {
        const detail = hashBreakdown(fn, key, capacity);
        assert.equal(detail.raw, rawHash(fn, key), `${fn}/${key} raw`);
        assert.equal(detail.index, bucketIndex(fn, key, capacity), `${fn}/${key} index`);
        assert.ok(detail.index >= 0 && detail.index < capacity, `${fn}/${key} index is in range`);
        assert.ok(detail.steps.length >= 2, `${fn}/${key} has steps to step through`);
        for (const step of detail.steps) {
          assert.ok(step.title, `${fn}/${key} step has a title`);
          assert.ok(step.expression, `${fn}/${key} step has an expression`);
          assert.ok(
            detail.formula.includes(step.term),
            `${fn}/${key}: the highlighted term ${step.term} really is in the formula`,
          );
        }
        assert.deepEqual(hashBreakdown(fn, key, capacity), detail, `${fn}/${key} is deterministic`);
      }
    }
  }
});

test("each breakdown's running values end on the raw hash it reports", () => {
  const poly = hashBreakdown("polynomial", "apple", 7);
  const accumulations = poly.steps.filter((step) => step.term === "hᵢ₋₁ × 31");
  assert.ok(accumulations.length === 5);
  assert.equal(Number(accumulations.at(-1).result), poly.raw);

  const additive = hashBreakdown("division", "apple", 7);
  const sums = additive.steps.filter((step) => step.term === "Σ char codes" && step.result);
  assert.equal(Number(sums.at(-1).result), additive.raw);

  const numeric = hashBreakdown("division", "42", 7);
  assert.equal(numeric.raw, 42);
  assert.ok(!numeric.steps.some((step) => step.term === "Σ char codes"), "an integer key is not spelled out");
  assert.match(numeric.steps.at(-1).expression, /42 mod 7 = 0/);
});

test("the breakdown follows the capacity, and multiplication uses the real constant", () => {
  const atSeven = hashBreakdown("division", "apple", 7);
  const atThirteen = hashBreakdown("division", "apple", 13);
  assert.equal(atSeven.raw, atThirteen.raw, "the raw hash does not depend on the capacity");
  assert.notEqual(atSeven.index, atThirteen.index, "the bucket index does");
  assert.match(atSeven.steps.at(-1).expression, /mod 7/);
  assert.match(atThirteen.steps.at(-1).expression, /mod 13/);

  const multiplying = hashBreakdown("multiplication", "12345", 7);
  assert.equal(multiplying.index, bucketIndex("multiplication", "12345", 7));
  assert.ok(
    multiplying.steps.some((step) => step.expression.includes(String(GOLDEN_FRACTION))),
    "the panel shows the constant the engine multiplies by",
  );
  assert.ok(
    multiplying.steps.some((step) => step.term === "frac"),
    "the fractional part is its own step",
  );
  assert.ok(!multiplying.steps.at(-1).expression.includes("mod"), "multiplication is not a remainder");

  const negative = hashBreakdown("division", "-3", 7);
  assert.equal(negative.index, 4);
  assert.match(negative.steps.at(-1).expression, /\+ 7\) mod 7 = 4/);
});

test("a dataset may name the strategy it needs to be visible", () => {
  const loaded = ok(fresh(), "load", { preset: "deletions" });
  assert.equal(loaded.state.strategy, "linear", "deletions load as open addressing");
  assert.equal(loaded.state.tombstones, 2, "both deletions leave a tombstone");
  assert.ok(loaded.state.table.some((slot) => slot?.tombstone));
  assert.match(loaded.frames[0].text, /Linear probing/);
});

test("the strategy comparison uses the same workload and reports real counts", () => {
  const rows = compareStrategies({ keys: ["ab", "ba", "ac", "ca", "bb"], capacity: 7, hashFn: "division" });
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((row) => row.id)).size, 4);
  for (const row of rows) {
    assert.equal(row.capacity, 7);
    assert.equal(row.keys, 5);
    assert.ok(row.probes >= row.keys, `${row.id} probes every insertion at least once`);
    assert.ok(row.maxProbes >= 1);
    assert.ok(row.loadFactor === row.occupied / 7);
    assert.ok(Number.isFinite(row.averageProbes));
  }
  const again = compareStrategies({ keys: ["ab", "ba", "ac", "ca", "bb"], capacity: 7, hashFn: "division" });
  assert.deepEqual(rows, again);
  assert.ok(rows.find((row) => row.id === "chaining").collisions > 0, "the colliding keys really collide");
});

test("the collision detective finds a deterministic pair without randomness", () => {
  const pair = findCollision("first-char", 7, CANDIDATE_KEYS);
  assert.ok(pair);
  assert.equal(pair.a[0], "a");
  assert.equal(pair.b[0], "a");
  assert.equal(bucketIndex("first-char", pair.a, 7), pair.index);
  assert.equal(bucketIndex("first-char", pair.b, 7), pair.index);
  assert.deepEqual(findCollision("first-char", 7, CANDIDATE_KEYS), pair);
});

test("capacity policies grow safely and stop at the supported maximum", () => {
  assert.equal(nextCapacity("chaining", 7), 14);
  assert.equal(nextCapacity("linear", 8), 16);
  assert.equal(nextCapacity("double", 7), 17);
  assert.equal(nextCapacity("double", 11), 23);
  assert.ok(nextCapacity("chaining", MAX_CAPACITY) === MAX_CAPACITY);
  assert.ok(nextCapacity("double", 97) === 97);
});

test("invalid input is refused without inventing a step", () => {
  const state = fresh();
  for (const input of [{ key: "", value: "1" }, { key: "   ", value: "1" }, { key: "x".repeat(25), value: "1" }]) {
    const result = run(state, "insert", input);
    assert.ok(result.error);
    assert.equal(result.frames, undefined);
    assert.deepEqual(result.state, undefined);
  }
  assert.match(run(state, "insert", { key: "ok", value: "" }).error, /value/);
  assert.match(run(state, "search", { key: "" }).error, /key/);
  assert.match(run(state, "resize", { capacity: "x" }).error, /whole number/);
  assert.match(run(state, "resize", { capacity: 98 }).error, /whole number/);
  const full = fresh({ capacity: MAX_CAPACITY, table: Array.from({ length: MAX_CAPACITY }, () => []) });
  assert.match(run(full, "rehash", {}).error, /largest supported capacity/);
});

test("a fixed sequence is deterministic and every key stays reachable", () => {
  const operations = [
    ["insert", { key: "apple", value: "4" }],
    ["insert", { key: "pear", value: "8" }],
    ["insert", { key: "ab", value: "1" }],
    ["insert", { key: "ba", value: "2" }],
    ["update", { key: "apple", value: "9" }],
    ["delete", { key: "pear" }],
    ["insert", { key: "plum", value: "3" }],
    ["search", { key: "ab" }],
    ["contains", { key: "pear" }],
    ["insert", { key: "apple", value: "10" }],
  ];
  for (const { id } of HASH_STRATEGIES) {
    let state = fresh({
      strategy: id,
      capacity: id === "double" ? 7 : 7,
      table: id === "chaining" ? Array.from({ length: 7 }, () => []) : Array(7).fill(null),
    });
    const firstRuns = [];
    for (const [op, input] of operations) {
      const result = run(state, op, input);
      assert.ok(!result.error, `${id}/${op}: ${result.error}`);
      firstRuns.push(result.frames);
      state = result.state;
      assert.ok(state.count <= state.capacity || id === "chaining");
      if (id === "chaining") {
        for (const [index, bucket] of state.table.entries()) {
          for (const entry of bucket) {
            assert.equal(bucketIndex(state.hashFn, entry.key, state.capacity), index);
          }
        }
      } else {
        assert.equal(state.table.length, state.capacity);
      }
    }
    assert.equal(state.count, 4);
    assertEveryKeyReadable(state, [
      { key: "apple", value: "10" },
      { key: "ab", value: "1" },
      { key: "ba", value: "2" },
      { key: "plum", value: "3" },
    ].filter((pair) => pair.key !== "pear"));

    // Replaying from the same start produces byte-identical frames.
    let replay = fresh({
      strategy: id,
      capacity: 7,
      table: id === "chaining" ? Array.from({ length: 7 }, () => []) : Array(7).fill(null),
    });
    for (const [index, [op, input]] of operations.entries()) {
      const result = run(replay, op, input);
      assert.deepEqual(result.frames, firstRuns[index], `${id}/${op} replays identically`);
      replay = result.state;
    }
  }
});

test("every frame is its own snapshot, and a failed operation leaves no partial state", () => {
  const start = fresh();
  const result = ok(start, "insert", { key: "apple", value: "4" });
  result.frames[0].state.table[5][0] = { key: "fake", value: "x" };
  assert.ok(!result.state.table[5].some((entry) => entry.key === "fake"), "frames do not share state");
  assert.equal(start.count, 0, "the input state was not mutated");

  const failed = run(start, "delete", { key: "" });
  assert.ok(failed.error);
  assert.equal(start.count, 0);
  assert.deepEqual(start, fresh());
});
