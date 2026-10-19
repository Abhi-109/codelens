/* The site's navigation, as data. Split out of AppShell.jsx so the route
 * table, the footer and the tests all read the same source and can never
 * drift apart — node --test cannot import JSX, so the config lives here in
 * plain JS and the shell only renders it.

 * `match` is a route name (or list of names) from src/router.js that marks a
 * link active. "Visualize" matches both the language picker and the Python
 * visualizer: they are two doors into the same capability. */

export const NAV = [
  { to: '/', label: 'Home', match: 'home' },
  { to: '/get-started', label: 'Visualize', match: ['get-started', 'python-visualizer'] },
  { to: '/visualizer/data-structures', label: 'Data Structures', match: ['data-structures', 'data-structure'] },
  { to: '/learn', label: 'Learn', match: ['learn', 'lesson'] },
  { to: '/docs', label: 'Docs', match: ['docs', 'doc'] },
  { to: '/about', label: 'About', match: 'about' },
];

/** The footer repeats the nav without "Home" — the wordmark already goes there. */
export const FOOTER_LINKS = NAV.filter((item) => item.label !== 'Home');

/** Is this nav item the one the current route belongs to? */
export function isActive(routeName, match) {
  return Array.isArray(match) ? match.includes(routeName) : match === routeName;
}
