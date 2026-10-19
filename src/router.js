/* A very small History-API router: match a path against the route table, and
   drive the browser's back/forward buttons.

   Matching is a pure function so it can be tested without a browser; the
   React side (src/router.jsx) is a thin wrapper that holds the current path
   and re-renders on navigation. */

/** The site's routes, in the order they are most specific. `:name` segments
 *  capture one path piece; the rest of the path must match exactly. */
export const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/get-started', name: 'get-started' },
  { path: '/visualizer/python', name: 'python-visualizer' },
  { path: '/visualizer/data-structures', name: 'data-structures' },
  { path: '/visualizer/data-structures/:type', name: 'data-structure' },
  { path: '/learn', name: 'learn' },
  { path: '/learn/:section/:lesson', name: 'lesson' },
  { path: '/docs', name: 'docs' },
  { path: '/docs/:page', name: 'doc' },
  { path: '/about', name: 'about' },
];

/** Tidy a path for matching: strip query and hash, collapse a trailing
 *  slash, and treat an empty path as the home page. */
export function normalizePath(path) {
  if (typeof path !== 'string' || path === '') return '/';
  const bare = path.split(/[?#]/)[0];
  const collapsed = bare.replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

/** Match one path against one pattern. Returns the captured params (an
 *  object keyed by the pattern's `:names`), or null when it does not match. */
export function matchPath(pattern, path) {
  const patternParts = normalizePath(pattern).split('/');
  const pathParts = normalizePath(path).split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      // An empty piece can never be a real value ("/learn//" is not a lesson).
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

/** The first route in the table that matches this path, with its params.
 *  Null when nothing matches — the caller shows the 404 page. */
export function matchRoute(path, routes = ROUTES) {
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

/** Build a link for a named route with its params, e.g. ("lesson",
 *  { section: "basics", lesson: "1" }) -> "/learn/basics/1". */
export function buildPath(name, params = {}, routes = ROUTES) {
  const route = routes.find((r) => r.name === name);
  if (!route) throw new Error(`unknown route: ${name}`);
  return route.path
    .split('/')
    .map((piece) => {
      if (!piece.startsWith(':')) return piece;
      const key = piece.slice(1);
      if (!(key in params)) throw new Error(`missing param "${key}" for ${name}`);
      return encodeURIComponent(params[key]);
    })
    .join('/');
}
