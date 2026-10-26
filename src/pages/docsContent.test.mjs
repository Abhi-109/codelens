// The documentation is content, so the tests check the promises it makes:
// every page has a route, a real body, and the lists it claims to generate
// (visualization modes, Inspect tabs) really are complete. A page that silently
// misses a mode is a page that teaches the wrong product.
//
//   node --test src/pages/docsContent.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { INSPECTOR_TABS } from "../visualizer/workspace.js";
import { VIZ_LABELS, VIZ_MODES } from "../visualizer/vizMode.js";
import { DOC_PAGES, docBySlug } from "./docsContent.js";

const BLOCK_KEYS = ["p", "h", "list", "note", "code"];

const textOf = (page) => JSON.stringify(page);

test("every page has a unique slug, a title and a summary", () => {
  const slugs = new Set();
  for (const page of DOC_PAGES) {
    assert.match(page.slug, /^[a-z0-9-]+$/, `${page.title} has a URL-safe slug`);
    assert.ok(!slugs.has(page.slug), `${page.slug} is used once`);
    slugs.add(page.slug);
    assert.ok(page.title.trim().length > 0);
    assert.ok(page.summary.trim().length > 20, `${page.slug} has a real summary`);
  }
});

test("every page has a body worth reading", () => {
  for (const page of DOC_PAGES) {
    assert.ok(page.blocks.length >= 4, `${page.slug} has more than a heading`);
    assert.ok(page.blocks.some((block) => block.p), `${page.slug} explains in prose`);
    assert.ok(page.blocks.some((block) => block.h), `${page.slug} is organised in sections`);
  }
});

test("content blocks use only the shapes the renderer understands", () => {
  for (const page of DOC_PAGES) {
    for (const block of page.blocks) {
      const keys = Object.keys(block);
      assert.equal(keys.length, 1, `${page.slug} has one kind of block at a time`);
      assert.ok(BLOCK_KEYS.includes(keys[0]), `${page.slug} uses a renderable ${keys[0]}`);
      if (block.list) {
        assert.ok(block.list.length >= 2, `${page.slug} lists more than one item`);
        assert.ok(block.list.every((item) => item.trim().length > 0));
      }
    }
  }
});

test("the visualizer page explains every mode and every Inspect tab", () => {
  const page = docBySlug("python-visualizer");
  assert.ok(page, "the visualizer page exists");
  const text = textOf(page);
  for (const mode of VIZ_MODES) {
    assert.ok(text.includes(VIZ_LABELS[mode]), `${mode} is documented`);
  }
  for (const tab of INSPECTOR_TABS) {
    assert.ok(text.includes(tab.label), `${tab.label} is documented`);
  }
});

test("no documentation page still says it is unwritten", () => {
  for (const page of DOC_PAGES) {
    const text = textOf(page).toLowerCase();
    for (const phrase of ["not built yet", "not written yet", "coming soon", "todo", "lorem"]) {
      assert.ok(!text.includes(phrase), `${page.slug} does not contain "${phrase}"`);
    }
  }
});

test("the data-structure page states that its steps are not a Python trace", () => {
  const page = docBySlug("data-structures");
  assert.ok(page);
  const text = textOf(page).toLowerCase();
  assert.ok(text.includes("not the python tracer"), "it says the lab is separate");
  assert.ok(text.includes("python"), "it names Python when drawing the distinction");
});

test("a page is found by its slug, and nothing else", () => {
  assert.equal(docBySlug("getting-started")?.title, "Getting started");
  assert.equal(docBySlug("nope"), null);
  assert.equal(docBySlug(""), null);
  assert.equal(docBySlug(undefined), null);
});
