/* Data structure visualizer (Phase 4). The route, breadcrumbs and structure
 * list are real; the operations themselves arrive with that phase, so this
 * page says so rather than pretending to run anything. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { EmptyState } from '../shell/states.jsx';
import './pages.css';

const STRUCTURES = [
  { type: 'array', name: 'Array' },
  { type: 'stack', name: 'Stack' },
  { type: 'queue', name: 'Queue' },
  { type: 'linked-list', name: 'Linked list' },
];

export default function DataStructures() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Visualize', to: '/get-started' }, { label: 'Data Structures' }]}
        title="Data structure visualizer"
        subtitle="Watch arrays, stacks, queues and linked lists change as you apply operations to them — separate from the Python tracer."
      />
      <EmptyState title="Not built yet">
        <p>
          The structure pickers below are the planned set. The visualizer itself is
          the next milestone after the Python visualizer work; nothing here runs yet.
        </p>
      </EmptyState>
      <ul className="ds-list">
        {STRUCTURES.map((s) => (
          <li key={s.type}>
            <Link to={`/visualizer/data-structures/${s.type}`} className="ds-item">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
