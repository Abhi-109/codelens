// The Focus surface's small, testable decisions: which surface to show, where
// the split sits, and how a drag maps to a percentage.
//
// None of this touches the execution session. The cursor, playback and speed
// belong to the run; these helpers only decide how the two panes are drawn.

export const SURFACES = ["focus", "studio"];
export const DEFAULT_SURFACE = "focus";
export const SURFACE_STORAGE_KEY = "codelens-surface";

export const FOCUS_COLUMNS_KEY = "codelens.focus.columns";
export const DEFAULT_FOCUS_LEFT = 38;
export const MIN_FOCUS_LEFT = 28;
export const MAX_FOCUS_LEFT = 58;

/** True when `value` names a surface this build has. */
export function isSurface(value) {
  return SURFACES.includes(value);
}

/**
 * Load the remembered surface. Focus is the default; anything unreadable or
 * unknown falls back to it instead of leaving the page blank.
 */
export function loadSurface(store = defaultStore()) {
  if (!store) return DEFAULT_SURFACE;
  try {
    const raw = store.getItem(SURFACE_STORAGE_KEY);
    return isSurface(raw) ? raw : DEFAULT_SURFACE;
  } catch {
    return DEFAULT_SURFACE;
  }
}

/** Remember the surface. Returns whether the write happened; never throws. */
export function saveSurface(surface, store = defaultStore()) {
  if (!isSurface(surface) || !store) return false;
  try {
    store.setItem(SURFACE_STORAGE_KEY, surface);
    return true;
  } catch {
    return false;
  }
}

/** Clamp the editor's share of the width to the usable range. */
export function clampFocusLeft(value) {
  const left = Number(value);
  if (!Number.isFinite(left)) return DEFAULT_FOCUS_LEFT;
  return Math.min(Math.max(left, MIN_FOCUS_LEFT), MAX_FOCUS_LEFT);
}

/**
 * The new editor share after dragging to `pointerX` inside `rect`.
 * `startLeft` is the percentage when the drag began.
 */
export function splitLeft(startLeft, pointerX, startX, width) {
  if (!Number.isFinite(pointerX) || !Number.isFinite(width) || width <= 0) {
    return clampFocusLeft(startLeft);
  }
  const delta = ((pointerX - startX) / width) * 100;
  return clampFocusLeft(clampFocusLeft(startLeft) + delta);
}

/** The saved split, or the default. A blocked store never breaks the layout. */
export function loadFocusLeft(store = defaultStore()) {
  if (!store) return DEFAULT_FOCUS_LEFT;
  try {
    const raw = store.getItem(FOCUS_COLUMNS_KEY);
    if (raw === null) return DEFAULT_FOCUS_LEFT;
    const parsed = JSON.parse(raw);
    return clampFocusLeft(parsed?.left ?? DEFAULT_FOCUS_LEFT);
  } catch {
    return DEFAULT_FOCUS_LEFT;
  }
}

/** Save the split. Returns whether the write happened; never throws. */
export function saveFocusLeft(left, store = defaultStore()) {
  if (!store) return false;
  try {
    store.setItem(FOCUS_COLUMNS_KEY, JSON.stringify({ left: clampFocusLeft(left) }));
    return true;
  } catch {
    return false;
  }
}

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
