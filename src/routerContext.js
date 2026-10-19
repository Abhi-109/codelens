/* The router's React context, in its own file so that router.jsx exports
 * only components (which keeps fast refresh working). */

import { createContext, useContext } from 'react';

export const RouterContext = createContext(null);

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside <Router>');
  return ctx;
}
