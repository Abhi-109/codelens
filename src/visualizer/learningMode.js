/**
 * The learning mode: one global choice that sets how much technical detail
 * the whole workspace uses.
 *
 * It changes presentation only - the same trace is rendered in every mode, so
 * a step means exactly the same thing whether a learner is in Beginner or
 * Advanced. Nothing here hides an execution fact that the learner needs; the
 * modes only decide whether the vocabulary around it is plain English or the
 * precise term.
 */

export const LEARNING_MODES = ["beginner", "advanced", "textbook"];
export const DEFAULT_MODE = "beginner";
export const MODE_STORAGE_KEY = "codelens-mode";

export const MODE_LABELS = {
  beginner: "Beginner",
  advanced: "Advanced",
  textbook: "Textbook",
};

export const MODE_BLURBS = {
  beginner: "Plain English, values and changes, nothing technical",
  advanced: "The precise terms, execution metadata and raw trace detail",
  textbook: "A structured walk through control flow and execution",
};

/** True when `value` names one of the three modes. */
export function isLearningMode(value) {
  return LEARNING_MODES.includes(value);
}

/**
 * What a mode shows across the workspace. Every flag is a presentation
 * decision, never a fact about the run:
 *
 * - `showTypes`   - the declared type of each value in Variables.
 * - `showScope`   - which call a name belongs to in Variables.
 * - `showMeta`    - the one-line execution metadata strip in Explain.
 * - `structured`  - the textbook control-flow framing for Explain.
 *
 * Nothing here is allowed to switch off an execution fact: the Developer menu
 * keeps the raw trace for every mode, because a learner's setting must not
 * decide what a person debugging the tracer is permitted to see.
 */
export function modeDetail(mode) {
  const m = isLearningMode(mode) ? mode : DEFAULT_MODE;
  if (m === "advanced") {
    return {
      showTypes: true,
      showScope: true,
      showMeta: true,
      structured: false,
    };
  }
  if (m === "textbook") {
    return {
      showTypes: true,
      showScope: false,
      showMeta: false,
      structured: true,
    };
  }
  return {
    showTypes: false,
    showScope: false,
    showMeta: false,
    structured: false,
  };
}

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved mode, or the default. Anything unusable falls back safely. */
export function loadMode(store = defaultStore()) {
  if (!store) return DEFAULT_MODE;
  let raw = null;
  try {
    raw = store.getItem(MODE_STORAGE_KEY);
  } catch {
    return DEFAULT_MODE;
  }
  return isLearningMode(raw) ? raw : DEFAULT_MODE;
}

/** Save a mode. Returns whether the write happened; never throws. */
export function saveMode(mode, store = defaultStore()) {
  if (!isLearningMode(mode) || !store) return false;
  try {
    store.setItem(MODE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
