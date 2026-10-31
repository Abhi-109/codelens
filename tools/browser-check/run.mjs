// Browser checks for the motion canvas: one command, no npm dependency.
//
//   npm run check:browser
//
// Starts the Vite dev server and a headless Chrome, drives the real app through
// the same steps a learner would, and asserts what the canvas shows. This is the
// regression test for the interruption fix: the effect ordering in MotionStage
// can only be exercised against real layout, so it cannot live in `npm run
// test:js` (which is node-only, with no jsdom dependency).
//
// CHROME_PATH overrides the browser; screenshots go to the OS temp directory.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { freePort, launch } from "./cdp.mjs";

const ROOT = new URL("../../", import.meta.url);
const OUT = join(tmpdir(), "codelens-browser-shots");

// --- programs ---------------------------------------------------------------

const BUBBLE = `numbers = [4, 2, 5, 1, 3]

for i in range(len(numbers)):
    for j in range(len(numbers) - i - 1):
        if numbers[j] > numbers[j + 1]:
            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]

print(numbers)
`;

// Two swaps of the same pair, one step apart: the interruption regression.
const ADJACENT = `a = [1, 2, 3]
a[0], a[1] = a[1], a[0]
a[0], a[1] = a[1], a[0]
print(a)
`;

const LONG_ARRAY = `values = [1000000 + i * 7 for i in range(24)]
total = sum(values)
print(total)
`;

const LONG_STRING = `words = ["a" * 90, "b" * 90, "c" * 90]
first = words[0]
print(first)
`;

// A dictionary program and a program with no collections at all: the canvas
// must stay useful without a list to animate.
const DICT = `ages = {'Asha': 12, 'Ravi': 13}
ages['Meera'] = 11
del ages['Ravi']
print(ages)
`;

const SCALARS = `total = 0
for n in range(1, 5):
    if n % 2 == 0:
        total = total + n
print(total)
`;

// The reported regression: a returned string and its printed output, neither
// of which had a place on the canvas before.
const GREET = `def greet(name):
    message = "Hello, " + name
    return message

print(greet("Asha"))
`;

// Recursion the tracer really made, so the planner may open the call tree.
const RECURSION = `def fact(n):
    if n < 2:
        return 1
    return n * fact(n - 1)

print(fact(5))
`;

// The three reference shapes: a chain, a binary tree and a cyclic graph.
const LINKED = `class Node:
    def __init__(self, value):
        self.value = value
        self.next = None

a = Node(1)
b = Node(2)
c = Node(3)
a.next = b
b.next = c
current = a
while current:
    print(current.value)
    current = current.next
`;
const TREE = `class Node:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

root = Node(5)
root.left = Node(3)
root.right = Node(8)
print(root.value, root.left.value, root.right.value)
`;
const GRAPH = `class Node:
    def __init__(self, value):
        self.value = value
        self.edges = []

a = Node("A")
b = Node("B")
c = Node("C")
a.edges = [b, c]
b.edges = [c]
c.edges = [a]
print(a.value, b.value, c.value)
`;

// --- assertions -------------------------------------------------------------

const failures = [];
const checks = [];

function check(ok, label, detail = "") {
  checks.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

// --- page helpers -----------------------------------------------------------

const CELLS = ".motion-object.is-sequence .motion-slot.motion-cell";

function readStage(browser) {
  return browser.evaluate(`(() => {
    const stage = document.querySelector(".motion-stage");
    const cells = [...stage.querySelectorAll(${JSON.stringify(CELLS)})].map((el) => {
      const style = getComputedStyle(el);
      const value = el.querySelector(".motion-cell-value");
      const rect = el.getBoundingClientRect();
      return {
        i: el.querySelector(".motion-cell-index")?.textContent,
        v: value?.textContent,
        title: value?.getAttribute("title"),
        cls: [...el.classList].filter((c) => c.startsWith("is-")),
        transform: style.transform,
        border: style.borderColor,
        shadow: style.boxShadow,
        indexColor: getComputedStyle(el.querySelector(".motion-cell-index")).color,
        left: Math.round(rect.left * 10) / 10,
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        clipped: value ? value.scrollWidth > value.clientWidth + 1 : false,
      };
    });
    const row = stage.querySelector(".motion-object.is-sequence .motion-slots");
    const explain = stage.querySelector(".motion-explain");
    const frame = stage.querySelector(".motion-frame");
    return {
      index: Number(document.querySelector('input[aria-label="Step"]').value),
      max: Number(document.querySelector('input[aria-label="Step"]').max),
      cells,
      head: stage.querySelector(".motion-stage-head")?.innerText.replace(/\\n/g, " | ") ?? null,
      explanation: explain?.textContent ?? null,
      explainTop: explain ? Math.round(explain.getBoundingClientRect().top) : null,
      rowBottom: row ? Math.round(row.getBoundingClientRect().bottom) : null,
      stageBottom: Math.round(stage.getBoundingClientRect().bottom),
      rowScrolls: row ? row.scrollWidth > row.clientWidth + 1 : false,
      rowScrollWidth: row?.scrollWidth ?? null,
      rowClientWidth: row?.clientWidth ?? null,
      noValues: Boolean(stage.querySelector(".motion-no-values")),
      scalars: [...stage.querySelectorAll(".motion-scalar")].map((el) => ({
        name: el.querySelector(".motion-scalar-name")?.textContent,
        value: el.querySelector(".motion-scalar-value")?.textContent,
        type: el.querySelector(".motion-scalar-type")?.textContent,
        changed: el.classList.contains("is-changed"),
      })),
      scalarsMore: stage.querySelector(".motion-scalars-more")?.textContent ?? null,
      returnFunction: stage.querySelector(".motion-return-fn")?.textContent ?? null,
      returnValue: stage.querySelector(".motion-return-value")?.textContent ?? null,
      output: stage.querySelector(".motion-output-text")?.textContent ?? null,
      result: stage.querySelector(".motion-result-status")?.textContent ?? null,
      resultDetail: stage.querySelector(".motion-result-detail")?.textContent ?? null,
      resultNote: stage.querySelector(".motion-result-note")?.textContent ?? null,
      objects: [...stage.querySelectorAll(".motion-object")].map((el) => ({
        type: el.querySelector(".motion-object-type")?.textContent,
        label: el.querySelector(".motion-object-label")?.textContent,
        slots: [...el.querySelectorAll(".motion-slot")].map((slot) => slot.textContent),
        empty: Boolean(el.querySelector(".motion-object-empty")),
      })),
      variables: [...stage.querySelectorAll(".motion-var")].map((el) => el.textContent),
      frameCount: stage.querySelectorAll(".motion-frame").length,
      frameScrolls: frame ? frame.scrollWidth > frame.clientWidth + 1 : false,
      ghosts: [...stage.querySelectorAll(".motion-ghost")].map((el) => ({
        visible: getComputedStyle(el).visibility,
        opacity: getComputedStyle(el).opacity,
      })),
      animations: document.getAnimations().length,
      colors: {
        warn: getComputedStyle(stage).getPropertyValue("--warn").trim(),
        accent: getComputedStyle(stage).getPropertyValue("--accent").trim(),
        compare: getComputedStyle(stage).getPropertyValue("--compare-ring").trim(),
        ok: getComputedStyle(stage).getPropertyValue("--ok").trim(),
      },
      theme: document.documentElement.getAttribute("data-theme"),
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  })()`);
}

const moved = (cell) =>
  cell.transform !== "none" && cell.transform !== "matrix(1, 0, 0, 1, 0, 0)";

/** A CSS custom property's hex value as the rgb() string the DOM reports. */
const rgbOf = (hex) => {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const translateX = (transform) => {
  const match = /matrix\(([^)]+)\)/.exec(transform);
  return match ? Number(match[1].split(",")[4]) : 0;
};

async function seek(browser, index) {
  await browser.setValue('input[aria-label="Step"]', index);
  await sleep(350);
}

/** Open a fresh program in the workspace and show its motion canvas. */
async function openProgram(browser, source) {
  // After a run the code pane shows the executed lines instead of the editor.
  await browser.evaluate(`(() => {
    const edit = [...document.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Edit",
    );
    if (edit) edit.click();
    return Boolean(edit);
  })()`);
  await browser.waitFor(
    `document.querySelector('textarea[aria-label="Your Python code"]')`,
    15000,
    "the code editor",
  );
  await browser.setValue(
    'textarea[aria-label="Your Python code"]',
    source,
    "HTMLTextAreaElement",
  );
  await browser.click("button.run");
  await browser.waitFor(
    `!document.querySelector('textarea[aria-label="Your Python code"]')`,
    120000,
    "the code pane to switch to the executed trace",
  );
  await browser.waitFor(
    `(() => {
      const input = document.querySelector('input[aria-label="Step"]');
      return Boolean(input) && !input.disabled;
    })()`,
    120000,
    "a steppable trace",
  );
  await browser.clickText("Motion");
  await sleep(400);
}

/** Open a fresh program without touching the canvas strip. */
async function openPlanned(browser, source) {
  await browser.evaluate(`(() => {
    const edit = [...document.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Edit",
    );
    if (edit) edit.click();
    return Boolean(edit);
  })()`);
  await browser.waitFor(
    `document.querySelector('textarea[aria-label="Your Python code"]')`,
    15000,
    "the code editor",
  );
  await browser.setValue(
    'textarea[aria-label="Your Python code"]',
    source,
    "HTMLTextAreaElement",
  );
  await browser.click("button.run");
  await browser.waitFor(
    `!document.querySelector('textarea[aria-label="Your Python code"]')`,
    120000,
    "the code pane to switch to the executed trace",
  );
  await browser.waitFor(
    `(() => {
      const input = document.querySelector('input[aria-label="Step"]');
      return Boolean(input) && !input.disabled;
    })()`,
    120000,
    "a steppable trace",
  );
  await sleep(400);
}

const selectedCanvas = (browser) =>
  browser.evaluate(`"Motion"`);

const planHint = (browser) =>
  browser.evaluate(`document.querySelector(".viz-hint")?.textContent.trim() ?? null`);

async function reloadWorkspace(browser) {
  await browser.evaluate("location.reload()");
  await browser.waitFor(
    `document.querySelector('textarea[aria-label="Your Python code"]')`,
    60000,
    "the code editor after reload",
  );
}

/** Sample every animation frame for `ms`, from the app's own DOM. */
function startSampler(browser, ms = 800) {
  return browser.evaluate(`(() => {
    window.__samples = [];
    const started = performance.now();
    const tick = () => {
      const stage = document.querySelector(".motion-stage");
      const cells = [...stage.querySelectorAll(${JSON.stringify(CELLS)})].map((el) => ({
        i: el.querySelector(".motion-cell-index")?.textContent,
        v: el.querySelector(".motion-cell-value")?.textContent,
        left: Math.round(el.getBoundingClientRect().left * 10) / 10,
        transform: getComputedStyle(el).transform,
      }));
      window.__samples.push({
        t: Math.round(performance.now() - started),
        index: Number(document.querySelector('input[aria-label="Step"]').value),
        explanation: stage.querySelector(".motion-explain")?.textContent ?? null,
        cells,
      });
      if (performance.now() - started < ${ms}) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
}

const samples = (browser) => browser.evaluate("window.__samples");

/**
 * Wait until a swapping cell has travelled `threshold` pixels of its slot.
 * A fixed sleep is not enough: at 4x the whole swap can finish first, and then
 * there is nothing to interrupt. A swap's keyframe starts at the far slot and
 * moves to zero, so progress is `slot - |translateX|`, not the transform.
 */
async function waitForProgress(browser, threshold) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const progress = await browser.evaluate(`(() => {
      const cells = [...document.querySelectorAll(${JSON.stringify(CELLS)})];
      const info = cells.map((el) => {
        const match = /matrix\\(([^)]+)\\)/.exec(getComputedStyle(el).transform);
        const x = match ? Number(match[1].split(",")[4]) : 0;
        return { offset: Math.abs(x), layout: el.getBoundingClientRect().left - x };
      }).filter((entry) => entry.offset > 0.5);
      if (info.length < 2) return { travelled: 0, slot: 0 };
      const slot = Math.abs(info[0].layout - info[1].layout);
      const offset = Math.max(...info.map((entry) => entry.offset));
      return { travelled: Math.max(0, slot - offset), slot };
    })()`);
    if (progress.travelled >= threshold) return progress;
    await sleep(8);
  }
  return { travelled: 0, slot: 0 };
}

// --- planner: automatic choice, manual override, no stale plan -------------

async function planner(browser) {
  // A scalar run: no specialized pattern was proven, so Motion stays.
  await openPlanned(browser, SCALARS);
  check(
    (await selectedCanvas(browser)) === "Motion",
    "the planner opens a scalar run on Motion",
    String(await selectedCanvas(browser)),
  );
  check(
    /no specialized pattern was proven/.test((await planHint(browser)) ?? ""),
    "the why-line says the choice was generic",
    String(await planHint(browser)),
  );

  // A real sorting run: the adaptive canvas is the honest choice.
  await openPlanned(browser, BUBBLE);
  check(
    (await selectedCanvas(browser)) === "Motion",
    "the planner opens a recognized sort on Motion",
    String(await selectedCanvas(browser)),
  );
  check(
    /sorting comparisons/.test((await planHint(browser)) ?? ""),
    "the why-line names the observed sorting evidence",
    String(await planHint(browser)),
  );

  // Motion is the only canvas now: the planner still selects an internal
  // renderer, but there is no tab to switch and no manual canvas choice.
  await seek(browser, 4);
  const beforeSwitch = await browser.evaluate(
    `Number(document.querySelector('input[aria-label="Step"]').value)`,
  );
  check(
    (await browser.evaluate(`Number(document.querySelector('input[aria-label="Step"]').value)`)) ===
      beforeSwitch,
    "the shared cursor is preserved",
    `${beforeSwitch}`,
  );

  // A fresh visit has no manual pin: recursion is planned, and Motion renders it.
  await reloadWorkspace(browser);
  await openPlanned(browser, RECURSION);
  check(
    (await selectedCanvas(browser)) === "Motion",
    "Motion is the only canvas",
    String(await selectedCanvas(browser)),
  );
  check(
    /same function ran at more than one depth/.test((await planHint(browser)) ?? ""),
    "the why-line names the observed recursion",
    String(await planHint(browser)),
  );

  const recursiveMax = await browser.evaluate(
    `Number(document.querySelector('input[aria-label="Step"]').max)`,
  );
  await seek(browser, Math.min(3, recursiveMax));
  check(
    (await browser.evaluate(`Number(document.querySelector('input[aria-label="Step"]').value)`)) ===
      Math.min(3, recursiveMax),
    "the shared cursor works on an automatically chosen canvas",
  );

  await openPlanned(browser, SCALARS);
  check(
    (await selectedCanvas(browser)) === "Motion",
    "a new program replaces the previous plan instead of reusing it",
    String(await selectedCanvas(browser)),
  );
  check(
    /no specialized pattern/.test((await planHint(browser)) ?? ""),
    "the new program's why-line replaces the old one",
    String(await planHint(browser)),
  );

  // No provider is configured in this build, so the deterministic path is all
  // that runs; there is no request to fail and nothing to hide.
  check(
    (await browser.evaluate("window.__CODELENS_PLANNER_ENDPOINT__ ?? null")) === null,
    "AI planning is off unless a public endpoint is configured",
  );

  await reloadWorkspace(browser);
}

async function interruption(browser) {
  console.log("\n--- interruption: two adjacent swaps ---");
  await openProgram(browser, ADJACENT);

  const max = (await readStage(browser)).max;
  const steps = [];
  for (let index = 0; index <= max; index += 1) {
    await seek(browser, index);
    const state = await readStage(browser);
    steps.push({ index, active: state.cells.filter((c) => c.cls.includes("is-active")).length });
  }
  const swapSteps = steps.filter((step) => step.active > 0).map((step) => step.index);
  check(swapSteps.length === 2, "the program records two swaps", swapSteps.join(","));
  const [first, second] = swapSteps;
  check(second === first + 1, "the two swaps are adjacent steps", `${first} -> ${second}`);

  // Normal speed: start the first swap, interrupt it with the second.
  await seek(browser, first - 1);
  await startSampler(browser, 800);
  await browser.click('button[aria-label="Step forward"]');
  const progress = await waitForProgress(browser, 18);
  const mid = await readStage(browser);
  check(mid.index === first, "the first swap is in flight", String(mid.index));
  check(
    progress.travelled >= 18,
    "the first swap has moved before the interruption",
    `${Math.round(progress.travelled)}px of ${Math.round(progress.slot)}px`,
  );

  await browser.click('button[aria-label="Step forward"]');
  await sleep(700);
  const run = await samples(browser);
  const atFirst = run.filter((sample) => sample.index === first);
  const atSecond = run.filter((sample) => sample.index === second);
  check(atSecond.length > 0, "the second swap was sampled", `${atSecond.length} frames`);
  check(atFirst.length > 0, "the first swap was sampled", `${atFirst.length} frames`);

  // The regression: React runs the old effect's cleanup before the new effect
  // measures. Cancelling there drew each value at its layout slot again, so the
  // value jumped by exactly the distance still left to travel. With the fix the
  // jump is at most one animation frame, so half the remaining distance is a
  // tolerance that a real interruption cannot reach.
  const last = atFirst[atFirst.length - 1];
  const next = atSecond[0];
  const lastOffset = Math.max(
    ...(last?.cells ?? []).map((cell) => Math.abs(translateX(cell.transform))),
  );
  check(
    lastOffset > 12,
    "the interruption lands while the swap is still moving",
    `${Math.round(lastOffset)}px still to travel`,
  );
  const drawnAt = (sample, value) =>
    sample?.cells.find((cell) => cell.v === value)?.left ?? null;
  for (const value of ["1", "2"]) {
    const from = drawnAt(last, value);
    const to = drawnAt(next, value);
    check(
      from !== null && to !== null && near(from, to, Math.max(6, lastOffset / 2)),
      `value ${value} continues from where it was drawn`,
      `${from}px -> ${to}px (${Math.round(lastOffset)}px still to travel)`,
    );
  }

  const settled = await readStage(browser);
  check(settled.index === second, "the interrupted run lands on the second swap", String(settled.index));
  check(
    settled.cells.map((cell) => cell.v).join(",") === "1,2,3",
    "the two swaps restore the array",
    settled.cells.map((cell) => cell.v).join(","),
  );
  check(
    settled.cells.every((cell) => !moved(cell)),
    "no transform remains after the interruption",
    settled.cells.map((cell) => cell.transform).join(" | "),
  );
  check(
    settled.cells.filter((cell) => cell.cls.includes("is-active")).length === 2,
    "exactly the two swapped cells stay blue",
    settled.cells.map((cell) => cell.cls.join(",")).join(" | "),
  );
  check(
    settled.ghosts.every((ghost) => ghost.visible === "hidden" || ghost.opacity === "0"),
    "no stale ghost after the interruption",
    JSON.stringify(settled.ghosts),
  );
  await browser.screenshot("interruption-settled");

  // Back mid-move: the result must match an undisturbed Back exactly. A stale
  // ring or sentence would show up as a difference from this reference.
  await seek(browser, first);
  await browser.click('button[aria-label="Step back"]');
  await sleep(600);
  const reference = await readStage(browser);

  await seek(browser, first - 1);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(70);
  await browser.click('button[aria-label="Step back"]');
  await sleep(600);
  const back = await readStage(browser);
  check(back.index === first - 1, "Back mid-move returns to the previous step", String(back.index));
  check(
    back.cells.every((cell) => !moved(cell)),
    "Back mid-move leaves no transform",
    back.cells.map((cell) => cell.transform).join(" | "),
  );
  check(
    back.cells.map((cell) => cell.cls.join(",")).join("|") ===
      reference.cells.map((cell) => cell.cls.join(",")).join("|"),
    "Back mid-move shows exactly the undisturbed step's rings",
    `${back.cells.map((cell) => cell.cls.join(",")).join(" | ")} vs ${reference.cells.map((cell) => cell.cls.join(",")).join(" | ")}`,
  );
  check(
    back.explanation === reference.explanation,
    "Back mid-move shows exactly the undisturbed step's sentence",
    `${back.explanation} vs ${reference.explanation}`,
  );
  check(
    back.cells.map((cell) => cell.v).join(",") === reference.cells.map((cell) => cell.v).join(","),
    "Back mid-move restores the undisturbed step's values",
    back.cells.map((cell) => cell.v).join(","),
  );

  // Slider seek mid-move: jump far ahead and land exactly there.
  await seek(browser, first - 1);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(70);
  const target = Math.min(max, second + 2);
  await browser.setValue('input[aria-label="Step"]', target);
  await sleep(500);
  const sought = await readStage(browser);
  check(sought.index === target, "a slider seek lands on the selected step", String(sought.index));
  check(
    sought.cells.every((cell) => !moved(cell)),
    "a slider seek leaves no transform",
    sought.cells.map((cell) => cell.transform).join(" | "),
  );
  check(
    sought.cells.every((cell) => !cell.cls.includes("is-active")),
    "a slider seek shows no active ring",
    sought.cells.map((cell) => cell.cls.join(",")).join(" | "),
  );

  // Reset: first step clears every mark.
  await browser.click('button[aria-label="First step"]');
  await sleep(500);
  const reset = await readStage(browser);
  check(reset.index === 0, "reset returns to step 0", String(reset.index));
  check(
    reset.cells.every((cell) => cell.cls.length === 0),
    "reset clears active, compare and settled flags",
    reset.cells.map((cell) => cell.cls.join(",")).join(" | "),
  );
  check(reset.explanation === null, "reset clears the sentence", String(reset.explanation));
  check(
    reset.cells.every((cell) => !moved(cell)),
    "reset leaves no transform",
    reset.cells.map((cell) => cell.transform).join(" | "),
  );

  // 4x speed: the same interruption, shorter, still continuous.
  await browser.setValue('select[aria-label="Playback speed"]', "4", "HTMLSelectElement");
  await sleep(100);
  await seek(browser, first - 1);
  await startSampler(browser, 700);
  await browser.click('button[aria-label="Step forward"]');
  const fastProgress = await waitForProgress(browser, 5);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(700);
  const fastRun = await samples(browser);
  const fastMid = await readStage(browser);
  const fastSecond = fastRun.filter((sample) => sample.index === second);
  check(fastMid.index === second, "4x: the interruption lands on the second swap", String(fastMid.index));
  check(
    fastProgress.travelled >= 5,
    "4x: the first swap had moved before the interruption",
    `${Math.round(fastProgress.travelled)}px of ${Math.round(fastProgress.slot)}px`,
  );
  check(fastSecond.length > 0, "4x: the second swap was sampled", `${fastSecond.length} frames`);
  const fastLast = fastRun.filter((sample) => sample.index === first).at(-1);
  const fastNext = fastSecond[0];
  const fastLastOffset = Math.max(
    ...(fastLast?.cells ?? []).map((cell) => Math.abs(translateX(cell.transform))),
  );
  check(
    fastLastOffset > 12,
    "4x: the interruption lands while the swap is still moving",
    `${Math.round(fastLastOffset)}px still to travel`,
  );
  for (const value of ["1", "2"]) {
    const from = drawnAt(fastLast, value);
    const to = drawnAt(fastNext, value);
    check(
      from !== null && to !== null && near(from, to, Math.max(6, fastLastOffset / 2)),
      `4x: value ${value} continues from where it was drawn`,
      `${from}px -> ${to}px (${Math.round(fastLastOffset)}px still to travel)`,
    );
  }
  const fastSettled = await readStage(browser);
  check(fastSettled.index === second, "4x: lands on the second swap", String(fastSettled.index));
  check(
    fastSettled.cells.every((cell) => !moved(cell)),
    "4x: no transform remains",
    fastSettled.cells.map((cell) => cell.transform).join(" | "),
  );
  await browser.setValue('select[aria-label="Playback speed"]', "1", "HTMLSelectElement");
}

// --- B. swap, comparison, green, playback ----------------------------------

async function bubbleSort(browser) {
  console.log("\n--- bubble sort: swap, comparison, green, playback ---");
  await openProgram(browser, BUBBLE);

  // Comparison at step 5: gold operands, no movement.
  await seek(browser, 5);
  const compare = await readStage(browser);
  check(
    compare.cells.filter((cell) => cell.cls.includes("is-compare")).length === 2,
    "step 5 rings exactly two operands in gold",
    compare.cells.map((cell) => `${cell.i}:${cell.cls.join(",")}`).join(" "),
  );
  check(
    compare.cells.every((cell) => !cell.cls.includes("is-active")),
    "a comparison shows no operation ring",
    compare.cells.map((cell) => cell.cls.join(",")).join(" | "),
  );
  check(
    compare.cells.every((cell) => !moved(cell)),
    "a comparison keeps the array stationary",
    compare.cells.map((cell) => cell.transform).join(" | "),
  );
  check(
    compare.cells.map((cell) => cell.v).join(",") === "4,2,5,1,3",
    "a comparison does not change the array",
    compare.cells.map((cell) => cell.v).join(","),
  );
  check(
    /Compare 4 > 2/.test(compare.head ?? "") && /greater than/.test(compare.explanation ?? ""),
    "step 5 names the operands and the outcome",
    `${compare.head} / ${compare.explanation}`,
  );
  check(
    compare.explainTop !== null &&
      compare.rowBottom !== null,
    "the sentence sits directly under the array",
    `${compare.rowBottom} -> ${compare.explainTop}`,
  );
  await browser.screenshot("compare-5");

  // The false comparison: gold, still no movement.
  await seek(browser, 9);
  const falseCompare = await readStage(browser);
  check(
    falseCompare.cells.filter((cell) => cell.cls.includes("is-compare")).length === 2 &&
      falseCompare.cells.every((cell) => !moved(cell)),
    "a false comparison rings its operands and does not move the array",
    falseCompare.cells.map((cell) => `${cell.i}:${cell.cls.join(",")}`).join(" "),
  );

  // Swap 6 -> 7: blue pair, values attached, sentence from the first frame.
  await seek(browser, 6);
  await startSampler(browser, 800);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(800);
  const run = await samples(browser);
  const swapRun = run.filter((sample) => sample.index === 7);
  const moving = swapRun.filter((sample) => sample.cells.some(moved));
  check(run.length > 5, "the swap was sampled", `${run.length} frames`);
  check(moving.length > 0, "the swap actually moves cells", `${moving.length} moving frames`);
  const firstMoving = moving[0];
  const left = firstMoving?.cells.find((cell) => cell.i === "0");
  const right = firstMoving?.cells.find((cell) => cell.i === "1");
  check(
    translateX(left?.transform ?? "none") > 1 && translateX(right?.transform ?? "none") < -1,
    "the two cells travel opposite ways",
    `${left?.transform} / ${right?.transform}`,
  );
  check(
    left?.v === "2" && right?.v === "4",
    "values stay attached to their moving cells",
    `${left?.v} / ${right?.v}`,
  );
  check(
    swapRun.every((sample) => sample.explanation === "4 and 2 exchange places."),
    "the swap sentence is present from the first frame",
    swapRun[0]?.explanation,
  );

  const swapped = await readStage(browser);
  check(swapped.index === 7, "the swap lands on step 7", String(swapped.index));
  check(
    swapped.cells.map((cell) => cell.v).join(",") === "2,4,5,1,3",
    "the swap produces the real post-swap array",
    swapped.cells.map((cell) => cell.v).join(","),
  );
  check(
    swapped.cells.every((cell) => !moved(cell)),
    "no transform remains after the swap",
    swapped.cells.map((cell) => cell.transform).join(" | "),
  );
  check(
    swapped.cells[0].border === rgbOf(swapped.colors.accent) &&
      swapped.cells[1].border === rgbOf(swapped.colors.accent),
    "the blue ring persists after movement",
    `${swapped.cells[0].border} / ${swapped.cells[1].border}`,
  );
  check(
    swapped.ghosts.every((ghost) => ghost.visible === "hidden" || ghost.opacity === "0"),
    "no stale ghost after the swap",
    JSON.stringify(swapped.ghosts),
  );
  check(
    swapped.rowBottom !== null && swapped.rowBottom <= swapped.stageBottom + 1,
    "the array stays inside the visible canvas",
    `${swapped.rowBottom} <= ${swapped.stageBottom}`,
  );
  await browser.screenshot("swap-7");

  // Backward playback across the swap.
  await seek(browser, 7);
  await startSampler(browser, 700);
  await browser.click('button[aria-label="Step back"]');
  await sleep(700);
  const backRun = await samples(browser);
  const backMoving = backRun.filter((sample) => sample.cells.some(moved));
  check(backMoving.length > 0, "backward playback animates the swap", `${backMoving.length} frames`);
  const back = await readStage(browser);
  check(back.index === 6, "backward playback lands on step 6", String(back.index));
  check(
    back.cells.map((cell) => cell.v).join(",") === "4,2,5,1,3",
    "backward playback restores the pre-swap array",
    back.cells.map((cell) => cell.v).join(","),
  );
  check(
    back.cells.every((cell) => !moved(cell)),
    "backward playback lands with no transform",
    back.cells.map((cell) => cell.transform).join(" | "),
  );

  // Persistent green: layered with the operation ring, then with a comparison.
  await seek(browser, 17);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(500);
  const layered = await readStage(browser);
  const both = layered.cells.filter(
    (cell) => cell.cls.includes("is-active") && cell.cls.includes("is-settled"),
  );
  check(both.length === 1, "step 18 layers an operation over a proven final cell", `${both.length}`);
  check(
    both[0]?.shadow.includes(rgbOf(layered.colors.ok)) &&
      both[0]?.shadow.includes(rgbOf(layered.colors.accent)),
    "the layered cell keeps both the green inset and the blue outer ring",
    both[0]?.shadow,
  );
  check(
    both[0]?.indexColor === rgbOf(layered.colors.ok),
    "the settled index label stays green",
    both[0]?.indexColor,
  );

  await seek(browser, 22);
  const later = await readStage(browser);
  check(
    later.cells.find((cell) => cell.i === "4")?.cls.includes("is-settled"),
    "green survives a later comparison",
    `${later.cells.find((cell) => cell.i === "4")?.cls}`,
  );
  check(
    later.cells.filter((cell) => cell.cls.includes("is-compare")).length === 2,
    "the later comparison still rings its two operands in gold",
    later.cells.map((cell) => `${cell.i}:${cell.cls.join(",")}`).join(" "),
  );

  // Step 39 has operands that are all proven final: green inside, gold outside.
  await seek(browser, 39);
  const allGreen = await readStage(browser);
  const goldOnGreen = allGreen.cells.filter(
    (cell) => cell.cls.includes("is-compare") && cell.cls.includes("is-settled"),
  );
  check(goldOnGreen.length === 2, "step 39 compares two proven-final cells", `${goldOnGreen.length}`);
  check(
    goldOnGreen.every(
      (cell) =>
        cell.shadow.includes(rgbOf(allGreen.colors.ok)) &&
        cell.shadow.includes(rgbOf(allGreen.colors.compare)),
    ),
    "the gold ring sits outside the green inset ring",
    goldOnGreen.map((cell) => cell.shadow).join(" | "),
  );
  check(
    goldOnGreen.every((cell) => cell.indexColor === rgbOf(allGreen.colors.ok)),
    "a proven-final operand keeps its green index label",
    goldOnGreen.map((cell) => cell.indexColor).join(" | "),
  );

  // Final state: everything green, the sorted array.
  await seek(browser, 52);
  const final = await readStage(browser);
  check(
    final.cells.every((cell) => cell.cls.includes("is-settled")),
    "the verified final state is entirely green",
    final.cells.map((cell) => `${cell.v}:${cell.cls.join(",")}`).join(" "),
  );
  check(
    final.cells.map((cell) => cell.v).join(",") === "1,2,3,4,5",
    "the final array is [1,2,3,4,5]",
    final.cells.map((cell) => cell.v).join(","),
  );
  check(
    final.cells.every((cell) => !moved(cell)),
    "the final state has no transform",
    final.cells.map((cell) => cell.transform).join(" | "),
  );
  await browser.screenshot("final");
}

// --- C. speed, burst, themes, reduced motion, layout -----------------------

async function playbackAndLayout(browser) {
  console.log("\n--- speed, burst, themes, reduced motion, layout ---");
  await openProgram(browser, BUBBLE);

  // 4x speed: fewer moving frames than 1x, and it settles quickly.
  await seek(browser, 6);
  await startSampler(browser, 700);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(700);
  const normal = (await samples(browser)).filter((sample) => sample.cells.some(moved));
  await browser.setValue('select[aria-label="Playback speed"]', "4", "HTMLSelectElement");
  await sleep(100);
  const speed = await browser.evaluate(
    `document.querySelector('select[aria-label="Playback speed"]').value`,
  );
  check(speed === "4", "playback speed is set to 4x", speed);
  await seek(browser, 6);
  await startSampler(browser, 700);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(700);
  const fast = (await samples(browser)).filter((sample) => sample.cells.some(moved));
  check(fast.length > 0, "4x still animates the swap", `${fast.length} frames`);
  check(
    fast.length < normal.length,
    "4x is shorter than 1x",
    `${fast.length} vs ${normal.length} frames`,
  );
  const fastDone = await readStage(browser);
  check(
    fastDone.cells.every((cell) => !moved(cell)),
    "4x settles with no transform",
    fastDone.cells.map((cell) => cell.transform).join(" | "),
  );

  // A burst of steps must not queue animations: exactly the clicks advance the
  // cursor, and nothing is left running afterwards.
  await seek(browser, 6);
  const burstStart = 6;
  for (let i = 0; i < 12; i += 1) {
    await browser.click('button[aria-label="Step forward"]');
  }
  const during = await readStage(browser);
  check(
    during.index === burstStart + 12,
    "12 rapid clicks advance exactly 12 steps",
    String(during.index),
  );
  check(
    during.animations < 40,
    "a burst does not accumulate an animation queue",
    `${during.animations} animations`,
  );
  await sleep(900);
  const afterBurst = await readStage(browser);
  check(
    afterBurst.cells.every((cell) => !moved(cell)) && afterBurst.animations <= 2,
    "the burst leaves nothing running",
    `${afterBurst.animations} animations, ${afterBurst.cells.map((cell) => cell.transform).join(" | ")}`,
  );
  await browser.setValue('select[aria-label="Playback speed"]', "1", "HTMLSelectElement");

  // Themes.
  const toggle = () =>
    browser.evaluate(`(() => {
      const el = [...document.querySelectorAll("button")].find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith("Switch to"),
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);
  check(await toggle(), "theme toggle exists");
  await sleep(300);
  const light = await readStage(browser);
  check(light.theme === "light", "light theme applies", String(light.theme));
  check(
    light.colors.warn !== light.colors.accent &&
      light.colors.accent !== light.colors.ok &&
      light.colors.warn !== light.colors.ok,
    "gold, blue and green stay distinct in light theme",
    JSON.stringify(light.colors),
  );
  await seek(browser, 22);
  const lightLater = await readStage(browser);
  check(
    lightLater.cells.filter((cell) => cell.cls.includes("is-compare")).length === 2 &&
      lightLater.cells.some((cell) => cell.cls.includes("is-settled")),
    "light theme shows gold operands and persistent green",
    lightLater.cells.map((cell) => `${cell.i}:${cell.cls.join(",")}`).join(" "),
  );
  await browser.screenshot("light");
  check(await toggle(), "theme toggles back");
  await sleep(300);
  check((await readStage(browser)).theme === "dark", "dark theme restores");

  // Reduced motion: static rings and the sentence, no movement.
  await browser.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await sleep(300);
  await seek(browser, 6);
  await browser.click('button[aria-label="Step forward"]');
  await sleep(150);
  const reduced = await readStage(browser);
  check(reduced.reduced, "reduced-motion preference is live", String(reduced.reduced));
  check(
    reduced.cells.every((cell) => !moved(cell)),
    "reduced motion disables movement",
    reduced.cells.map((cell) => cell.transform).join(" | "),
  );
  check(
    reduced.cells.filter((cell) => cell.cls.includes("is-active")).length === 2,
    "reduced motion keeps the static blue ring",
    reduced.cells.map((cell) => cell.cls.join(",")).join(" | "),
  );
  check(
    reduced.explanation === "4 and 2 exchange places.",
    "reduced motion keeps the sentence",
    reduced.explanation,
  );
  await browser.screenshot("reduced");
  await browser.send("Emulation.setEmulatedMedia", { features: [] });
  await sleep(200);

  // Long array: one row, horizontal scroll, no page overflow.
  await openProgram(browser, LONG_ARRAY);
  const longMax = (await readStage(browser)).max;
  await seek(browser, longMax);
  const long = await readStage(browser);
  const tops = new Set(long.cells.map((cell) => cell.top));
  check(long.cells.length >= 20, "a long list renders many cells", `${long.cells.length}`);
  check(tops.size === 1, "a long list stays on one row", `tops ${[...tops].join(",")}`);
  check(
    long.rowScrolls,
    "a long list scrolls horizontally",
    `${long.rowClientWidth}/${long.rowScrollWidth}`,
  );
  check(!long.bodyOverflow, "a long list does not overflow the page");
  await browser.screenshot("long-array");

  // Long strings: ellipsized inside the cell, full text in the tooltip.
  await openProgram(browser, LONG_STRING);
  const stringMax = (await readStage(browser)).max;
  await seek(browser, stringMax);
  const strings = await readStage(browser);
  check(strings.cells.length >= 3, "long strings render as cells", `${strings.cells.length}`);
  check(
    strings.cells.slice(0, 3).every((cell) => (cell.title ?? "").length > 40),
    "a long string keeps its full text in the tooltip",
    strings.cells.slice(0, 3).map((cell) => (cell.title ?? "").length).join(","),
  );
  check(
    strings.cells.slice(0, 3).every((cell) => !cell.clipped),
    "a long string is ellipsized inside its cell, not spilled",
    strings.cells.slice(0, 3).map((cell) => `${cell.v?.length}:${cell.clipped}`).join(","),
  );

  // Narrow layout: cells stay readable and the page does not scroll sideways.
  await openProgram(browser, BUBBLE);
  await browser.send("Emulation.setDeviceMetricsOverride", {
    width: 720,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(400);
  const narrow = await readStage(browser);
  check(!narrow.bodyOverflow, "the 720px layout does not overflow the page");
  check(
    narrow.cells.every((cell) => cell.width >= 60),
    "the 720px layout keeps cells readable",
    narrow.cells.slice(0, 4).map((cell) => cell.width).join(","),
  );
  check(
    !narrow.frameScrolls,
    "the call strip does not widen the canvas",
    String(narrow.frameScrolls),
  );
  await browser.screenshot("narrow");
  await browser.send("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
}

// --- C2. reference shapes and the recursion stack ---------------------------

async function dataShapes(browser) {
  console.log("\n--- reference shapes and recursion ---");
  const readShape = () =>
    browser.evaluate(`(() => {
      const section = document.querySelector(".motion-structure");
      const nodes = [...document.querySelectorAll(".motion-structure .motion-node")];
      return {
        exists: Boolean(section),
        linked: Boolean(document.querySelector(".motion-structure.is-linked")),
        tree: Boolean(document.querySelector(".motion-structure.is-tree")),
        graph: Boolean(document.querySelector(".motion-structure.is-graph")),
        nodes: nodes.length,
        values: nodes.map((node) => node.querySelector(".motion-node-value")?.textContent ?? ""),
        levels: document.querySelectorAll(".motion-structure .motion-level").length,
        objectCards: document.querySelectorAll(".motion-object").length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()`);

  await openProgram(browser, LINKED);
  await seek(browser, (await readStage(browser)).max);
  const linked = await readShape();
  check(linked.linked, "a chain of references is drawn as a linked list", JSON.stringify(linked));
  check(
    linked.nodes === 3 && linked.objectCards === 0,
    "the linked nodes are one composition, not separate cards",
    JSON.stringify(linked),
  );
  check(
    linked.values.join(",") === "1,2,3",
    "the linked list keeps the recorded order",
    linked.values.join(","),
  );
  check(!linked.overflow, "the linked list does not overflow the page");
  await browser.screenshot("linked-list");

  await openProgram(browser, TREE);
  await seek(browser, (await readStage(browser)).max);
  const tree = await readShape();
  check(tree.tree, "left/right references are drawn as a tree", JSON.stringify(tree));
  check(
    tree.levels >= 2 && tree.values.join(",") === "5,3,8",
    "the tree keeps its root and two children on separate levels",
    `${tree.levels} levels | ${tree.values.join(",")}`,
  );
  check(!tree.overflow, "the tree does not overflow the page");
  await browser.screenshot("tree");

  await openProgram(browser, GRAPH);
  await seek(browser, (await readStage(browser)).max);
  const graph = await readShape();
  check(graph.graph, "a cycle of references is drawn as a graph", JSON.stringify(graph));
  check(
    graph.nodes === 3,
    "every recorded graph node is on the canvas",
    `${graph.nodes} nodes | ${graph.values.join(",")}`,
  );
  check(!graph.overflow, "the graph does not overflow the page");
  await browser.screenshot("graph");

  // Recursion: the active call leads a vertical, readable stack.
  await openProgram(browser, RECURSION);
  const recursionMax = (await readStage(browser)).max;
  let deep = null;
  for (let index = 0; index <= recursionMax && deep === null; index += 1) {
    await seek(browser, index);
    const stack = await browser.evaluate(`(() => {
      const frames = [...document.querySelectorAll(".motion-frame")];
      const active = frames.filter((frame) => frame.classList.contains("is-active"));
      const stage = document.querySelector(".motion-stage")?.getBoundingClientRect();
      return {
        count: frames.length,
        active: active.length,
        state: active[0]?.querySelector(".motion-frame-state")?.textContent ?? null,
        firstActive: frames[0]?.classList.contains("is-active") ?? false,
        inside: stage
          ? frames.every((frame) => {
              const rect = frame.getBoundingClientRect();
              return rect.left >= stage.left - 1 && rect.right <= stage.right + 1;
            })
          : false,
      };
    })()`);
    if (stack.count >= 4) deep = { index, ...stack };
  }
  check(deep !== null, "a recursive run records a multi-frame stack", String(deep?.count));
  check(deep?.active === 1, "exactly one frame is active", JSON.stringify(deep));
  check(
    deep?.firstActive && deep?.state === "active",
    "the active call leads the vertical stack",
    JSON.stringify(deep),
  );
  check(deep?.inside, "every frame stays inside the canvas", JSON.stringify(deep));
  await browser.screenshot("recursion-stack");
}

// --- D. dictionary and no-array programs ------------------------------------

async function fallbacks(browser) {
  console.log("\n--- dictionary and no-array programs ---");
  await openProgram(browser, DICT);
  const dictMax = (await readStage(browser)).max;
  await seek(browser, dictMax);
  const dict = await readStage(browser);
  const card = dict.objects.find((object) => object.type === "dict");
  check(
    Boolean(card),
    "a dictionary program draws its dictionary",
    dict.objects.map((object) => object.type).join(","),
  );
  check(
    card?.slots.some((slot) => slot.includes("Asha")) &&
      card?.slots.some((slot) => slot.includes("Meera")),
    "the dictionary shows the entries that remain",
    card?.slots.join(" | "),
  );
  check(
    !dict.noValues && dict.objects.every((object) => object.type === "dict"),
    "a dictionary program draws no list cells",
    dict.objects.map((object) => object.type).join(","),
  );
  await browser.screenshot("dict");

  await openProgram(browser, SCALARS);
  const scalarMax = (await readStage(browser)).max;
  await seek(browser, scalarMax);
  const scalar = await readStage(browser);
  check(!scalar.noValues, "a program without collections no longer claims there is nothing to draw");
  check(
    scalar.objects.length === 0,
    "a program without collections draws no value cards",
    `${scalar.objects.length}`,
  );
  check(
    scalar.scalars.some((tile) => tile.name === "total" && tile.value === "6"),
    "the scalar program shows total as a value tile",
    JSON.stringify(scalar.scalars),
  );
  check(
    scalar.scalars.some((tile) => tile.name === "n" && tile.type === "int"),
    "the scalar program labels the type it can prove",
    JSON.stringify(scalar.scalars),
  );
  check(scalar.output === "6\n", "the scalar program shows its printed output", scalar.output);
  check(scalar.result === "Completed", "the scalar program reaches a completed state", scalar.result);
  check(
    scalar.variables.some((variable) => variable.includes("total")),
    "the scalar program still shows its variables",
    scalar.variables.join(" | "),
  );
  // The final module return has no line to explain, so look at the steps that do.
  let explained = null;
  for (let index = 0; index <= scalarMax && explained === null; index += 1) {
    await seek(browser, index);
    const state = await readStage(browser);
    if (state.explanation) explained = { index, text: state.explanation };
  }
  check(
    explained !== null,
    "the scalar program still explains its steps",
    explained ? `step ${explained.index}: ${explained.text}` : "no step had a sentence",
  );
  // The final step is the useful composition: values, printed output, status.
  await seek(browser, scalarMax);
  await browser.screenshot("scalars");

  // The reported greet() regression: the returned string and the printed
  // output must both be visible in the stage, not only in the Inspector.
  await openProgram(browser, GREET);
  const greetMax = (await readStage(browser)).max;
  await seek(browser, greetMax);
  const greet = await readStage(browser);
  check(
    greet.returnFunction === "greet() returned" && greet.returnValue === '"Hello, Asha"',
    "the stage shows the returned string with the function that returned it",
    `${greet.returnFunction} ${greet.returnValue}`,
  );
  check(
    greet.output === "Hello, Asha\n",
    "the stage shows the printed output separately from the return value",
    JSON.stringify(greet.output),
  );
  check(greet.result === "Completed", "the greet run reaches a completed state", greet.result);
  check(
    greet.resultNote === null,
    "a run with output is not also called empty",
    greet.resultNote,
  );
  await browser.screenshot("greet-final");

  // Output is a tail of the recording: the first printed step is found by
  // stepping, then the step before it must have no output at all.
  let firstOutput = null;
  for (let index = 0; index <= greetMax && firstOutput === null; index += 1) {
    await seek(browser, index);
    const state = await readStage(browser);
    if (state.output !== null) firstOutput = { index, text: state.output };
  }
  check(firstOutput !== null, "the greet run records its print", JSON.stringify(firstOutput));
  if (firstOutput) {
    await seek(browser, firstOutput.index - 1);
    const before = await readStage(browser);
    check(
      before.output === null,
      "seeking back before a print removes the future output",
      JSON.stringify(before.output),
    );
  }

  // Reset position: no output and no final status.
  await seek(browser, 0);
  const greetStart = await readStage(browser);
  check(
    greetStart.output === null && greetStart.result === null && greetStart.returnValue === null,
    "reset clears output, return and final status",
    JSON.stringify({
      output: greetStart.output,
      result: greetStart.result,
      returned: greetStart.returnValue,
    }),
  );

  // The same result stage in the light theme and on a phone.
  await seek(browser, greetMax);
  const toggleTheme = () =>
    browser.evaluate(`(() => {
      const el = [...document.querySelectorAll("button")].find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith("Switch to"),
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);
  check(await toggleTheme(), "theme toggle exists on the result stage");
  await sleep(300);
  const greetLight = await readStage(browser);
  check(
    greetLight.theme === "light" &&
      greetLight.returnValue === '"Hello, Asha"' &&
      greetLight.output === "Hello, Asha\n",
    "the return and output survive the light theme",
    JSON.stringify({
      theme: greetLight.theme,
      returned: greetLight.returnValue,
      output: greetLight.output,
    }),
  );
  await browser.screenshot("greet-light");
  check(await toggleTheme(), "theme toggles back after the result stage");
  await sleep(300);

  await browser.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(300);
  const greetMobile = await readStage(browser);
  check(
    !greetMobile.bodyOverflow,
    "the result stage does not overflow a phone width",
    `${greetMobile.bodyOverflow}`,
  );
  check(
    greetMobile.returnValue === '"Hello, Asha"' && greetMobile.output === "Hello, Asha\n",
    "the return and output stay readable on a phone",
    JSON.stringify({ returned: greetMobile.returnValue, output: greetMobile.output }),
  );
  await browser.screenshot("greet-mobile");
  await browser.send("Emulation.clearDeviceMetricsOverride");
  await sleep(200);
}

// --- E. data-structure lab, lessons, narrow screen and keyboard -------------

/** Navigate the single-page app the way the router does. */
async function openRoute(browser, path) {
  await browser.evaluate(`(() => {
    window.history.pushState(null, "", ${JSON.stringify(path)});
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  })()`);
  await sleep(350);
}

const readLab = (browser) =>
  browser.evaluate(`(() => {
    const text = (selector) => document.querySelector(selector)?.textContent ?? null;
    const all = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent);
    const slider = document.querySelector('input[aria-label="Lab step"]');
    const stage = document.querySelector(".ds-stage");
    const plate = document.querySelector(".ds-plate");
    return {
      text: text(".ds-text"),
      readout: text(".ds-readout"),
      values: all(".ds-value"),
      plates: all(".ds-plate"),
      nodes: all(".ds-tree-node text"),
      graphDone: all(".ds-graph-node.is-done text"),
      compare: all(".ds-cell.is-compare .ds-value"),
      found: all(".ds-cell.is-found .ds-value"),
      active: all(".ds-cell.is-active .ds-value, .ds-node.is-active, .ds-plate.is-active"),
      slots: all(".ds-slot, .ds-chain-entry"),
      filled: all(".ds-slot-filled"),
      tombstones: all(".ds-slot-tombstone"),
      hashFound: all(".ds-slot.is-found, .ds-chain-entry.is-found"),
      hashCollisions: all(".ds-slot.is-collision, .ds-chain-entry.is-collision"),
      swap: all(".ds-slot.is-swap, .ds-chain-entry.is-swap"),
      distances: all(".ds-slot-distance"),
      buckets: all(".ds-bucket"),
      journey: text(".ds-journey"),
      hashNote: text(".ds-hash .ds-note"),
      detail: text(".ds-detail"),
      formula: text(".ds-formula summary"),
      formulaStep: text(".ds-formula-current"),
      formulaSum: text(".ds-formula-sum"),
      formulaTerm: text(".ds-formula-line .ds-term"),
      formulaSteps: document.querySelectorAll(".ds-formula-step").length,
      oldTable: text(".ds-old-table"),
      feedback: text(".ds-feedback"),
      tableRows: all(".ds-table tbody tr"),
      strategyRows: [...(document.querySelector(".ds-table")?.querySelectorAll("tbody tr") ?? [])].map(
        (row) => row.textContent,
      ),
      extraCards: all(".ds-extra-card"),
      error: text(".ds-error"),
      stepMax: slider ? Number(slider.max) : 0,
      stepValue: slider ? Number(slider.value) : 0,
      stepDisabled: slider ? slider.disabled : true,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      theme: document.documentElement.getAttribute("data-theme"),
      columns: stage ? getComputedStyle(document.querySelector(".ds-lab")).gridTemplateColumns : "",
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      transition: plate ? getComputedStyle(plate).transitionDuration : null,
      stageColor: stage ? getComputedStyle(stage).color : null,
      stageBg: stage ? getComputedStyle(stage).backgroundColor : null,
    };
  })()`);

async function productPages(browser) {
  console.log("\n--- data-structure lab, lessons, narrow screen and keyboard ---");

  await openRoute(browser, "/visualizer/data-structures");
  await browser.waitFor(
    'document.querySelectorAll(".ds-item").length === 7',
    15000,
    "the structure list",
  );
  const cards = await browser.evaluate(
    '[...document.querySelectorAll(".ds-item-name")].map((el) => el.textContent)',
  );
  check(
    cards.length === 7 && cards.includes("Binary search tree") && cards.includes("Graph") && cards.includes("Hash table"),
    "all seven structures are offered",
    cards.join(", "),
  );
  await browser.screenshot("ds-index");

  // Arrays: steps, marks, back/seek/reset and a bad index.
  await browser.click('a[href="/visualizer/data-structures/array"]');
  await browser.waitFor('document.querySelector(".ds-array")', 10000, "the array lab");
  const start = await readLab(browser);
  check(
    start.values.filter(Boolean).join(",") === "4,7,1",
    "the array starts with its example values",
    start.values.join(","),
  );
  await browser.clickText("Search");
  await sleep(150);
  const compare = await readLab(browser);
  check(compare.readout === "1 / 2", "a search records two steps", compare.readout);
  check(
    compare.compare.length === 1 && compare.found.length === 0,
    "the first search step marks the comparison",
    `compare ${compare.compare.join(",")} found ${compare.found.join(",")}`,
  );
  await browser.click('[aria-label="Next lab step"]');
  await sleep(100);
  const found = await readLab(browser);
  check(
    found.found.length === 1 && found.compare.length === 0,
    "the found step replaces the comparison mark",
    `compare ${found.compare.join(",")} found ${found.found.join(",")}`,
  );
  await browser.click('[aria-label="Previous lab step"]');
  await sleep(100);
  const back = await readLab(browser);
  check(
    back.compare.length === 1 && back.found.length === 0,
    "stepping back removes the later found mark",
    `compare ${back.compare.join(",")} found ${back.found.join(",")}`,
  );
  await browser.setValue('input[aria-label="Lab step"]', 1);
  await sleep(100);
  const seeked = await readLab(browser);
  check(
    seeked.found.length === 1 && seeked.compare.length === 0,
    "seeking draws the target step, not the path",
    `compare ${seeked.compare.join(",")} found ${seeked.found.join(",")}`,
  );
  await browser.click('[aria-label="Reset lab"]');
  await sleep(100);
  const reset = await readLab(browser);
  check(
    reset.readout === "0 / 0" && reset.active.length === 0,
    "reset clears the run and its marks",
    `${reset.readout} active ${reset.active.join(",")}`,
  );
  await browser.setValue('input[aria-label="Remove Index"]', 99);
  await browser.clickText("Remove");
  await sleep(100);
  const refused = await readLab(browser);
  check(
    refused.error?.includes("outside") &&
      refused.values.filter(Boolean).join(",") === "4,7,1",
    "a bad index says why and changes nothing",
    `${refused.error} | ${refused.values.join(",")}`,
  );

  // Dynamic array: the capacity doubles before the append.
  await browser.setValue('input[aria-label="Append Value"]', 6);
  await browser.clickText("Append");
  await sleep(100);
  await browser.setValue('input[aria-label="Append Value"]', 2);
  await browser.clickText("Append");
  await sleep(100);
  const growing = await readLab(browser);
  const capacity = await browser.evaluate('document.querySelector(".ds-note")?.textContent');
  check(growing.readout === "1 / 2", "a full append records a growth step first", growing.readout);
  check(
    capacity?.includes("capacity 8"),
    "the array grows from four slots to eight",
    String(capacity),
  );
  await browser.click('[aria-label="Next lab step"]');
  await sleep(100);
  const grown = await readLab(browser);
  check(
    grown.values.filter(Boolean).join(",") === "4,7,1,6,2",
    "the grown array keeps every value",
    grown.values.join(","),
  );

  // Stack and queue: LIFO, FIFO, and the empty refusal.
  await openRoute(browser, "/visualizer/data-structures/stack");
  await browser.waitFor('document.querySelector(".ds-stack")', 10000, "the stack lab");
  await browser.clickText("Pop");
  await sleep(100);
  const popped = await readLab(browser);
  check(
    popped.plates.join(",") === "A" && popped.text.includes("Pop B"),
    "a stack pops from the top",
    `${popped.plates.join(",")} | ${popped.text}`,
  );
  await browser.clickText("Pop");
  await sleep(100);
  await browser.clickText("Pop");
  await sleep(100);
  const emptyPop = await readLab(browser);
  check(
    emptyPop.error?.includes("empty"),
    "popping an empty stack is refused",
    String(emptyPop.error),
  );
  check(
    (await browser.evaluate('document.querySelector(".ds-empty-cell")?.textContent')) === "empty",
    "the empty stack says it is empty",
  );

  await openRoute(browser, "/visualizer/data-structures/queue");
  await browser.waitFor('document.querySelector(".ds-queue")', 10000, "the queue lab");
  await browser.clickText("Enqueue");
  await sleep(100);
  check(
    (await readLab(browser)).plates.join(",") === "A,B,C",
    "a queue enqueues at the back",
  );
  await browser.clickText("Dequeue");
  await sleep(100);
  const dequeued = await readLab(browser);
  check(
    dequeued.plates.join(",") === "B,C" && dequeued.text.includes("Dequeue A"),
    "a queue dequeues from the front",
    `${dequeued.plates.join(",")} | ${dequeued.text}`,
  );

  // Linked list: playback, pause, reset.
  await openRoute(browser, "/visualizer/data-structures/linked-list");
  await browser.waitFor('document.querySelector(".ds-linked")', 10000, "the list lab");
  await browser.clickText("Traverse");
  await sleep(100);
  const walking = await readLab(browser);
  check(walking.readout === "1 / 3", "a traversal records one step per node", walking.readout);
  await browser.click('[aria-label="Play lab"]');
  await sleep(850);
  await browser.click('[aria-label="Pause lab"]');
  const paused = await readLab(browser);
  await sleep(900);
  const stillPaused = await readLab(browser);
  check(
    stillPaused.stepValue === paused.stepValue,
    "pausing the lab stops the playhead",
    `${paused.stepValue} then ${stillPaused.stepValue}`,
  );
  await browser.click('[aria-label="Reset lab"]');
  await sleep(100);
  const resetList = await readLab(browser);
  check(
    resetList.readout === "0 / 0" && resetList.active.length === 0,
    "resetting the list clears its steps",
    resetList.readout,
  );

  // Binary search tree: insert, duplicate, in-order.
  await openRoute(browser, "/visualizer/data-structures/bst");
  await browser.waitFor('document.querySelector(".ds-stage")', 10000, "the tree lab");
  for (const value of [8, 3, 10, 1, 6]) {
    await browser.setValue('input[aria-label="Insert Value"]', value);
    await browser.clickText("Insert");
    await sleep(120);
  }
  await browser.setValue('input[aria-label="Lab step"]', 2);
  await sleep(120);
  const tree = await readLab(browser);
  check(
    tree.nodes.join(",") === "1,3,6,8,10",
    "the tree inserts in search order",
    tree.nodes.join(","),
  );
  await browser.setValue('input[aria-label="Insert Value"]', 3);
  await browser.clickText("Insert");
  await sleep(120);
  await browser.setValue('input[aria-label="Lab step"]', 1);
  await sleep(120);
  const duplicate = await readLab(browser);
  check(
    duplicate.text.includes("keeps one copy") && duplicate.nodes.length === 5,
    "a duplicate tree value is kept once",
    `${duplicate.text} | ${duplicate.nodes.length} nodes`,
  );
  await browser.clickText("In-order");
  await sleep(100);
  await browser.setValue('input[aria-label="Lab step"]', 5);
  await sleep(120);
  const inorder = await readLab(browser);
  check(
    inorder.text.includes("1, 3, 6, 8, 10"),
    "the in-order walk is sorted",
    String(inorder.text),
  );

  // Graph: breadth-first and depth-first on the fixed graph.
  await openRoute(browser, "/visualizer/data-structures/graph");
  await browser.waitFor('document.querySelector(".ds-graph")', 10000, "the graph lab");
  await browser.clickText("Breadth-first");
  await sleep(100);
  await browser.setValue('input[aria-label="Lab step"]', 6);
  await sleep(120);
  const bfs = await readLab(browser);
  check(
    bfs.text.includes("A → B → C → D → E → F") && bfs.graphDone.length === 6,
    "breadth-first visits every node in queue order",
    `${bfs.text} | ${bfs.graphDone.join(",")}`,
  );
  await browser.clickText("Depth-first");
  await sleep(100);
  await browser.setValue('input[aria-label="Lab step"]', 6);
  await sleep(120);
  const dfs = await readLab(browser);
  check(
    dfs.text.includes("A → B → D → F → E → C"),
    "depth-first follows one branch before the next",
    String(dfs.text),
  );

  // Hash table: hashing, chaining, probing, tombstones, resize and extras.
  await openRoute(browser, "/visualizer/data-structures");
  await openRoute(browser, "/visualizer/data-structures/hash-table");
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "the hash table lab");
  const emptyHash = await readLab(browser);
  check(
    emptyHash.slots.length === 7 && emptyHash.slots.every((slot) => slot === "empty"),
    "the hash table starts empty with seven buckets",
    emptyHash.slots.join(","),
  );
  check(
    emptyHash.strategyRows.length === 5 &&
      emptyHash.strategyRows[0].includes("Separate chaining") &&
      emptyHash.strategyRows[3].includes("Double hashing") &&
      emptyHash.strategyRows[4].includes("Robin Hood"),
    "the strategy comparison measures all five strategies",
    emptyHash.strategyRows.join(" / "),
  );
  await browser.clickText("Insert / update");
  await sleep(150);
  const hashed = await readLab(browser);
  check(
    hashed.readout === "1 / 2" &&
      hashed.journey?.includes("hash 530") &&
      hashed.journey?.includes("bucket 5"),
    "an insert records the hash journey before it stores",
    `${hashed.readout} | ${hashed.journey}`,
  );
  await browser.click('[aria-label="Next lab step"]');
  await sleep(100);
  const stored = await readLab(browser);
  check(
    stored.slots.some((slot) => slot === "apple=4") && stored.text.includes("apple=4"),
    "the insert stores the pair in the hashed bucket",
    `${stored.slots.join(",")} | ${stored.text}`,
  );
  await browser.clickText("Search");
  await sleep(150);
  await browser.click('[aria-label="Next lab step"]');
  await sleep(100);
  const hashFound = await readLab(browser);
  check(
    hashFound.hashFound.length === 1 && hashFound.text.includes("Found apple=4"),
    "a search marks the entry it found",
    `${hashFound.hashFound.join(",")} | ${hashFound.text}`,
  );
  await browser.setValue('input[aria-label="Predicted bucket"]', 5);
  await browser.clickText("Check");
  await sleep(100);
  check(
    (await readLab(browser)).feedback?.includes("Correct"),
    "the predict exercise checks against the real hash",
    String((await readLab(browser)).feedback),
  );

  // The formula panel steps through the engine's own arithmetic.
  await browser.click(".ds-formula summary");
  await sleep(100);
  const formula = await readLab(browser);
  check(
    formula.formula?.includes("Formula breakdown") &&
      formula.formula?.includes("Division") &&
      formula.formulaSteps >= 3,
    "the formula panel lists every calculation step",
    `${formula.formula} | ${formula.formulaSteps} steps`,
  );
  check(
    formula.formulaSum?.includes("Raw hash 530") && formula.formulaSum?.includes("bucket 5"),
    "the panel separates the raw hash from the bucket index",
    String(formula.formulaSum),
  );
  const firstStep = formula.formulaStep;
  await browser.click('[aria-label="Next calculation step"]');
  await sleep(80);
  const nextStep = await readLab(browser);
  check(
    nextStep.formulaStep !== firstStep && nextStep.formulaTerm?.length > 0,
    "stepping marks the formula term the step works on",
    `${firstStep} -> ${nextStep.formulaStep} | ${nextStep.formulaTerm}`,
  );
  await browser.click('[aria-label="Previous calculation step"]');
  await sleep(80);
  check(
    (await readLab(browser)).formulaStep === firstStep,
    "going back returns to the earlier calculation",
    String((await readLab(browser)).formulaStep),
  );
  await browser.setValue('input[aria-label="Inspect key"]', "ab");
  await sleep(100);
  const inspected = await readLab(browser);
  check(
    inspected.formulaSum?.includes("Raw hash 195") && inspected.formulaSum?.includes("bucket 6"),
    "typing a key recalculates with the engine's hash",
    String(inspected.formulaSum),
  );
  await browser.click('[aria-label="Reset calculation"]');
  await sleep(80);
  check(
    (await readLab(browser)).formulaSum?.includes("Raw hash 530"),
    "reset returns the panel to the frame's own key",
    String((await readLab(browser)).formulaSum),
  );

  // Universal hashing: two moduli, reproducible parameters, and an explicit
  // rehash when the seed changes.
  await openRoute(browser, "/visualizer/data-structures/hash-table");
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "a fresh hash table lab");
  const pick = (selector, value) =>
    browser.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`);
  await browser.click(".ds-advanced summary");
  await sleep(100);
  await pick('select[aria-label="Apply settings Hash function"]', "universal");
  await browser.clickText("Apply settings");
  await sleep(150);
  const universalRun = await readLab(browser);
  await browser.setValue('input[aria-label="Lab step"]', universalRun.stepMax);
  await sleep(120);
  const universal = await readLab(browser);
  check(
    universal.hashNote?.includes("p 101") &&
      universal.hashNote?.includes("seed 17") &&
      /a \d+/.test(universal.hashNote) &&
      /b \d+/.test(universal.hashNote),
    "universal hashing shows its seed and parameters",
    String(universal.hashNote),
  );
  await browser.click(".ds-formula summary");
  await sleep(100);
  const universalFormula = await readLab(browser);
  check(
    universalFormula.formula?.includes("Universal") && universalFormula.formulaSteps >= 6,
    "the universal breakdown has a step per arithmetic stage",
    `${universalFormula.formula} | ${universalFormula.formulaSteps} steps`,
  );
  const lastStep = universalFormula.formulaSteps;
  await browser.click(`[aria-label="Calculation step ${lastStep}"]`);
  await sleep(80);
  const outer = await readLab(browser);
  await browser.click(`[aria-label="Calculation step ${lastStep - 1}"]`);
  await sleep(80);
  const inner = await readLab(browser);
  check(
    outer.formulaStep?.includes("mod 7 =") && inner.formulaStep?.includes("mod 101 ="),
    "the panel shows the inner mod p and the outer mod m separately",
    `${inner.formulaStep} | ${outer.formulaStep}`,
  );

  // The parameters are state: they survive an ordinary insert.
  await browser.clickText("Insert / update");
  await sleep(150);
  await browser.setValue('input[aria-label="Lab step"]', (await readLab(browser)).stepMax);
  await sleep(120);
  const universalStored = await readLab(browser);
  check(
    universalStored.hashNote?.includes("seed 17") &&
      universalStored.slots.some((slot) => slot === "apple=4"),
    "universal parameters survive an insert",
    `${universalStored.hashNote} | ${universalStored.slots.join(",")}`,
  );

  // A seed change is a parameter change: it must rehash, not silently relabel.
  await browser.setValue('input[aria-label="Apply settings Universal seed"]', 42);
  await browser.clickText("Apply settings");
  await sleep(150);
  const reseeded = await readLab(browser);
  check(
    reseeded.text?.includes("seed 42") && reseeded.stepMax > 0,
    "changing the seed records an explicit rehash",
    `${reseeded.text} | max ${reseeded.stepMax}`,
  );
  await browser.setValue('input[aria-label="Lab step"]', reseeded.stepMax);
  await sleep(120);
  const reseededEnd = await readLab(browser);
  check(
    reseededEnd.hashNote?.includes("seed 42") &&
      reseededEnd.slots.some((slot) => slot === "apple=4"),
    "a seed change rehashes every stored key",
    `${reseededEnd.hashNote} | ${reseededEnd.slots.join(",")}`,
  );
  await pick('select[aria-label="Apply settings Hash function"]', "division");
  await browser.setValue('input[aria-label="Apply settings Universal seed"]', 43);
  await browser.clickText("Apply settings");
  await sleep(120);
  check(
    (await readLab(browser)).error?.includes("only applies to universal hashing"),
    "a seed is refused for a hash function that has no parameters",
    String((await readLab(browser)).error),
  );

  // The same colliding keys resolve differently under each strategy.
  const strategyBuckets = async (preset, bucket, expected) => {
    await openRoute(browser, "/visualizer/data-structures");
    await openRoute(browser, `/visualizer/data-structures/hash-table?preset=${preset}`);
    await browser.waitFor('document.querySelector(".ds-buckets")', 10000, `${preset} loaded`);
    const run = await readLab(browser);
    await browser.setValue('input[aria-label="Lab step"]', run.stepMax);
    await sleep(120);
    const view = await readLab(browser);
    check(
      view.buckets[bucket]?.includes(expected),
      `${preset} places the second colliding key in bucket ${bucket}`,
      view.buckets[bucket] ?? "no bucket",
    );
    return view;
  };

  const chained = await strategyBuckets("colliders", 6, "ab=1");
  check(
    chained.buckets[6]?.includes("ba=2"),
    "separate chaining keeps both colliding keys in one bucket",
    chained.buckets[6],
  );
  const linearTable = await strategyBuckets("linear", 0, "ba=2");
  check(
    linearTable.buckets[6]?.includes("ab=1"),
    "linear probing keeps the first key in its bucket",
    linearTable.buckets[6],
  );
  await strategyBuckets("quadratic", 1, "ba=2");
  await strategyBuckets("double", 3, "ba=2");

  // Robin Hood: a real displacement swap, per-slot distance, lookup and a
  // backward-shift delete (no tombstone).
  await openRoute(browser, "/visualizer/data-structures");
  await openRoute(browser, "/visualizer/data-structures/hash-table?preset=robinhood");
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "the Robin Hood dataset");
  const robinRun = await readLab(browser);
  let swapView = null;
  for (let step = 0; step <= robinRun.stepMax; step += 1) {
    await browser.setValue('input[aria-label="Lab step"]', step);
    await sleep(30);
    const seen = await readLab(browser);
    if (seen.swap.length && seen.text?.includes("displaced")) {
      swapView = seen;
      break;
    }
  }
  check(
    Boolean(swapView) && swapView.swap.length === 1,
    "Robin Hood records a real displacement swap",
    swapView ? `${swapView.text} | ${swapView.swap.join(",")}` : "no swap frame",
  );
  await browser.setValue('input[aria-label="Lab step"]', robinRun.stepMax);
  await sleep(120);
  const robinEnd = await readLab(browser);
  check(
    robinEnd.buckets[1]?.includes("1=one") &&
      robinEnd.buckets[2]?.includes("8=eight") &&
      robinEnd.buckets[3]?.includes("15=fifteen") &&
      robinEnd.buckets[4]?.includes("2=two") &&
      robinEnd.distances.join(",") === "d0,d1,d2,d2",
    "Robin Hood stores the displaced keys with honest distances",
    `${robinEnd.buckets.slice(1, 5).join(" / ")} | ${robinEnd.distances.join(",")}`,
  );
  await browser.setValue('input[aria-label="Search Key"]', "2");
  await browser.clickText("Search");
  await sleep(150);
  await browser.setValue('input[aria-label="Lab step"]', (await readLab(browser)).stepMax);
  await sleep(100);
  check(
    (await readLab(browser)).text?.includes("Found 2=two"),
    "a displaced key is still found",
    String((await readLab(browser)).text),
  );
  await browser.setValue('input[aria-label="Delete Key"]', "1");
  await browser.clickText("Delete");
  await sleep(150);
  await browser.setValue('input[aria-label="Lab step"]', (await readLab(browser)).stepMax);
  await sleep(120);
  const robinDeleted = await readLab(browser);
  check(
    robinDeleted.tombstones.length === 0 &&
      robinDeleted.buckets[1]?.includes("8=eight") &&
      robinDeleted.buckets[2]?.includes("15=fifteen") &&
      robinDeleted.buckets[3]?.includes("2=two"),
    "Robin Hood deletes by shifting the cluster back, not with a tombstone",
    `${robinDeleted.buckets.slice(1, 4).join(" / ")} | tombstones ${robinDeleted.tombstones.length}`,
  );

  // Prediction challenges: the cards answer with the real engine insert and
  // the real growth policy, and replay runs the real operation.
  await openRoute(browser, "/visualizer/data-structures");
  await openRoute(browser, "/visualizer/data-structures/hash-table");
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "a fresh hash table");
  await browser.setValue('input[aria-label="Predict next slot key"]', "apple");
  await browser.setValue('input[aria-label="Predicted slot"]', 3);
  await browser.clickText("Check slot");
  await sleep(100);
  check(
    (await readLab(browser)).feedback?.includes("lands in slot 5, not 3"),
    "the slot prediction is checked against the engine's real placement",
    String((await readLab(browser)).feedback),
  );
  await browser.setValue('input[aria-label="Predicted slot"]', 5);
  await browser.clickText("Check slot");
  await sleep(100);
  check(
    (await readLab(browser)).feedback?.includes("Correct: apple lands in slot 5"),
    "a correct slot prediction is recognised",
    String((await readLab(browser)).feedback),
  );
  await browser.clickText("Replay placement");
  await sleep(200);
  await browser.setValue('input[aria-label="Lab step"]', (await readLab(browser)).stepMax);
  await sleep(120);
  const replayed = await readLab(browser);
  check(
    replayed.slots.some((slot) => slot === "apple=1"),
    "replaying a prediction runs the real insert",
    `${replayed.readout} | ${replayed.slots.join(",")}`,
  );

  // Robin Hood's prompt tells the learner to predict the final slot.
  await browser.click(".ds-advanced summary");
  await sleep(100);
  const pickStrategy = (value) =>
    browser.evaluate(`(() => {
      const el = document.querySelector('select[aria-label="Apply settings Collision strategy"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`);
  await pickStrategy("robin-hood");
  await browser.clickText("Apply settings");
  await sleep(150);
  const robinPrompt = (await readLab(browser)).extraCards.join(" | ");
  check(
    robinPrompt.includes("final slot, not the next probe"),
    "Robin Hood's challenge distinguishes the next probe from the final slot",
    robinPrompt,
  );

  // A resize prediction uses the real growth threshold and the update rule.
  await openRoute(browser, "/visualizer/data-structures");
  await openRoute(browser, "/visualizer/data-structures/hash-table");
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "a fresh hash table");
  await browser.click(".ds-advanced summary");
  await sleep(100);
  await pick('select[aria-label="Apply settings Hash function"]', "division");
  await browser.setValue('input[aria-label="Apply settings Load threshold"]', 0.1);
  await browser.clickText("Apply settings");
  await sleep(150);
  await browser.setValue('input[aria-label="Resize prediction key"]', "apple");
  await browser.clickText("Yes, it grows");
  await sleep(100);
  check(
    (await readLab(browser)).feedback?.includes("Correct") &&
      (await readLab(browser)).feedback?.includes("grows from 7 to 14"),
    "a resize prediction uses the real growth threshold",
    String((await readLab(browser)).feedback),
  );
  await browser.clickText("Replay resize");
  await sleep(200);
  await browser.setValue('input[aria-label="Lab step"]', (await readLab(browser)).stepMax);
  await sleep(120);
  const grew = await readLab(browser);
  check(
    grew.buckets.length === 14 && grew.slots.some((slot) => slot === "apple=1"),
    "replaying a resize grows the table for real",
    `${grew.buckets.length} buckets | ${grew.slots.join(",")}`,
  );
  await browser.setValue('input[aria-label="Resize prediction key"]', "apple");
  await browser.clickText("No, it stays");
  await sleep(100);
  check(
    (await readLab(browser)).feedback?.includes("Correct") &&
      (await readLab(browser)).feedback?.includes("already stored"),
    "a duplicate update never runs the growth check",
    String((await readLab(browser)).feedback),
  );

  const tombed = await strategyBuckets("deletions", 4, "ant=1");
  check(
    tombed.tombstones.length === 2 && tombed.text.includes("tombstone"),
    "an open-addressed delete leaves two tombstones",
    `${tombed.tombstones.length} | ${tombed.text}`,
  );

  // A resize keeps the old table visible while it rehashes into the new one.
  await openRoute(browser, "/visualizer/data-structures");
  await openRoute(browser, "/visualizer/data-structures/hash-table?preset=resize");
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "the resize dataset");
  const resizeRun = await readLab(browser);
  // The rebuild block ends with 11 frames: start, allocate, one per key, done.
  await browser.setValue('input[aria-label="Lab step"]', resizeRun.stepMax - 9);
  await sleep(120);
  const rebuilding = await readLab(browser);
  check(
    rebuilding.oldTable?.includes("before · capacity 7"),
    "a resize shows the table it is replacing",
    String(rebuilding.oldTable),
  );
  await browser.setValue('input[aria-label="Lab step"]', rebuilding.stepMax);
  await sleep(120);
  const grownTable = await readLab(browser);
  check(
    grownTable.buckets.length === 14,
    "the resize grows the table and rehashes every key",
    `${grownTable.buckets.length} buckets | ${grownTable.text}`,
  );

  // Lessons: the index, one lesson, and its program loaded unrun.
  await openRoute(browser, "/learn");
  await browser.waitFor(
    'document.querySelectorAll(".learn-lesson").length === 18',
    10000,
    "the lesson index",
  );
  await browser.click('a[href="/learn/getting-started/introduction"]');
  await browser.waitFor('document.querySelector(".lesson")', 10000, "a lesson page");
  const lesson = await browser.evaluate(`(() => ({
    title: document.querySelector(".page-title")?.textContent,
    objectives: document.querySelectorAll(".lesson-objectives li").length,
    checkpoints: document.querySelectorAll(".checkpoint").length,
    example: document.querySelector('a[href^="/visualizer/python?example="]')?.getAttribute("href"),
    next: document.querySelector(".lesson-nav-next")?.getAttribute("href"),
  }))()`);
  check(
    lesson.title === "Introduction to CodeLens" &&
      lesson.objectives >= 2 &&
      lesson.checkpoints >= 2,
    "a lesson has objectives, prose and checkpoints",
    JSON.stringify(lesson),
  );
  check(
    lesson.example === "/visualizer/python?example=statements",
    "a lesson links to its own example",
    String(lesson.example),
  );
  check(
    lesson.next === "/learn/getting-started/first-program",
    "a lesson links to the next one",
    String(lesson.next),
  );
  await browser.click('a[href^="/visualizer/python?example="]');
  await browser.waitFor(
    'document.querySelector(\'textarea[aria-label="Your Python code"]\')',
    15000,
    "the visualizer with the lesson program",
  );
  const loaded = await browser.evaluate(`(() => {
    const step = document.querySelector('input[aria-label="Step"]');
    return {
      source: document.querySelector('textarea[aria-label="Your Python code"]').value,
      stepped: Boolean(step),
      stepDisabled: step ? step.disabled : true,
    };
  })()`);
  check(
    loaded.source.includes("total = total + 4"),
    "a lesson opens its own program in the visualizer",
    loaded.source.slice(0, 40),
  );
  check(
    !loaded.stepped || loaded.stepDisabled,
    "the lesson loads the program without running it",
    JSON.stringify({ stepped: loaded.stepped, disabled: loaded.stepDisabled }),
  );
  await browser.evaluate("window.history.back()");
  await browser.waitFor('document.querySelector(".lesson")', 10000, "the lesson after going back");
  check(
    (await browser.evaluate('document.querySelectorAll(".checkpoint").length')) >= 2,
    "going back returns to the lesson",
  );

  // A lab lesson opens its structure with the prepared dataset, not a program.
  await openRoute(browser, "/learn/hash-tables/linear-probing");
  await browser.waitFor('document.querySelector(".lesson")', 10000, "a hash-table lesson");
  const labLesson = await browser.evaluate(`(() => ({
    link: document.querySelector('a[href^="/visualizer/data-structures/"]')?.getAttribute("href"),
    code: document.querySelector(".lesson-code")?.textContent ?? null,
  }))()`);
  check(
    labLesson.link === "/visualizer/data-structures/hash-table?preset=linear" && !labLesson.code,
    "a lab lesson links to the prepared table, not a Python program",
    JSON.stringify(labLesson),
  );
  await browser.click('a[href^="/visualizer/data-structures/"]');
  await browser.waitFor('document.querySelector(".ds-buckets")', 10000, "the seeded hash lab");
  const seeded = await readLab(browser);
  await browser.setValue('input[aria-label="Lab step"]', seeded.stepMax);
  await sleep(150);
  const seededEnd = await readLab(browser);
  check(
    seeded.stepMax > 0 && seededEnd.buckets[0]?.includes("ba=2"),
    "the lesson opens the table with its dataset recorded",
    `${seeded.stepMax} steps | ${seededEnd.buckets[0]}`,
  );

  // Themes on the lab.
  await openRoute(browser, "/visualizer/data-structures/array");
  await browser.waitFor('document.querySelector(".ds-array")', 10000, "the array lab again");
  const toggle = () =>
    browser.evaluate(`(() => {
      const el = [...document.querySelectorAll("button")].find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith("Switch to"),
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);
  const dark = await readLab(browser);
  check(await toggle(), "the lab has the theme switch");
  await sleep(300);
  const light = await readLab(browser);
  check(light.theme !== dark.theme, "the lab follows the theme", `${dark.theme} -> ${light.theme}`);
  check(
    light.stageColor !== light.stageBg,
    "lab text is readable against its own surface",
    `${light.stageColor} on ${light.stageBg}`,
  );
  check(!light.overflow, "the lab does not overflow in light theme");
  await browser.screenshot("ds-light");
  await toggle();
  await sleep(300);
  check((await readLab(browser)).theme === dark.theme, "the lab returns to the original theme");

  // Narrow screen with reduced motion.
  await browser.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await browser.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await openRoute(browser, "/visualizer/data-structures/stack");
  const mobile = await readLab(browser);
  check(mobile.reduced, "reduced motion is live on the narrow lab", String(mobile.reduced));
  check(
    mobile.columns.split(" ").length === 1,
    "the lab becomes one column on a narrow screen",
    mobile.columns,
  );
  check(!mobile.overflow, "the narrow lab does not overflow the page");
  await browser.clickText("Push");
  await sleep(100);
  const mobileStep = await readLab(browser);
  check(
    mobileStep.plates.length === 3 && mobileStep.text.includes("Push C"),
    "the narrow lab still records steps",
    `${mobileStep.plates.join(",")} | ${mobileStep.text}`,
  );
  check(
    mobileStep.transition === "0s" || parseFloat(mobileStep.transition) < 0.001,
    "reduced motion removes the lab transition",
    String(mobileStep.transition),
  );
  await openRoute(browser, "/visualizer/data-structures/hash-table");
  await browser.waitFor('document.querySelector(".ds-formula")', 10000, "the narrow hash lab");
  await browser.click(".ds-formula summary");
  await sleep(100);
  const mobileFormula = await readLab(browser);
  check(
    mobileFormula.formulaSteps > 2 && !mobileFormula.overflow,
    "the calculation panel fits a 390px screen",
    `${mobileFormula.formulaSteps} steps | overflow ${mobileFormula.overflow}`,
  );
  await browser.screenshot("ds-mobile-reduced");
  await browser.send("Emulation.clearDeviceMetricsOverride");
  await browser.send("Emulation.setEmulatedMedia", { features: [] });
  await sleep(300);

  // Keyboard: Tab reaches the timeline with a visible ring, and arrows seek.
  await openRoute(browser, "/visualizer/data-structures/array");
  await browser.waitFor('document.querySelector(".ds-array")', 10000, "the array lab for keyboard");
  await browser.clickText("Search");
  await sleep(150);
  let focused = null;
  for (let attempt = 0; attempt < 40 && focused?.label !== "Lab step"; attempt += 1) {
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await sleep(30);
    focused = await browser.evaluate(`(() => ({
      label: document.activeElement.getAttribute("aria-label"),
      outline: getComputedStyle(document.activeElement).outlineStyle,
      width: getComputedStyle(document.activeElement).outlineWidth,
    }))()`);
  }
  check(focused?.label === "Lab step", "Tab reaches the lab timeline", JSON.stringify(focused));
  check(
    focused?.outline === "solid" && focused?.width === "2px",
    "the focused lab control shows a ring",
    JSON.stringify(focused),
  );
  for (const key of ["ArrowRight", "ArrowRight"]) {
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: key === "ArrowRight" ? 39 : 37,
    });
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: key === "ArrowRight" ? 39 : 37,
    });
    await sleep(80);
  }
  check(
    (await readLab(browser)).stepValue === 1,
    "arrow keys seek the lab timeline",
    String((await readLab(browser)).stepValue),
  );
  await browser.screenshot("ds-keyboard");
}

// --- F. release regressions -------------------------------------------------

const BIG_ARRAY = "numbers = list(range(200))\nprint(numbers[0])\nprint(numbers[-1])\n";
const CYCLE = "a = []\na.append(a)\nb = a\nprint(a)\n";
// A low recursion limit keeps this deterministic: Pyodide can otherwise spend
// the whole time budget walking a thousand frames and report Timeout instead.
const RUNAWAY =
  "import sys\nsys.setrecursionlimit(120)\n\ndef down(n):\n    return down(n + 1)\nprint(down(0))\n";
const CAUGHT = "values = [1, 2]\ntry:\n    print(values[5])\nexcept IndexError:\n    print('caught')\nprint('after')\n";

async function releaseRegressions(browser) {
  console.log("\n--- release regressions ---");
  await openRoute(browser, "/visualizer/python");
  await browser.waitFor(
    `document.querySelector('textarea[aria-label="Your Python code"]')`,
    60000,
    "the Python workspace",
  );

  // A successful run says so in words, not in the tracer's status id.
  await openProgram(browser, BIG_ARRAY);
  const big = await readStage(browser);
  check(
    (await browser.evaluate('document.querySelector(".tb-state")?.textContent.trim()')) === "Completed",
    "a successful run reads Completed",
    await browser.evaluate('document.querySelector(".tb-state")?.textContent.trim()'),
  );

  // Hundreds of elements: a bounded strip, a truthful count, no page overflow.
  await seek(browser, big.max);
  const bigEnd = await readStage(browser);
  const more = await browser.evaluate('document.querySelector(".motion-object-more")?.textContent ?? null');
  check(
    bigEnd.cells.length === 30,
    "a 200-element list draws a bounded strip",
    `${bigEnd.cells.length} cells`,
  );
  check(
    bigEnd.rowScrolls && !bigEnd.bodyOverflow,
    "the long list scrolls inside its own row, not the page",
    JSON.stringify({ rowScrolls: bigEnd.rowScrolls, page: bigEnd.bodyOverflow }),
  );
  check(
    /170 more/.test(bigEnd.head ?? "") || /170 more/.test(more ?? ""),
    "the strip says how many cells it left out",
    `${more} | ${bigEnd.head}`,
  );
  await browser.screenshot("big-array");

  // A self-referential list renders a marker instead of recursing forever.
  await openProgram(browser, CYCLE);
  const cycleMax = (await readStage(browser)).max;
  await seek(browser, cycleMax);
  const cycle = await readStage(browser);
  check(
    cycle.objects.some((object) => object.slots.some((slot) => slot.includes("…"))),
    "a cyclic list shows a cycle marker",
    cycle.objects.map((object) => object.slots.join(" | ")).join(" || "),
  );
  check(!cycle.bodyOverflow, "the cyclic list does not overflow the page");

  // Runaway recursion: an honest runtime error, a capped call strip.
  await openProgram(browser, RUNAWAY);
  const runawayMax = (await readStage(browser)).max;
  check(
    (await browser.evaluate('document.querySelector(".tb-state")?.textContent.trim()')) ===
      "Runtime error",
    "runaway recursion reports a runtime error",
    await browser.evaluate('document.querySelector(".tb-state")?.textContent.trim()'),
  );
  // The last step is the error itself; the step before it holds the deep stack.
  await seek(browser, runawayMax - 1);
  const runaway = await readStage(browser);
  check(
    runaway.frameCount > 0 && runaway.frameCount <= 24,
    "the call strip is capped on a deep stack",
    `${runaway.frameCount} frames`,
  );
  check(
    (await browser.evaluate('document.querySelector(".motion-frames-more")?.textContent ?? ""')).includes(
      "earlier calls not shown",
    ),
    "the capped strip says where the rest are listed",
  );
  check(!runaway.bodyOverflow, "the deep stack does not overflow the page");
  await seek(browser, runawayMax);
  const runawayEnd = await readStage(browser);
  check(
    runawayEnd.result === "Runtime error" && !/Completed/.test(runawayEnd.result ?? ""),
    "the failed run's stage says Runtime error, not Completed",
    `${runawayEnd.result} ${runawayEnd.resultDetail}`,
  );
  check(
    /RecursionError/.test(runawayEnd.resultDetail ?? ""),
    "the failed run's stage names the recorded error",
    runawayEnd.resultDetail,
  );
  await browser.screenshot("runaway-recursion");

  // A caught exception is not a failed program.
  await openProgram(browser, CAUGHT);
  const caughtMax = (await readStage(browser)).max;
  await seek(browser, caughtMax);
  const caught = await readStage(browser);
  check(
    (await browser.evaluate('document.querySelector(".tb-state")?.textContent.trim()')) === "Completed",
    "a caught exception still completes",
    await browser.evaluate('document.querySelector(".tb-state")?.textContent.trim()'),
  );
  await browser.evaluate(`document.querySelector('[data-tabid="output"]')?.click()`);
  await sleep(300);
  const printed = await browser.evaluate(
    `(() => document.querySelector(".output-console")?.textContent ?? "")()`,
  );
  check(/after/.test(printed), "the program keeps running after a caught exception", printed.slice(0, 80));
  check(
    caught.result === "Completed" && /caught/.test(caught.output ?? "") && /after/.test(caught.output ?? ""),
    "the stage itself shows the caught run's output and completion",
    JSON.stringify({ result: caught.result, output: caught.output }),
  );
  check(!caught.bodyOverflow, "the caught exception run does not overflow the page");
  await browser.screenshot("caught-exception");

  // The skip link is the first Tab stop and becomes visible when focused.
  await browser.evaluate(
    `(() => { document.body.tabIndex = -1; document.body.focus(); })()`,
  );
  await browser.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await browser.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await sleep(80);
  const skip = await browser.evaluate(`(() => {
    const link = document.querySelector(".skip-link");
    if (!link) return null;
    const rect = link.getBoundingClientRect();
    const style = getComputedStyle(link);
    const first = [...document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )][0];
    document.body.removeAttribute("tabindex");
    return {
      focused: document.activeElement === link,
      href: link.getAttribute("href"),
      top: Math.round(rect.top),
      inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
      outline: style.outlineStyle,
      target: Boolean(document.querySelector(link.getAttribute("href"))),
      first: first === link,
    };
  })()`);
  check(skip?.first, "the skip link is the first focusable element", String(skip?.first));
  check(skip?.focused && skip?.href === "#main", "the skip link leads to the main region", JSON.stringify(skip));
  check(skip?.inViewport && skip?.outline === "solid", "the focused skip link is visible", JSON.stringify(skip));
  check(skip?.target, "the skip link target exists", String(skip?.target));
}

// --- G. no console errors ---------------------------------------------------

async function consoleIsClean(browser) {
  // The mock planner endpoint fails on purpose in the AI scenarios; Chrome logs
  // the HTTP status itself. That is the endpoint under test, not an app error.
  const messages = (await browser.consoleMessages()).filter(
    (message) => !(message.url ?? "").includes("/api/plan"),
  );
  check(
    messages.length === 0,
    "no console errors or warnings",
    messages.map((message) => `${message.level}: ${message.text}`).join(" | "),
  );
}

// --- server ----------------------------------------------------------------

async function waitForServer(url, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error(`the dev server did not answer at ${url}`);
}

function startServer(port) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(`${npm} run dev -- --port ${port} --strictPort`, {
    cwd: ROOT,
    stdio: "ignore",
    shell: true,
    // The planner endpoint is a dev-only mock unless a real route is deployed.
    env: { ...process.env, CODELENS_PLANNER_DEV_MOCK: "1" },
  });
}

function stopServer(server) {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill();
  }
}

// --- main ------------------------------------------------------------------

async function main() {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = startServer(port);
  let browser = null;
  try {
    await waitForServer(base);
    browser = await launch(`${base}/visualizer/python`, { outDir: OUT });
    await browser.waitFor(
      `document.querySelector('textarea[aria-label="Your Python code"]')`,
      60000,
      "the code editor",
    );
    await planner(browser);
    await interruption(browser);
    await bubbleSort(browser);
    await playbackAndLayout(browser);
    await dataShapes(browser);
    await fallbacks(browser);
    await productPages(browser);
    await releaseRegressions(browser);
    await consoleIsClean(browser);
  } finally {
    browser?.close();
    stopServer(server);
  }

  console.log(
    `\n${checks.filter((entry) => entry.ok).length}/${checks.length} checks passed` +
      (failures.length === 0 ? " — ALL BROWSER CHECKS PASSED" : ` — FAILURES: ${failures.join(", ")}`),
  );
  if (failures.length > 0) process.exitCode = 1;
}

await main();
