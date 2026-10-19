/* One lesson, e.g. /learn/getting-started/introduction. Lesson bodies land
 * with the learning milestone; until then this route names itself honestly
 * rather than showing filler prose. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { EmptyState, NotFoundState } from '../shell/states.jsx';

const LESSONS = {
  introduction: 'Introduction to CodeLens',
  'first-program': 'Your first Python program',
  'variables-and-types': 'Variables and data types',
};

export default function Lesson({ section, lesson }) {
  const title = LESSONS[lesson];
  if (!title) return <NotFoundState />;
  return (
    <div>
      <PageHeader
        crumbs={[
          { label: 'Learn', to: '/learn' },
          { label: section },
          { label: title },
        ]}
        title={title}
      />
      <EmptyState title="Lesson not written yet">
        <p>
          This lesson is planned for the learning milestone. You can already run
          any example in the{' '}
          <Link to="/visualizer/python">Python visualizer</Link> and step through it.
        </p>
      </EmptyState>
    </div>
  );
}
