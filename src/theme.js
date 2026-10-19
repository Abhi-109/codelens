/* The theme is a <html data-theme="dark|light"> attribute. This module owns
   reading the stored choice, falling back to the system preference, applying
   it to the document, and keeping it in step with the OS while the visitor
   has not expressed an opinion of their own.

   The pure part (resolving which theme to show) is exported separately so it
   can be tested without a browser. */

const STORE_KEY = 'codelens-theme';

/** Returns "dark" or "light" for anything a storage cell or attribute can
 *  legitimately hold; null for anything else (missing, typo, older value). */
export function normalizeTheme(value) {
  return value === 'dark' || value === 'light' ? value : null;
}

/** The theme to show: the visitor's stored choice wins, otherwise the OS.
 *  Both inputs may be missing, which lands on light — the documented default. */
export function resolveTheme(stored, prefersDark) {
  return normalizeTheme(stored) ?? (prefersDark ? 'dark' : 'light');
}

/** Which theme the OS would pick right now (null-safe: no window, no matchMedia). */
export function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** The stored choice, or null when the visitor has never picked one. */
export function readStoredTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem(STORE_KEY));
  } catch {
    // Storage can be blocked (private mode, iframe). Fall back to the OS.
    return null;
  }
}

/** Remember the choice. A failure here is not worth interrupting anyone for. */
export function storeTheme(theme) {
  try {
    window.localStorage.setItem(STORE_KEY, theme);
  } catch {
    // Ignore: the theme still applies for this session.
  }
}

/** Paint the document in this theme, and tell anyone listening. */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('codelens:theme', { detail: theme }));
  }
}

/** The current theme as painted (defaults to light if nothing set it). */
export function currentTheme() {
  return normalizeTheme(document.documentElement.getAttribute('data-theme')) ?? 'light';
}

let watching = false;

/** Apply the resolved theme now, and follow the OS afterwards while the
 *  visitor has not chosen. Calling more than once is safe. */
export function initTheme() {
  applyTheme(resolveTheme(readStoredTheme(), systemPrefersDark()));
  if (watching || typeof window.matchMedia !== 'function') return;
  watching = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readStoredTheme() === null) applyTheme(systemPrefersDark() ? 'dark' : 'light');
  });
}

/** Switch theme, remember it, and return the new theme. */
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  storeTheme(next);
  return next;
}
