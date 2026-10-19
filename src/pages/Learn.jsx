/* Learn index (Phase 5). Lists the lessons that exist; each lesson links
 * through to its own route. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import './pages.css';

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    lessons: [
      { id: 'introduction', title: 'Introduction to CodeLens' },
      { id: 'first-program', title: 'Your first Python program' },
    ],
  },
  {
    id: 'python-basics',
    title: 'Python basics',
    lessons: [{ id: 'variables-and-types', title: 'Variables and data types' }],
  },
];

export default function Learn() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Learn' }]}
        title="Learn programming"
        subtitle="Short lessons that open straight into the visualizer, so you can read an idea and immediately watch it run."
      />
      <div className="learn-sections">
        {SECTIONS.map((section) => (
          <section key={section.id} className="learn-section">
            <h2 className="learn-section-title">{section.title}</h2>
            <ul className="learn-lessons">
              {section.lessons.map((lesson) => (
                <li key={lesson.id}>
                  <Link to={`/learn/${section.id}/${lesson.id}`} className="learn-lesson">
                    {lesson.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
