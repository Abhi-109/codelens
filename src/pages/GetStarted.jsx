/* Language selection. Only Python is real: everything else is explicitly
 * "Coming Soon" and cannot be navigated to, because the repository has one
 * tracer and it runs Python. */

import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import './pages.css';

const LANGUAGES = [
  {
    id: 'python',
    name: 'Python',
    available: true,
    blurb: 'Write or paste a program, run it, and step through every line with variables, calls and output.',
  },
  { id: 'javascript', name: 'JavaScript', available: false, blurb: 'Step through JS execution.' },
  { id: 'java', name: 'Java', available: false, blurb: 'Step through Java execution.' },
  { id: 'cpp', name: 'C++', available: false, blurb: 'Step through C++ execution.' },
];

export default function GetStarted() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Get Started' }, { label: 'Choose a language' }]}
        title="Choose a programming language"
        subtitle="Pick the language you want to visualize. More languages are planned; Python is the one that runs today."
      />
      <div className="lang-grid">
        {LANGUAGES.map((lang) =>
          lang.available ? (
            <Link key={lang.id} to="/visualizer/python" className="lang-card lang-card-live">
              <span className="lang-name">{lang.name}</span>
              <span className="lang-badge lang-badge-live">Available now</span>
              <span className="lang-blurb">{lang.blurb}</span>
              <span className="lang-cta">Start with {lang.name} →</span>
            </Link>
          ) : (
            <div key={lang.id} className="lang-card" aria-disabled="true">
              <span className="lang-name">{lang.name}</span>
              <span className="lang-badge">Coming soon</span>
              <span className="lang-blurb">{lang.blurb}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
