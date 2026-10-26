/* Learn index. Lists the lessons that exist, from the same module the
 * lesson pages read, so the index can never link to a lesson that has no
 * body. Each lesson opens its own route. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { LESSON_SECTIONS } from './lessons.js';
import './pages.css';

export default function Learn() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Learn' }]}
        title="Learn programming"
        subtitle="Short lessons that open straight into the visualizer, so you can read an idea and immediately watch it run."
      />
      <div className="learn-sections">
        {LESSON_SECTIONS.map((section) => (
          <section key={section.id} className="learn-section">
            <h2 className="learn-section-title">{section.title}</h2>
            <ul className="learn-lessons">
              {section.lessons.map((lesson) => (
                <li key={lesson.id}>
                  <Link to={`/learn/${section.id}/${lesson.id}`} className="learn-lesson">
                    <span className="learn-lesson-title">{lesson.title}</span>
                    <span className="learn-lesson-summary">{lesson.summary}</span>
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
