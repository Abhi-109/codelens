/* One lesson, e.g. /learn/getting-started/introduction.
 *
 * The body is data from lessons.js; this file only lays it out: objectives,
 * prose, the runnable example (with a link that loads that exact program into
 * the visualizer), checkpoints, and the previous/next links. Unknown routes
 * get the 404 state rather than a blank page.
 */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { NotFoundState } from '../shell/states.jsx';
import { exampleById } from '../examples.js';
import { structureByType } from '../datastructures/model.js';
import { findLesson, lessonNeighbours } from './lessons.js';
import { Blocks, Checkpoints } from './Prose.jsx';
import './pages.css';

export default function Lesson({ section, lesson }) {
  const entry = findLesson(section, lesson);
  if (!entry) return <NotFoundState />;
  const example = entry.exampleId ? exampleById(entry.exampleId) : null;
  const lab = entry.lab ? structureByType(entry.lab.type) : null;
  const { previous, next } = lessonNeighbours(section, lesson);

  return (
    <article className="lesson">
      <PageHeader
        crumbs={[
          { label: 'Learn', to: '/learn' },
          { label: entry.sectionTitle, to: '/learn' },
          { label: entry.title },
        ]}
        title={entry.title}
        subtitle={entry.summary}
      />

      <section className="lesson-objectives" aria-labelledby="lesson-objectives">
        <h2 id="lesson-objectives">What you will learn</h2>
        <ul>
          {entry.objectives.map((objective) => (
            <li key={objective}>{objective}</li>
          ))}
        </ul>
      </section>

      <div className="prose">
        <Blocks blocks={entry.body} />
      </div>

      {example ? (
        <section className="lesson-example" aria-labelledby="lesson-example">
          <h2 id="lesson-example">Try it: {example.name}</h2>
          <pre className="lesson-code">
            <code>{example.code.replace(/\n$/, '')}</code>
          </pre>
          <Link className="btn btn-primary" to={`/visualizer/python?example=${example.id}`}>
            Open this program in the visualizer
            <span aria-hidden="true">→</span>
          </Link>
          <p className="lesson-hint">
            The program opens in the editor. Press Run to record it, then step through the
            events this lesson describes.
          </p>
        </section>
      ) : lab ? (
        <section className="lesson-example" aria-labelledby="lesson-example">
          <h2 id="lesson-example">Try it: the {lab.name} lab</h2>
          <p className="lesson-hint">
            The lab is an authored operation model, not a Python trace. This lesson opens it
            with a prepared dataset so the first step already shows what the lesson describes.
          </p>
          <Link
            className="btn btn-primary"
            to={`/visualizer/data-structures/${lab.type}${entry.lab.preset ? `?preset=${entry.lab.preset}` : ''}`}
          >
            Open the {lab.name} lab
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      ) : null}

      <section className="lesson-checkpoints" aria-labelledby="lesson-checkpoints">
        <h2 id="lesson-checkpoints">Check yourself</h2>
        <Checkpoints items={entry.checkpoints} />
      </section>

      <nav className="lesson-nav" aria-label="Lessons">
        {previous ? (
          <Link to={`/learn/${previous.section}/${previous.id}`} className="lesson-nav-link">
            <span className="lesson-nav-label">Previous</span>
            <span className="lesson-nav-title">{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={`/learn/${next.section}/${next.id}`} className="lesson-nav-link lesson-nav-next">
            <span className="lesson-nav-label">Next</span>
            <span className="lesson-nav-title">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
