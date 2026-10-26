// The lessons are content, so the tests check the promises the index and the
// lesson page make: every lesson exists at a route, has something to teach,
// links to a program that really exists, and offers a checkpoint. A lesson
// with a broken example link is a dead end for a learner, which is exactly
// what these tests are here to prevent.
//
//   node --test src/pages/lessons.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { exampleById } from "../examples.js";
import { LESSON_ORDER, LESSON_SECTIONS, findLesson, lessonNeighbours } from "./lessons.js";

const BLOCK_KEYS = ["p", "h", "list", "note", "code"];

test("every section has an id, a title and at least one lesson", () => {
  const ids = new Set();
  for (const section of LESSON_SECTIONS) {
    assert.match(section.id, /^[a-z0-9-]+$/, `${section.title} has a URL-safe id`);
    assert.ok(!ids.has(section.id), `${section.id} is used once`);
    ids.add(section.id);
    assert.ok(section.title.trim().length > 0);
    assert.ok(section.lessons.length > 0, `${section.id} has a lesson`);
  }
});

test("every lesson is teachable and complete", () => {
  const ids = new Set();
  for (const lesson of LESSON_ORDER) {
    const where = `${lesson.section}/${lesson.id}`;
    assert.match(lesson.id, /^[a-z0-9-]+$/, `${where} has a URL-safe id`);
    assert.ok(!ids.has(lesson.id), `${where} is a unique lesson id`);
    ids.add(lesson.id);

    assert.ok(lesson.title.trim().length > 0, `${where} has a title`);
    assert.ok(lesson.summary.trim().length > 20, `${where} has a real summary`);
    assert.ok(lesson.objectives.length >= 2, `${where} lists at least two objectives`);
    assert.ok(lesson.body.length >= 3, `${where} has a body worth reading`);
    assert.ok(
      lesson.body.some((block) => block.p),
      `${where} explains itself in prose, not only bullet points`,
    );
    assert.ok(lesson.checkpoints.length >= 1, `${where} has a checkpoint`);
    for (const checkpoint of lesson.checkpoints) {
      assert.ok(checkpoint.q.trim().length > 0 && checkpoint.a.trim().length > 0);
    }
  }
});

test("every lesson links to a program the visualizer can open", () => {
  for (const lesson of LESSON_ORDER) {
    const example = exampleById(lesson.exampleId);
    assert.ok(example, `${lesson.section}/${lesson.id} points at a real example (${lesson.exampleId})`);
    assert.ok(example.code.trim().length > 0);
  }
});

test("content blocks use only the shapes the renderer understands", () => {
  for (const lesson of LESSON_ORDER) {
    for (const block of lesson.body) {
      const keys = Object.keys(block);
      assert.equal(keys.length, 1, `${lesson.id} has one kind of block at a time`);
      assert.ok(BLOCK_KEYS.includes(keys[0]), `${keys[0]} is a renderable block`);
      if (block.list) {
        assert.ok(block.list.length >= 2, `${lesson.id} lists more than one item`);
        assert.ok(block.list.every((item) => item.trim().length > 0));
      }
    }
  }
});

test("no lesson still says it is unwritten", () => {
  for (const lesson of LESSON_ORDER) {
    const text = JSON.stringify(lesson).toLowerCase();
    for (const phrase of ["not built yet", "not written yet", "coming soon", "todo", "lorem"]) {
      assert.ok(!text.includes(phrase), `${lesson.id} does not contain "${phrase}"`);
    }
  }
});

test("a lesson is found by its section and id, and nothing else", () => {
  const lesson = findLesson("getting-started", "introduction");
  assert.ok(lesson);
  assert.equal(lesson.title, "Introduction to CodeLens");
  assert.equal(findLesson("getting-started", "nope"), null);
  assert.equal(findLesson("nope", "introduction"), null);
  assert.equal(findLesson("", ""), null);
});

test("the previous and next links walk every lesson exactly once", () => {
  assert.equal(LESSON_ORDER.length, 7, "this release ships seven lessons");
  const first = lessonNeighbours(LESSON_ORDER[0].section, LESSON_ORDER[0].id);
  assert.equal(first.previous, null);
  assert.equal(first.next?.id, LESSON_ORDER[1].id);
  const last = lessonNeighbours(
    LESSON_ORDER.at(-1).section,
    LESSON_ORDER.at(-1).id,
  );
  assert.equal(last.next, null);
  assert.equal(last.previous?.id, LESSON_ORDER.at(-2).id);

  for (let i = 1; i < LESSON_ORDER.length - 1; i += 1) {
    const entry = LESSON_ORDER[i];
    const neighbours = lessonNeighbours(entry.section, entry.id);
    assert.equal(neighbours.previous?.id, LESSON_ORDER[i - 1].id);
    assert.equal(neighbours.next?.id, LESSON_ORDER[i + 1].id);
  }
});
