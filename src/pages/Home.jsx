/* Home: the landing page.
 *
 * The preview is not a screenshot and not a fake trace. preview-fixture
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
import { useReducedMotion } from "../visualizer/motion/useReducedMotion.js";
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
import "./home.css";

const SOURCE_LINES = fixture.source.replace(/\n$/, "").split("\n");
const FRAMES = buildPreviewFrames(fixture.source, fixture.trace);
const TOTAL = FRAMES.length;
const STEP_MS = 1200;
const FIRST_FRAME = FRAMES[0] ?? {
  index: 0,
  line: 0,
  code: "",
  changes: [],
  values: {},
  callStack: [],
  output: "",
};

/* --- Feature icons (hand-drawn: no icon dependency added) ----------------- */

const ICONS = {
  execution: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9.4 14.4 12 10 14.6Z" fill="currentColor" />
    </svg>
  ),
  variables: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
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
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
      <path d="m12 3.5 8 4-8 4-8-4 8-4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m4 12 8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m4 16.5 8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  languages: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
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

/* Tiny feature illustrations, drawn from divs rather than shipped images. */
const FEATURE_ART = {
  execution: (
    <div className="art-exec" aria-hidden="true">
      <span className="art-exec-line" />
      <span className="art-exec-line art-exec-live" />
      <span className="art-exec-line" />
      <span className="art-exec-caret" />
    </div>
  ),
  variables: (
    <div className="art-values" aria-hidden="true">
      <span className="art-val">n = 12</span>
      <span className="art-val is-live">total = 48</span>
      <span className="art-val">items[2]</span>
    </div>
  ),
  calls: (
    <div className="art-calls" aria-hidden="true">
      <span className="art-call">main()</span>
      <span className="art-call">solve()</span>
      <span className="art-call is-live">visit()</span>
    </div>
  ),
  languages: (
    <div className="art-langs" aria-hidden="true">
      <span className="art-lang is-live">Py</span>
      <span className="art-lang">JS</span>
      <span className="art-lang">Go</span>
      <span className="art-lang">Rs</span>
    </div>
  ),
};

/* --- The live preview ----------------------------------------------------- */

function HeroPreview({ onFrame }) {
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
  const frame = FRAMES[index] ?? FIRST_FRAME;
  // The trace's own record of what this step changed: a value lights up only
  // when the recording says it moved.
  const changed = new Map((frame.changes ?? []).map((change) => [change.name, change]));

  // The floating cards around the stage describe this exact frame, so they
  // cannot drift from what the preview is showing.
  useEffect(() => {
    onFrame?.(frame);
  }, [frame, onFrame]);

  return (
    <figure className="home-preview" ref={hostRef}>
      <div className="preview-frame">
        <div className="preview-bar">
          <span className="preview-lang">
            <span className="preview-dot" aria-hidden="true" />
            Python
          </span>
          <span className="preview-file">example.py</span>

          <div className="preview-player">
            <button
              type="button"
              className="pv-play"
              onClick={() => setWantPlay((play) => !play)}
              aria-label={wantPlay ? "Pause the preview" : "Play the preview"}
              title={wantPlay ? "Pause" : "Play"}
            >
              {wantPlay ? (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
                  <rect x="4" y="3" width="3" height="10" rx="1" />
                  <rect x="9" y="3" width="3" height="10" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
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
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
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
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
                <path d="M12 3.4 4.8 8 12 12.6Z" />
                <rect x="2.9" y="3.4" width="1.6" height="9.2" rx="0.8" />
              </svg>
            </button>
            <span className="pv-step" aria-live="off">
              {index + 1} / {TOTAL}
            </span>
          </div>
        </div>

        <div className="preview-body">
          <ol className="preview-code" aria-label="Program with the current line marked">
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

          <div className="preview-facts">
            <section className="pv-fact">
              <h3 className="pv-card-title">Values</h3>
              {Object.keys(frame.values).length === 0 ? (
                <p className="pv-empty">Nothing assigned yet</p>
              ) : (
                <ul className="pv-list">
                  {Object.entries(frame.values).map(([name, value]) => {
                    const move = changed.get(name);
                    return (
                      <li key={name} className={move ? "pv-row is-changed" : "pv-row"}>
                        <span className="pv-name">{name}</span>
                        <span className="pv-eq" aria-hidden="true">
                          =
                        </span>
                        <span
                          className="pv-value"
                          title={move ? `was ${move.from ?? "unset"}` : undefined}
                        >
                          {value}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="pv-fact">
              <h3 className="pv-card-title">Call stack</h3>
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

            <section className="pv-fact">
              <h3 className="pv-card-title">Output</h3>
              {frame.output ? (
                <pre className="pv-output">{frame.output}</pre>
              ) : (
                <p className="pv-empty">Nothing printed yet</p>
              )}
            </section>
          </div>
        </div>
      </div>

      <figcaption className="preview-note">
        A real run of a built-in example, replayed step by step. Every value comes from the
        execution engine's own trace. Hover the stage to look around.
      </figcaption>
    </figure>
  );
}

/* --- The 3D stage --------------------------------------------------------- */

function TiltStage({ children }) {
  const reduced = useReducedMotion();
  const ref = useRef(null);

  function move(event) {
    const host = ref.current;
    if (!host || reduced || event.pointerType === "touch") return;
    const rect = host.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    host.style.setProperty("--rx", `${(1.5 - y * 4).toFixed(2)}deg`);
    host.style.setProperty("--ry", `${(x * 6).toFixed(2)}deg`);
    host.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
    host.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
  }

  function leave() {
    const host = ref.current;
    if (!host) return;
    host.style.setProperty("--rx", "2.5deg");
    host.style.setProperty("--ry", "-4.5deg");
    host.style.setProperty("--mx", "50%");
    host.style.setProperty("--my", "40%");
  }

  return (
    <div
      className="land-tilt"
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ "--rx": "2.5deg", "--ry": "-4.5deg", "--mx": "50%", "--my": "40%" }}
    >
      {children}
    </div>
  );
}

function StageChips({ frame }) {
  const change = (frame.changes ?? [])[0];
  const top = frame.callStack?.find((entry) => entry.isTop);
  return (
    <>
      <div className="land-chip land-chip-step" aria-hidden="true">
        <span className="land-chip-label">Trace event</span>
        <span className="land-chip-number">
          {String((frame.index ?? 0) + 1).padStart(2, "0")}
          <span className="land-chip-of">/ {fixture.trace.length}</span>
        </span>
        <span className="land-chip-meta">line {frame.line || "—"}</span>
      </div>

      <div className="land-chip land-chip-value" aria-hidden="true">
        <span className="land-chip-label">{change ? "Changed this step" : "Values"}</span>
        {change ? (
          <code className="land-chip-code">
            {change.name} = {frame.values[change.name] ?? "…"}
          </code>
        ) : (
          <code className="land-chip-code">ready to run</code>
        )}
        <span className="land-chip-meta">
          {top ? `${top.function === "<module>" ? "module" : `${top.function}()`}` : "no calls"} · {Object.keys(frame.values).length} values
        </span>
      </div>
    </>
  );
}

/* --- The guided trace explorer -------------------------------------------- */

const MOMENTS = [
  {
    id: "run",
    label: "Run",
    title: "A real interpreter, not a simulation",
    body: "Python runs in a Web Worker in your browser. The trace records what actually happened: the line, the values, the calls and the output.",
    at: 0,
  },
  {
    id: "step",
    label: "Inspect",
    title: "Every frame is evidence",
    body: "Move to any recorded step. The line, the variables and the call stack are read from that step - never reconstructed from a guess.",
    at: 0.5,
  },
  {
    id: "explain",
    label: "Understand",
    title: "Plain English, tied to the code",
    body: "Each step gets a short explanation in the same vocabulary as the canvas, so the picture and the words agree.",
    at: 1,
  },
];

function momentFrame(at) {
  if (TOTAL === 0) return FIRST_FRAME;
  const index = Math.max(0, Math.min(TOTAL - 1, Math.round(at * (TOTAL - 1))));
  return FRAMES[index] ?? FIRST_FRAME;
}

function TraceExplorer() {
  const [active, setActive] = useState(0);
  const moment = MOMENTS[active];
  const frame = momentFrame(moment.at);

  return (
    <div className="land-explorer">
      <div className="land-steps" role="group" aria-label="How CodeLens works">
        {MOMENTS.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            className="land-step"
            aria-pressed={active === i}
            onClick={() => setActive(i)}
          >
            <span className="land-step-no" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="land-step-copy">
              <span className="land-step-label">{entry.label}</span>
              <span className="land-step-title">{entry.title}</span>
            </span>
            <span className="land-step-arrow" aria-hidden="true">
              →
            </span>
          </button>
        ))}
      </div>

      <div className="land-moment" aria-live="polite">
        <div className="land-moment-bar">
          <span className="land-moment-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="land-moment-file">example.py</span>
          <span className="land-moment-step">step {frame.index + 1}</span>
        </div>
        <pre className="land-moment-code">
          <span className="land-moment-ln" aria-hidden="true">
            {frame.line}
          </span>
          <code>{frame.code?.text || "…"}</code>
        </pre>
        <div className="land-moment-facts">
          {Object.entries(frame.values)
            .slice(0, 3)
            .map(([name, value]) => (
              <span key={name} className="land-moment-fact">
                <span>{name}</span> = <strong>{value}</strong>
              </span>
            ))}
          {Object.keys(frame.values).length === 0 && (
            <span className="land-moment-fact is-quiet">No values yet</span>
          )}
        </div>
        <p className="land-moment-body">{moment.body}</p>
      </div>
    </div>
  );
}

/* --- Page ----------------------------------------------------------------- */

export default function Home() {
  usePageMeta(
    "CodeLens — See your code think.",
    "CodeLens is a code visualization and programming education platform. See your code think: watch a program run one step at a time — the line about to run, every variable, the call stack and the output, explained in plain English. Python is the first supported language.",
  );

  const [frame, setFrame] = useState(FIRST_FRAME);

  return (
    <div className="page-home land">
      <section className="land-hero">
        <div className="land-copy">
          <span className="land-badge">
            <span className="land-badge-dot" aria-hidden="true" />
            Real traces, drawn live
          </span>
          <h1 className="land-title">
            <span className="land-title-line">Watch your code</span>{" "}
            <span className="land-title-accent">come alive.</span>
          </h1>
          <p className="land-lede">
            CodeLens turns a real Python run into a picture you can step through:
            the line about to execute, every value it touches, the calls still open,
            and the words that explain why.
          </p>
          <div className="land-actions">
            <Link to="/get-started" className="btn btn-primary land-cta-btn">
              Start visualizing
              <span className="land-arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <a href="#how" className="btn land-ghost-btn">
              See how it works
            </a>
          </div>
          <ul className="land-trust">
            <li>Runs locally</li>
            <li>No account</li>
            <li>Python today</li>
          </ul>
        </div>

        <div className="land-stage-wrap">
          <TiltStage>
            <div className="land-stage">
              <div className="land-halo" aria-hidden="true" />
              <div className="land-grid" aria-hidden="true" />
              <div className="land-orbit land-orbit-a" aria-hidden="true" />
              <div className="land-orbit land-orbit-b" aria-hidden="true" />
              <div className="land-window">
                <HeroPreview onFrame={setFrame} />
              </div>
              <StageChips frame={frame} />
            </div>
          </TiltStage>
        </div>
      </section>

      <section className="land-section" id="features" aria-label="Features" tabIndex={-1}>
        <header className="land-section-head">
          <span className="land-eyebrow">The whole picture</span>
          <h2 className="land-h2">
            Not just variables.
            <span> The whole story.</span>
          </h2>
          <p className="land-section-lede">
            Four views of the same recorded step, so the line, the data and the call
            stack never tell different stories.
          </p>
        </header>

        <div className="land-bento">
          {FEATURES.map((feature, i) => (
            <article
              key={feature.id}
              className="land-card"
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.style.setProperty("--sx", `${event.clientX - rect.left}px`);
                event.currentTarget.style.setProperty("--sy", `${event.clientY - rect.top}px`);
              }}
            >
              <div className="land-card-top">
                <span className="land-card-icon" aria-hidden="true">
                  {ICONS[feature.id]}
                </span>
                <span className="land-card-no" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="land-card-art" aria-hidden="true">
                {FEATURE_ART[feature.id]}
              </div>
              <h3 className="land-card-title">
                {feature.title}
                {feature.soon && <span className="land-soon">soon</span>}
              </h3>
              <p className="land-card-body">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="land-how" id="how">
        <div className="land-how-copy">
          <span className="land-eyebrow">From code to clarity</span>
          <h2 className="land-h2">
            Three moves.
            <span> No magic.</span>
          </h2>
          <p className="land-section-lede">
            There is no hidden model of your program. Each panel reads the same
            recorded step, and the step comes from an actual execution.
          </p>
          <div className="land-how-mark" aria-hidden="true">
            <BrandMark decorative />
            <span>trace → frame → explanation</span>
          </div>
        </div>
        <TraceExplorer />
      </section>

      <section className="land-cta">
        <div className="land-cta-glow" aria-hidden="true" />
        <div className="land-cta-inner">
          <span className="land-eyebrow">Ready when you are</span>
          <h2 className="land-cta-title">
            Your next “aha”{" "}
            <span>is one run away.</span>
          </h2>
          <p className="land-cta-body">
            Paste a program, press Run, and watch the step you were stuck on become
            obvious. Free, in your browser, nothing to install.
          </p>
          <div className="land-actions land-actions-center">
            <Link to="/get-started" className="btn btn-primary land-cta-btn">
              Open the visualizer
              <span className="land-arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <Link to="/learn" className="btn land-ghost-btn">
              Browse lessons
            </Link>
          </div>
          <p className="land-cta-foot">Python today · more languages on the roadmap</p>
        </div>
      </section>
    </div>
  );
}
