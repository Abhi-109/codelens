/* Docs index (Phase 5). Lists documentation pages by name; the content
 * arrives with that milestone. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import './pages.css';

const PAGES = [
  { slug: 'getting-started', title: 'Getting started' },
  { slug: 'python-visualizer', title: 'Python visualizer' },
  { slug: 'supported-python', title: 'Supported Python' },
  { slug: 'data-structures', title: 'Data structures' },
  { slug: 'faq', title: 'FAQ' },
];

export default function Docs() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Documentation' }]}
        title="Documentation"
        subtitle="How CodeLens works, what the visualizer shows, and what the tracer supports."
      />
      <ul className="docs-list">
        {PAGES.map((page) => (
          <li key={page.slug}>
            <Link to={`/docs/${page.slug}`} className="docs-item">
              {page.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
