// The language page's central promise: Python is the only language that
// works, and nothing on the page may imply otherwise. Every other entry is
// visibly "Coming soon", carries no link, and no entry uses a third-party
// or trademarked logo.
//
//   node --test src/pages/languages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { LANGUAGES, AVAILABLE_LANGUAGE, FEATURES } from "./languages.js";

test("Python is the only available language", () => {
  assert.equal(AVAILABLE_LANGUAGE.length, 1, "exactly one language may be available");
  assert.equal(AVAILABLE_LANGUAGE[0].id, "python");
  assert.equal(AVAILABLE_LANGUAGE[0].name, "Python");
});

test("the available language is the only one that links to a visualizer", () => {
  for (const lang of LANGUAGES) {
    if (lang.id === "python") {
      assert.equal(lang.href, "/visualizer/python", "Python must open the Python visualizer");
      assert.equal(lang.status, "available");
    } else {
      assert.equal(lang.status, "coming-soon", `${lang.name} must be marked coming soon`);
      assert.equal(lang.href, null, `${lang.name} must not link anywhere (it does not work yet)`);
    }
  }
});

test("the grid covers the planned languages with unique ids and monograms", () => {
  const ids = LANGUAGES.map((lang) => lang.id);
  assert.equal(new Set(ids).size, ids.length, "language ids must be unique");

  for (const lang of LANGUAGES) {
    assert.ok(lang.name?.length > 0, `${lang.id} needs a name`);
    assert.ok(lang.monogram?.length > 0, `${lang.id} needs a monogram`);
    assert.ok(lang.tagline?.length > 0, `${lang.id} needs a tagline`);
    assert.equal(typeof lang.soon, "undefined", "soon is derived from status, not stored twice");
  }
});

test("no language entry uses a third-party logo or an external asset", () => {
  for (const lang of LANGUAGES) {
    const blob = JSON.stringify(lang);
    assert.doesNotMatch(blob, /https?:\/\//, `${lang.id} must not reference an external URL`);
    assert.doesNotMatch(blob, /\.(png|jpg|jpeg|svg|webp)"/, `${lang.id} must not ship an image`);
  }
});

test("the homepage features are the four the plan promises, last one 'soon'", () => {
  const titles = FEATURES.map((feature) => feature.title);
  assert.equal(FEATURES.length, 4);
  assert.deepEqual(titles, [
    "Step-by-step execution",
    "Visualise variables",
    "Function call stack",
    "Supports multiple languages",
  ]);
  assert.deepEqual(
    FEATURES.map((feature) => feature.soon),
    [false, false, false, true],
    "only the multi-language feature is not built yet",
  );
});
