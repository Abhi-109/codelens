/**
 * Playback timing for the step player.
 *
 * The interval is milliseconds per step: smaller is faster. The default rate
 * is the original rate reduced by exactly 35%, i.e. 65% of the old steps per
 * second, so the base is `original ÷ 0.65` and every speed multiplier stays
 * relative to that base. A speed of `1x` therefore plays the new slower
 * default; `2x` is twice that; and so on.
 *
 * Everything here is pure apart from the two storage helpers, which take the
 * store as a parameter so they can be tested without a browser.
 */

/** Milliseconds per step before the slowdown. */
export const ORIGINAL_INTERVAL_MS = 800;

/** The default plays at 65% of the original rate: a 35% reduction. */
export const DEFAULT_RATE_FRACTION = 0.65;

/** Milliseconds per step at `1x`, the new default. */
export const BASE_INTERVAL_MS = ORIGINAL_INTERVAL_MS / DEFAULT_RATE_FRACTION;

/** The speeds offered in the picker, and the one a fresh session starts on. */
export const SPEED_OPTIONS = [0.5, 1, 2, 4];
export const DEFAULT_SPEED = 1;

export const SPEED_STORAGE_KEY = "codelens-speed";

/** True when `value` names one of the offered speeds (as a number or string). */
export function isSpeed(value) {
  return SPEED_OPTIONS.includes(Number(value));
}

/**
 * Milliseconds between steps at `speed`. An unknown or missing speed falls
 * back to the default rather than stalling the player or racing ahead.
 */
export function playbackIntervalMs(speed) {
  const safe = isSpeed(speed) ? Number(speed) : DEFAULT_SPEED;
  return BASE_INTERVAL_MS / safe;
}

/** Steps per second at `speed`, so the rate change can be checked directly. */
export function playbackStepsPerSecond(speed) {
  return 1000 / playbackIntervalMs(speed);
}

/** The original steps per second, the baseline the default is measured against. */
export const ORIGINAL_STEPS_PER_SECOND = 1000 / ORIGINAL_INTERVAL_MS;

function defaultStore() {
  // Reading localStorage throws outright when it is blocked or disabled, so
  // every path through this module degrades to the default instead of failing.
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The saved speed, or the default. Anything unusable - no store, no value,
 * a value we never offered, storage that throws - returns `DEFAULT_SPEED`, so
 * a stale or corrupt preference can never override the intended default.
 */
export function loadSpeed(store = defaultStore()) {
  if (!store) return DEFAULT_SPEED;
  let raw = null;
  try {
    raw = store.getItem(SPEED_STORAGE_KEY);
  } catch {
    return DEFAULT_SPEED;
  }
  if (raw === null || raw === undefined || raw === "") return DEFAULT_SPEED;
  return isSpeed(raw) ? Number(raw) : DEFAULT_SPEED;
}

/**
 * Save a speed. Refuses to write a value that is not on the offered list, and
 * reports whether the write happened, so callers never assume persistence.
 */
export function saveSpeed(speed, store = defaultStore()) {
  if (!isSpeed(speed) || !store) return false;
  try {
    store.setItem(SPEED_STORAGE_KEY, String(Number(speed)));
    return true;
  } catch {
    return false;
  }
}
