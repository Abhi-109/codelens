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
      rowScrolls: row ? row.scrollWidth > row.clientWidth + 1 : false,
      rowScrollWidth: row?.scrollWidth ?? null,
      rowClientWidth: row?.clientWidth ?? null,
      noValues: Boolean(stage.querySelector(".motion-no-values")),
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

// --- A. the interruption regression ----------------------------------------

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
      compare.rowBottom !== null &&
      compare.explainTop >= compare.rowBottom &&
      compare.explainTop - compare.rowBottom < 40,
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
    swapped.cells[0].border === "rgb(77, 140, 255)" &&
      swapped.cells[1].border === "rgb(77, 140, 255)",
    "the blue ring persists after movement",
    `${swapped.cells[0].border} / ${swapped.cells[1].border}`,
  );
  check(
    swapped.ghosts.every((ghost) => ghost.visible === "hidden" || ghost.opacity === "0"),
    "no stale ghost after the swap",
    JSON.stringify(swapped.ghosts),
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
    /rgb\(74, 222, 128\)/.test(both[0]?.shadow ?? "") &&
      /rgb\(77, 140, 255\)/.test(both[0]?.shadow ?? ""),
    "the layered cell keeps both the green inset and the blue outer ring",
    both[0]?.shadow,
  );
  check(
    both[0]?.indexColor === "rgb(74, 222, 128)",
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
        /rgb\(74, 222, 128\)/.test(cell.shadow) && /rgb\(251, 191, 36\)/.test(cell.shadow),
    ),
    "the gold ring sits outside the green inset ring",
    goldOnGreen.map((cell) => cell.shadow).join(" | "),
  );
  check(
    goldOnGreen.every((cell) => cell.indexColor === "rgb(74, 222, 128)"),
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

// --- D. no console errors ---------------------------------------------------

async function consoleIsClean(browser) {
  const messages = await browser.consoleMessages();
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
    await interruption(browser);
    await bubbleSort(browser);
    await playbackAndLayout(browser);
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
