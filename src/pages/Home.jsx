/* Home. Phase 2 turns this into the full landing page; for the shell
 * milestone it already carries the headline, the explanation and the two
 * real buttons so the route is not a dead end. */

import { Link } from '../router.jsx';
import './pages.css';

export default function Home() {
  return (
    <div className="page-home">
      <span className="home-eyebrow">Visualize · Learn · Understand</span>
      <h1 className="home-title">
        See your code
        <br />
        come to life.
      </h1>
      <p className="home-lede">
        CodeLens shows you how a Python program executes, one step at a time:
        which line runs, what every variable holds, which calls are open, and what
        got printed — with a plain-English explanation at every step.
      </p>
      <div className="home-actions">
        <Link to="/visualizer/python" className="btn btn-primary">
          Start Visualizing →
        </Link>
        <Link to="/docs" className="btn">
          Explore Features
        </Link>
      </div>
    </div>
  );
}
