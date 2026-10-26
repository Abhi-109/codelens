/* The React half of the router: holds the current path, listens to the
 *  browser's back/forward buttons, and exposes <Link> for navigation.
 *  Matching lives in router.js where it can be tested without a browser;
 *  the context lives in routerContext.js so this file exports only
 *  components. */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { matchRoute, normalizePath } from './router.js';
import { RouterContext, useRouter } from './routerContext.js';

/** Provides { path, match, navigate } to everything inside it. */
export function Router({ children }) {
  const [path, setPath] = useState(() =>
    normalizePath(typeof window === 'undefined' ? '/' : window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    // Matching ignores the query, but the URL keeps it: a lesson links to
    // /visualizer/python?example=... and the visualizer reads that id when it
    // mounts. Only the path decides whether this is the same page.
    const url = String(to);
    const next = normalizePath(url);
    if (next === normalizePath(window.location.pathname) && url === window.location.pathname + window.location.search) {
      return;
    }
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    // A new page starts at the top, like any link the browser handles itself.
    window.scrollTo(0, 0);
    setPath(next);
  }, []);

  const value = useMemo(
    () => ({ path, match: matchRoute(path), navigate }),
    [path, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** An ordinary <a> that navigates in place. Modified clicks (new tab, save,
 *  etc.) and middle-clicks are left to the browser, so the links still work
 *  the way people expect. */
export function Link({ to, children, onClick, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (rest.target && rest.target !== '_self')
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
