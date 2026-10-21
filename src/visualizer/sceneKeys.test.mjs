import assert from "node:assert/strict";
import test from "node:test";

import { highlightMap, slotKey } from "./sceneKeys.js";

test("a scene highlight matches its slot even though one uses id and the other objectId", () => {
  const tones = highlightMap([
    { kind: "slot", id: "o1", index: 1, tone: "focus" },
  ]);
  assert.equal(tones.get(slotKey({ objectId: "o1", index: 1 })), "focus");
  assert.equal(tones.get(slotKey({ objectId: "o1", index: 0 })), undefined);
});

test("non-slot highlights are ignored", () => {
  const tones = highlightMap([{ kind: "change", id: "i", line: 3 }]);
  assert.equal(tones.size, 0);
});
