// Unit tests for the algorithm-region layout (src/visualizer/stageLayout.js).
//
//   node --test src/visualizer/stageLayout.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { algorithmLayout } from "./stageLayout.js";

const mergeCombine = [
  { id: "sequence" },
  { id: "sequence-left" },
  { id: "sequence-right" },
];

test("a merge combine keeps the result above both inputs", () => {
  assert.deepEqual(
    mergeCombine.map((region) => region.id),
    ["sequence", "sequence-left", "sequence-right"],
  );
  assert.equal(algorithmLayout(mergeCombine), "split");
});

test("other region counts keep their previous arrangement", () => {
  assert.equal(algorithmLayout(mergeCombine.slice(0, 2)), "pair");
  assert.equal(algorithmLayout(mergeCombine.slice(0, 1)), "single");
  assert.equal(algorithmLayout([]), "single");
  assert.equal(algorithmLayout(undefined), "single");
});
