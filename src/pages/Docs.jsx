/* Docs index. The list comes from the same module the doc pages read, so an
 * entry always has a page behind it. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { DOC_PAGES } from './docsContent.js';
import './pages.css';

export default function Docs() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Documentation' }]}
        title="Documentation"
        subtitle="How CodeLens works, what the visualizer shows, and what the tracer supports."
      />
      <ul className="docs-list">
        {DOC_PAGES.map((page) => (
          <li key={page.slug}>
            <Link to={`/docs/${page.slug}`} className="docs-item">
              <span className="docs-title">{page.title}</span>
              <span className="docs-summary">{page.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
