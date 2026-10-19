/**
 * The workspace's shared selection rules.
 *
 * Two things are selected at all times: the execution step, which every
 * surface in the workspace reads from the one `getStepView` call, and the
 * inspector tab, which only decides what is drawn next to it. They are held
 * separately on purpose - picking a different tab must never move the step -
 * and the functions below are the only way either is changed, so that
 * guarantee is written down as code rather than left to convention.
 */

export const INSPECTOR_TABS = [
  { id: "explain", label: "Explain" },
  { id: "variables", label: "Variables" },
  { id: "stack", label: "Stack" },
  { id: "memory", label: "Memory" },
  { id: "output", label: "Output" },
  { id: "history", label: "History" },
];

export const INSPECTOR_TAB_IDS = INSPECTOR_TABS.map((tab) => tab.id);

export const DEFAULT_INSPECTOR_TAB = "explain";

/** Clamp a wanted step onto the trace. An empty trace is step 0 of 0. */
export function clampStep(index, traceLength) {
  const last = Math.max(traceLength - 1, 0);
  return Math.max(0, Math.min(Number(index) || 0, last));
}

/** The step `delta` places away, clamped at both ends. */
export function stepBy(index, traceLength, delta) {
  return clampStep((Number(index) || 0) + (Number(delta) || 0), traceLength);
}

/**
 * Choose an inspector tab. Every field of `state` other than `tab` is carried
 * through untouched - in particular the execution step - so switching what you
 * are looking at cannot change where the program is. An unknown tab id keeps
 * the current one instead of blanking the panel.
 */
export function selectInspectorTab(state, tabId) {
  const tab = INSPECTOR_TAB_IDS.includes(tabId) ? tabId : (state?.tab ?? DEFAULT_INSPECTOR_TAB);
  return state && state.tab === tab ? state : { ...state, tab };
}

/** The tab a fresh workspace opens on: the plain-English explanation. */
export function initialInspectorTab() {
  return { tab: DEFAULT_INSPECTOR_TAB };
}

/* --- The Combined view's own subview ------------------------------------- */

/**
 * The Combined view draws the call tree beside one other thing. These two
 * decide what that is, and they follow exactly the rule the inspector tab
 * follows: a selection that changes only what you are looking at cannot change
 * where the program is, so no field but the choice itself is touched.
 */
export const COMBINED_SUBVIEWS = [
  { id: "stack", label: "Calls" },
  { id: "variables", label: "Variables" },
];

export const COMBINED_SUBVIEW_IDS = COMBINED_SUBVIEWS.map((entry) => entry.id);

export const DEFAULT_COMBINED_SUBVIEW = "stack";

/**
 * Choose what sits beside the call tree. An unknown id keeps the current
 * subview rather than blanking the pane.
 */
export function selectCombinedSubview(state, id) {
  const subview = COMBINED_SUBVIEW_IDS.includes(id)
    ? id
    : (state?.subview ?? DEFAULT_COMBINED_SUBVIEW);
  return state && state.subview === subview ? state : { ...state, subview };
}

/** The subview a fresh Combined view opens on: which calls are running. */
export function initialCombinedSubview() {
  return { subview: DEFAULT_COMBINED_SUBVIEW };
}
