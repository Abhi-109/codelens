// The universal stage contract, as a measurement rather than a promise.
//
// docs/redesign.md says every recorded step must produce a non-blank, truthful
// stage. This module answers that for one rendered step: which parts of the
// stage carry evidence, and whether the step is only a sentence (which is a
// legitimate outcome for a definition or a no-op line, as long as the line
// itself is named).
//
// It reads the plan and the view. It never runs Python, never invents a part,
// and never upgrades a text-only step into a visual one.

export const COVERAGE_PART = Object.freeze({
  line: "line",
  operation: "operation",
  values: "values",
  frames: "frames",
  output: "output",
  return: "return",
  ending: "ending",
  intro: "intro",
});

/** Parts that put something on the stage besides a line and a sentence. */
const VISUAL_PARTS = new Set([
  COVERAGE_PART.values,
  COVERAGE_PART.frames,
  COVERAGE_PART.output,
  COVERAGE_PART.return,
  COVERAGE_PART.ending,
  COVERAGE_PART.intro,
]);

/**
 * What the stage shows for one plan/view pair.
 *
 * @param {Object|null} plan a plan from `planMotion`
 * @param {Object|null} view a view from `motionView`
 * @returns {{covered: boolean, parts: string[], visual: boolean, blankReason: string|null}}
 */
export function coverageOf(plan, view) {
  if (!plan || !view) {
    return {
      covered: false,
      parts: [],
      visual: false,
      blankReason: "no recorded step to draw",
    };
  }

  const parts = [];
  if (Number.isInteger(view.line)) parts.push(COVERAGE_PART.line);
  if (view.feedback?.text) parts.push(COVERAGE_PART.operation);
  if (
    (view.scalars?.length ?? 0) > 0 ||
    (view.objects?.length ?? 0) > 0 ||
    (view.texts?.length ?? 0) > 0 ||
    view.structure
  ) {
    parts.push(COVERAGE_PART.values);
  }
  if ((view.frames?.length ?? 0) > 0) parts.push(COVERAGE_PART.frames);
  if (view.output) parts.push(COVERAGE_PART.output);
  if (view.lastReturn) parts.push(COVERAGE_PART.return);
  if (view.ending) parts.push(COVERAGE_PART.ending);
  if (view.intro) parts.push(COVERAGE_PART.intro);

  const covered = parts.length > 0;
  return {
    covered,
    parts,
    visual: parts.some((part) => VISUAL_PARTS.has(part)),
    blankReason: covered ? null : "the recording has no line, operation, value, frame, output or ending to draw",
  };
}

/**
 * A one-line summary for a whole run, used by tests and diagnostics.
 * `textOnly` steps are legitimate (a definition changes no data), but each one
 * must at least name the source line it describes.
 */
export function summarizeCoverage(steps) {
  const summary = { steps: 0, covered: 0, visual: 0, textOnly: 0, blank: 0, unanchored: 0 };
  for (const step of steps ?? []) {
    summary.steps += 1;
    if (!step?.covered) {
      summary.blank += 1;
      continue;
    }
    summary.covered += 1;
    if (step.visual) summary.visual += 1;
    else {
      summary.textOnly += 1;
      if (!step.anchor) summary.unanchored += 1;
    }
  }
  return summary;
}
