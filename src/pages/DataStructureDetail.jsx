/* One data structure's page, e.g. /visualizer/data-structures/stack. The
 * type comes from the URL; unknown types get the 404 state instead of a
 * blank screen. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { EmptyState, NotFoundState } from '../shell/states.jsx';

const NAMES = {
  array: 'Array',
  stack: 'Stack',
  queue: 'Queue',
  'linked-list': 'Linked list',
};

export default function DataStructureDetail({ type }) {
  const name = NAMES[type];
  if (!name) return <NotFoundState />;
  return (
    <div>
      <PageHeader
        crumbs={[
          { label: 'Visualize', to: '/get-started' },
          { label: 'Data Structures', to: '/visualizer/data-structures' },
          { label: name },
        ]}
        title={`${name} visualizer`}
        subtitle="Operations, animation steps and a plain-English log for this structure."
      />
      <EmptyState title="Not built yet">
        <p>
          This structure is planned for the data-structure visualizer milestone.
          The Python visualizer at{' '}
          <Link to="/visualizer/python">/visualizer/python</Link> works today.
        </p>
      </EmptyState>
    </div>
  );
}
