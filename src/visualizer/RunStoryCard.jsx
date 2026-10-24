// The run map: what the whole program does, above the canvas.
//
// A learner stepping a loop sees the same handful of lines move past and has to
// infer the rule from them. This card says the rule first — how many rounds,
// with what values, what grew — and each part is a button to the step where it
// happens. It never computes anything: every sentence and number comes from
// `buildRunStory`, which reads only the trace.
//
// The part the current step is inside is marked and tinted, so the map also
// answers "where am I" while stepping.

import { sectionAt } from "../tracer/runStory.js";

const KIND_LABELS = {
  start: "Setup",
  repeat: "Repeat",
  call: "Call",
  finish: "After",
  run: "Run",
  error: "Error",
  limit: "Limit",
};

function RoundControls({ section, index, onJump }) {
  const jumps = section.roundJumps ?? [];
  if (jumps.length < 2) return null;
  // How many rounds have started by this step. 1-based for the label; the
  // buttons use the same number as an index into `jumps`.
  const started = jumps.filter((step) => step <= index).length;
  if (started === 0) return null;
  return (
    <div className="run-story-rounds">
      <span className="run-story-round-label">
        Round {started} of {jumps.length}
      </span>
      <button
        type="button"
        className="run-story-round"
        disabled={started < 2}
        onClick={() => onJump?.(jumps[started - 2])}
      >
        ◀ Previous round
      </button>
      <button
        type="button"
        className="run-story-round"
        disabled={started >= jumps.length}
        onClick={() => onJump?.(jumps[started])}
      >
        Next round ▶
      </button>
    </div>
  );
}

function Part({ section, order, current, index, onJump }) {
  const active = current?.id === section.id;
  return (
    <li className={`run-story-part${active ? " on" : ""}`}>
      <button
        type="button"
        className="run-story-button"
        aria-current={active ? "step" : undefined}
        onClick={() => onJump?.(section.jump)}
        title={`Go to step ${section.jump + 1}`}
      >
        <span className="run-story-index" aria-hidden="true">
          {order}
        </span>
        <span className="run-story-body">
          <span className="run-story-meta">
            <span className="run-story-label">{section.label}</span>
            <span className="run-story-kind">{KIND_LABELS[section.kind] ?? section.kind}</span>
            {active ? <span className="run-story-here">You are here</span> : null}
          </span>
          <span className="run-story-title">{section.title}</span>
          <span className="run-story-text">{section.text}</span>
          {section.values ? (
            <span className="run-story-chips">
              <span className="run-story-chip">
                <b>{section.values.name}</b> {section.values.text}
              </span>
            </span>
          ) : null}
          {section.chain ? (
            <span className="run-story-chips">
              <span className="run-story-chip run-story-chain">
                <b>{section.chain.name}</b> {section.chain.text}
              </span>
            </span>
          ) : null}
          {section.outputSummary ? (
            <span className="run-story-output">
              prints <code>{section.outputSummary}</code>
            </span>
          ) : null}
        </span>
      </button>
      {active ? <RoundControls section={section} index={index} onJump={onJump} /> : null}
    </li>
  );
}

/**
 * @param {Object} props
 * @param {Object|null} props.story a buildRunStory result
 * @param {number} props.index the current trace step
 * @param {(index: number) => void} [props.onJump]
 * @param {boolean} [props.compact] start folded, when something else owns the room
 */
export default function RunStoryCard({ story, index, onJump, compact = false }) {
  const sections = story?.sections ?? [];
  if (sections.length === 0) return null;
  const current = sectionAt(story, index);
  const position = current ? sections.indexOf(current) + 1 : 0;

  // Folded only while the stage is what you came to watch. `open` is left
  // uncontrolled so a reader can still open it, and it stays open until the
  // canvas changes - switching to a different canvas re-applies the default.
  return (
    <details className="run-story" open={compact ? undefined : true}>
      <summary className="run-story-head">
        <span className="run-story-heading">What this run does</span>
        <span className="run-story-count">
          {position > 0 ? `part ${position} of ${sections.length}` : `${sections.length} parts`}
          <span className="run-story-sep" aria-hidden="true">
            ·
          </span>
          {story.steps} steps
        </span>
      </summary>
      <ol className="run-story-list">
        {sections.map((section, order) => (
          <Part
            key={section.id}
            section={section}
            order={order + 1}
            current={current}
            index={index}
            onJump={onJump}
          />
        ))}
      </ol>
    </details>
  );
}
