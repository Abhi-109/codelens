/* One documentation page, e.g. /docs/python-visualizer.
 *
 * The body is data from docsContent.js; this file only lays it out. Unknown
 * slugs get the 404 state. It shares the lesson typography (.prose) on
 * purpose: both are reading pages, not the workspace. */

import { PageHeader } from '../shell/AppShell.jsx';
import { NotFoundState } from '../shell/states.jsx';
import { docBySlug } from './docsContent.js';
import { Blocks } from './Prose.jsx';
import './pages.css';

export default function Doc({ page }) {
  const entry = docBySlug(page);
  if (!entry) return <NotFoundState />;
  return (
    <article className="lesson">
      <PageHeader
        crumbs={[{ label: 'Documentation', to: '/docs' }, { label: entry.title }]}
        title={entry.title}
        subtitle={entry.summary}
      />
      <div className="prose">
        <Blocks blocks={entry.blocks} />
      </div>
    </article>
  );
}
