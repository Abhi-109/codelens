/* Home: the landing page.
 *
 * The preview card is not a screenshot and not a fake trace. preview-fixture
 * .json is a recording of a real run of a built-in example (regenerate it
 * with `npm run fixtures:preview`), and preview.js turns that recording into
 * frames with getStepView - the very function the visualizer's panels read.
 * preview.test.mjs proves every frame against the corpus recording, so what
 * the hero shows is exactly what the engine produced.
 *
 * Pyodide is deliberately not loaded here: the quality bar says to lazy-load
 * the engine only on the visualizer pages, so the hero never blocks first
 * paint. The loop pauses when the tab is hidden, when the card scrolls out
 * of view, and for anyone whose system asks for reduced motion - the player
 * buttons still work then. */

import { useEffect, useRef, useState } from "react";

import { BrandMark } from "../brand/BrandLogo.jsx";
import { Link } from "../router.jsx";
import { FEATURES } from "./languages.js";
import {
  buildPreviewFrames,
  markedLine,
  nextFrameIndex,
  previousFrameIndex,
} from "./preview.js";
import fixture from "./preview-fixture.json";
import { usePageMeta } from "./usePageMeta.js";
import "./pages.css";

const SOURCE_LINES = fixture.source.replace(/\n$/, "").split("\n");
const FRAMES = buildPreviewFrames(fixture.source, fixture.trace);
const TOTAL = FRAMES.length;
const STEP_MS = 1200;

/* --- Feature icons (hand-drawn: no icon dependency added) ----------------- */

const ICONS = {
  execution: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9.4 14.4 12 10 14.6Z" fill="currentColor" />
    </svg>
  ),
  variables: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none">
      <path
        d="M9.5 4.5H8.5a2 2 0 0 0-2 2v3L4.5 12l2 2.5v3a2 2 0 0 0 2 2h1M14.5 4.5h1a2 2 0 0 1 2 2v3l2 2.5-2 2.5v3a2 2 0 0 1-2 2h-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  ),
  calls: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none">
      <path d="m12 3.5 8 4-8 4-8-4 8-4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m4 12 8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m4 16.5 8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  languages: (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.5c2.3 2.3 3.4 5.2 3.4 8.5s-1.1 6.2-3.4 8.5c-2.3-2.3-3.4-5.2-3.4-8.5S9.7 5.8 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  ),
};

/* --- The live preview ----------------------------------------------------- */

function HeroPreview() {
  const hostRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  // Ask the system once whether it wants reduced motion; if it does, wait for
  // the reader to press play instead of moving on our own.
  const [wantPlay, setWantPlay] = useState(
    () => !(typeof window === "object" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  );

  // Only run while the preview is on screen.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver !== "function") {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.2,
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Pause the loop whenever the tab is hidden.
  useEffect(() => {
    const sync = () => setTabVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const running = wantPlay && inView && tabVisible && TOTAL > 1;

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(
      () => setIndex((current) => nextFrameIndex(current, TOTAL)),
      STEP_MS,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  // An index can only ever point at a real frame.
  const frame = FRAMES[index] ?? FRAMES[0];

  return (
    <figure className="home-preview" ref={hostRef}>
      <div className="preview-main">
        <div className="preview-head">
          <span className="preview-lang">
            <span className="preview-dot" aria-hidden="true" />
            Python
          </span>
          <span className="preview-file">example.py</span>
        </div>

        <ol className="preview-code">
          {SOURCE_LINES.map((text, i) => {
            const number = i + 1;
            const current = frame.line === number;
            const segments = current ? markedLine(text, frame.values) : [{ text, name: null }];
            return (
              <li
                key={number}
                className={current ? "pv-line pv-current" : "pv-line"}
                aria-current={current ? "step" : undefined}
              >
                <span className="pv-num" aria-hidden="true">
                  {number}
                </span>
                <code className="pv-text">
                  {segments.length === 0
                    ? "\u00A0"
                    : segments.map((segment, s) => (
                        <span
                          key={s}
                          className={segment.name ? "pv-ident" : undefined}
                          title={segment.name ? `${segment.name} = ${frame.values[segment.name]}` : undefined}
                        >
                          {segment.text}
                        </span>
                      ))}
                </code>
              </li>
            );
          })}
        </ol>

        <div className="preview-player">
          <button
            type="button"
            className="pv-play"
            onClick={() => setWantPlay((play) => !play)}
            aria-label={wantPlay ? "Pause the preview" : "Play the preview"}
            title={wantPlay ? "Pause" : "Play"}
          >
            {wantPlay ? (
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
                <rect x="4" y="3" width="3" height="10" rx="1" />
                <rect x="9" y="3" width="3" height="10" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
                <path d="M5 3.4 12.2 8 5 12.6Z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="pv-btn"
            onClick={() => setIndex((current) => previousFrameIndex(current, TOTAL))}
            aria-label="Previous step"
            title="Previous step"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
              <path d="M4 3.4 11.2 8 4 12.6Z" />
              <rect x="11.5" y="3.4" width="1.6" height="9.2" rx="0.8" />
            </svg>
          </button>
          <button
            type="button"
            className="pv-btn"
            onClick={() => setIndex((current) => nextFrameIndex(current, TOTAL))}
            aria-label="Next step"
            title="Next step"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
              <path d="M12 3.4 4.8 8 12 12.6Z" />
              <rect x="2.9" y="3.4" width="1.6" height="9.2" rx="0.8" />
            </svg>
          </button>
          <span className="pv-step">
            Step {index + 1} / {TOTAL}
          </span>
        </div>
      </div>

      <div className="preview-cards">
        <section className="pv-card">
          <h3 className="pv-card-title">Variables</h3>
          {Object.keys(frame.values).length === 0 ? (
            <p className="pv-empty">(none yet)</p>
          ) : (
            <ul className="pv-list">
              {Object.entries(frame.values).map(([name, value]) => (
                <li key={name} className="pv-row">
                  <span className="pv-name">{name}</span>
                  <span className="pv-eq" aria-hidden="true">
                    =
                  </span>
                  <span className="pv-value">{value}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pv-card">
          <h3 className="pv-card-title">Call Stack</h3>
          <ul className="pv-list">
            {frame.callStack.map((entry) => (
              <li
                key={entry.frameId}
                className={entry.isTop ? "pv-frame pv-frame-top" : "pv-frame"}
                aria-current={entry.isTop ? "true" : undefined}
              >
                {entry.function === "<module>" ? "<module>" : `${entry.function}()`}
                {entry.callNumber > 1 && <span className="pv-callno"> #{entry.callNumber}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="pv-card">
          <h3 className="pv-card-title">Output</h3>
          {frame.output ? (
            <pre className="pv-output">{frame.output}</pre>
          ) : (
            <p className="pv-empty">(nothing printed yet)</p>
          )}
        </section>
      </div>

      <figcaption className="preview-note">
        A real run of a built-in example, replayed step by step — every value comes from the
        execution engine's own trace.
      </figcaption>
    </figure>
  );
}

/* --- Page ----------------------------------------------------------------- */

export default function Home() {
  usePageMeta(
    "CodeLens — See your code think.",
    "CodeLens is a code visualization and programming education platform. See your code think: watch a program run one step at a time — the line about to run, every variable, the call stack and the output, explained in plain English. Python is the first supported language.",
  );

  return (
    <div className="page-home">
      <div className="home-bg" aria-hidden="true">
        <svg className="home-waves" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0 190C240 110 480 270 720 190S1200 110 1440 190" />
          <path d="M0 240C240 160 480 320 720 240S1200 160 1440 240" />
          <path d="M0 140C240 60 480 220 720 140S1200 60 1440 140" />
        </svg>
      </div>

      <section className="home-hero">
        <div className="home-copy">
          <span className="home-eyebrow home-eyebrow-brand">
            <BrandMark className="home-eyebrow-mark" decorative />
            See your code think.
          </span>
          <h1 className="home-title">
            See your code
            <br />
            <span className="home-title-accent">come to life.</span>
          </h1>
          <p className="home-lede">
            CodeLens shows you how a program executes, one step at a time: which line runs next,
            what every variable holds, which calls are open, and what got printed — with a
            plain-English explanation at every step.
          </p>
          <div className="home-actions">
            <Link to="/get-started" className="btn btn-primary">
              Start Visualizing
              <span aria-hidden="true">→</span>
            </Link>
            <a href="#features" className="btn">
              Explore Features
            </a>
          </div>
        </div>

        <HeroPreview />
      </section>

      <section className="home-features" id="features" aria-label="Features" tabIndex={-1}>
        {FEATURES.map((feature) => (
          <div key={feature.id} className="home-feature">
            <span className="home-feature-icon" aria-hidden="true">
              {ICONS[feature.id]}
            </span>
            <p className="home-feature-title">
              {feature.title}
              {feature.soon && <span className="home-feature-soon"> (soon)</span>}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
