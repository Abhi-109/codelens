/* Route table: which component renders for which route name, plus the
 * top-level <Site> that turns the router's current match into a page.
 * Keeping this separate from the matching logic (router.js) means the table
 * can be swapped or lazily loaded without touching the tested code. */

import { lazy, Suspense } from 'react';

import { useRouter } from './routerContext.js';
import { AppShell } from './shell/AppShell.jsx';
import { LoadingState, NotFoundState } from './shell/states.jsx';

import Home from './pages/Home.jsx';
import GetStarted from './pages/GetStarted.jsx';
import DataStructures from './pages/DataStructures.jsx';
import DataStructureDetail from './pages/DataStructureDetail.jsx';
import Learn from './pages/Learn.jsx';
import Lesson from './pages/Lesson.jsx';
import Docs from './pages/Docs.jsx';
import Doc from './pages/Doc.jsx';
import About from './pages/About.jsx';

/* The Python visualizer is most of the app's JavaScript: the tracer client,
 * the motion planner and every canvas. The landing page and the reading pages
 * never need it, so it loads on its own route instead of blocking first paint.
 * Everything else stays eager; splitting pages this small costs more requests
 * than it saves. */
const PythonVisualizer = lazy(() => import('./pages/PythonVisualizer.jsx'));

const PAGES = {
  home: Home,
  'get-started': GetStarted,
  'python-visualizer': PythonVisualizer,
  'data-structures': DataStructures,
  'data-structure': DataStructureDetail,
  learn: Learn,
  lesson: Lesson,
  docs: Docs,
  doc: Doc,
  about: About,
};

/** Renders the page for the current route inside the shell; a path that
 *  matches nothing gets the 404 state. */
function RouteView({ match }) {
  if (!match) {
    return (
      <AppShell>
        <NotFoundState />
      </AppShell>
    );
  }
  const Page = PAGES[match.route.name];
  // The playground owns the whole screen; every other page scrolls.
  return (
    <AppShell wide={match.route.name !== 'python-visualizer'}>
      <Suspense fallback={<LoadingState label="Loading the visualizer…" />}>
        <Page {...match.params} />
      </Suspense>
    </AppShell>
  );
}

/** The current route's page. Sits here (not in main.jsx) so that entry file
 *  stays a three-line mount and fast refresh keeps working. */
export default function Site() {
  const { match } = useRouter();
  return <RouteView match={match} />;
}
