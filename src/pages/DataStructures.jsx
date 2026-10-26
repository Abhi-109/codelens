/* Data-structure lab index. The list comes from the same model the lab
 * reads, so a structure cannot appear here without an operation model
 * behind it. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { STRUCTURES } from '../datastructures/model.js';
import '../datastructures/datastructures.css';
import './pages.css';

export default function DataStructures() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Visualize', to: '/get-started' }, { label: 'Data Structures' }]}
        title="Data structure visualizer"
        subtitle="Apply operations and step through a recorded change to an array, linked list, stack, queue, tree or graph — separate from the Python tracer."
      />
      <p className="ds-badge">Authored operation model · not a Python trace</p>
      <ul className="ds-list">
        {STRUCTURES.map((structure) => (
          <li key={structure.type}>
            <Link to={`/visualizer/data-structures/${structure.type}`} className="ds-item">
              <span className="ds-item-name">{structure.name}</span>
              <span className="ds-item-blurb">{structure.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
