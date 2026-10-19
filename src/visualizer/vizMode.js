/**
 * The visualization mode: which canvas draws the run.
 *
 * There is more than one, and they are all windows onto *one* execution. Selecting a
 * different one changes nothing about the program: the trace, the step the
 * learner is on, the playing state and the speed are untouched, exactly the
 * way the inspector tabs behave. `selectViz` is the only way the choice
 * changes, and it carries every other field of the workspace through untouched
 * so that guarantee is written down as code.
 *
 * The mode is presentation only, so it is remembered between visits like the
 * learning mode is — but an unreadable or missing value falls back to the
 * default rather than blanking the canvas.
 */

/** Every canvas the workspace can draw, in the order they are offered. */
export const VIZ_MODES = ["tree", "flow", "combined"];

export const DEFAULT_VIZ = "tree";
export const VIZ_STORAGE_KEY = "codelens-viz";

export const VIZ_LABELS = {
  tree: "Call tree",
  flow: "Control flow",
  combined: "Combined",
};

export const VIZ_BLURBS = {
  tree: "Every call the program made, nested under the call that made it",
  flow: "The decision shapes the code has, with the path this run took lit up",
  combined: "The call tree beside the stack and the variables of the current step",
};

/** True when `value` names a canvas this build actually has. */
export function isVizMode(value) {
  return VIZ_MODES.includes(value);
}

/** A usable mode: the choice if we have it, otherwise the default. */
export function normalizeViz(value) {
  return isVizMode(value) ? value : DEFAULT_VIZ;
}

/**
 * Choose a visualization. Every field other than `viz` is carried through
 * untouched — in particular the execution step — so switching canvas cannot
 * move the program. An unknown mode keeps the current one instead of blanking
 * the pane.
 */
export function selectViz(state, viz) {
  const next = isVizMode(viz) ? viz : (state?.viz ?? DEFAULT_VIZ);
  return state && state.viz === next ? state : { ...state, viz: next };
}

/** The canvas a fresh workspace opens on: the saved one, or Call tree. */
export function initialViz() {
  return { viz: loadViz() };
}

/** Move `delta` places along the offered canvases, wrapping at the ends. */
export function stepViz(current, delta) {
  const n = VIZ_MODES.length;
  if (n === 0) return DEFAULT_VIZ;
  const from = Math.max(VIZ_MODES.indexOf(normalizeViz(current)), 0);
  const step = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
  const to = (((from + step) % n) + n) % n;
  return VIZ_MODES[to];
}

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved canvas, or the default. Anything unusable falls back safely. */
export function loadViz(store = defaultStore()) {
  if (!store) return DEFAULT_VIZ;
  let raw = null;
  try {
    raw = store.getItem(VIZ_STORAGE_KEY);
  } catch {
    return DEFAULT_VIZ;
  }
  return isVizMode(raw) ? raw : DEFAULT_VIZ;
}

/** Save a canvas. Returns whether the write happened; never throws. */
export function saveViz(viz, store = defaultStore()) {
  if (!isVizMode(viz) || !store) return false;
  try {
    store.setItem(VIZ_STORAGE_KEY, viz);
    return true;
  } catch {
    return false;
  }
}
