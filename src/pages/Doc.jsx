/* One docs page, e.g. /docs/getting-started. Content arrives with the
 * documentation milestone; unknown slugs get the 404 state. */

import { PageHeader } from '../shell/AppShell.jsx';
import { EmptyState, NotFoundState } from '../shell/states.jsx';

const TITLES = {
  'getting-started': 'Getting started',
  'python-visualizer': 'Python visualizer',
  'supported-python': 'Supported Python',
  'data-structures': 'Data structures',
  faq: 'FAQ',
};

export default function Doc({ page }) {
  const title = TITLES[page];
  if (!title) return <NotFoundState />;
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Documentation', to: '/docs' }, { label: title }]} title={title} />
      <EmptyState title="Not written yet">
        <p>
          This page is planned for the documentation milestone. Until it exists,
          the repository docs describe the tracer and the trace format in detail.
        </p>
      </EmptyState>
    </div>
  );
}
