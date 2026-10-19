/* Language selection.
 *
 * Only Python is real: the repository has one tracer and it runs Python.
 * Every other language is a <div> marked aria-disabled, with no link, so
 * nothing on this page can be navigated to and nothing implies it works.
 * languages.test.mjs enforces exactly that.
 *
 * The tiles are plain monograms on purpose: the mockups use trademarked
 * logos, and docs/website-build-prompt.md says not to copy them. */

import { Link } from "../router.jsx";
import { PageHeader } from "../shell/AppShell.jsx";
import { LANGUAGES } from "./languages.js";
import { usePageMeta } from "./usePageMeta.js";
import "./pages.css";

export default function GetStarted() {
  usePageMeta(
    "Choose a language - CodeLens",
    "Pick a language to start visualizing. Python runs today; more languages are planned.",
  );

  return (
    <div className="lang-page">
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Choose a language" }]}
        title="Choose a Programming Language"
        subtitle="Select a language to start visualizing your code. More languages coming soon!"
      />

      <div className="lang-grid">
        {LANGUAGES.map((lang) =>
          lang.status === "available" ? (
            <Link key={lang.id} to={lang.href} className="lang-card lang-card-live">
              <span className="lang-mono" aria-hidden="true">
                {lang.monogram}
              </span>
              <span className="lang-name">{lang.name}</span>
              <span className="lang-blurb">{lang.tagline}</span>
              <span className="lang-badge lang-badge-live">Available now</span>
              <span className="lang-cta">
                Start with {lang.name}
                <span aria-hidden="true"> →</span>
              </span>
            </Link>
          ) : (
            <div key={lang.id} className="lang-card" aria-disabled="true">
              <span className="lang-mono" aria-hidden="true">
                {lang.monogram}
              </span>
              <span className="lang-name">{lang.name}</span>
              <span className="lang-blurb">{lang.tagline}</span>
              <span className="lang-badge">Coming soon</span>
            </div>
          ),
        )}
      </div>

      <p className="lang-foot">
        Only one language runs today, and we say so everywhere: the visualizer that exists is
        Python, so Python is the only card you can open.
      </p>
    </div>
  );
}
