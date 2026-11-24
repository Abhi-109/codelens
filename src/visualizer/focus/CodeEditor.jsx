import { useEffect, useMemo, useRef } from "react";

import { highlightPython } from "../../editor/highlight.js";

const INDENT = "    ";

function LineTokens({ tokens }) {
  return tokens.map((token, i) => (
    <span key={i} className={`tok-${token.type}`}>
      {token.text}
    </span>
  ));
}

/**
 * The Focus editor.
 *
 * Editing is a plain textarea layered over a highlighted copy of the same
 * source, so the caret, selection, undo and IME all stay the browser's. The
 * highlight layer is `aria-hidden`: a screen reader reads the textarea, never
 * a second copy of the code.
 *
 * While a run is on screen the editor becomes read-only code with the current
 * line lit; clicking a line jumps to a step that ran it. Nothing about this
 * component knows what a trace is.
 */
export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
  line = null,
  errorLine = null,
  justRanLine = null,
  hint = null,
  onJumpLine = null,
  label = "Your Python code",
}) {
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const currentRef = useRef(null);
  const lines = useMemo(() => highlightPython(value), [value]);

  // Keep the lit line on screen while stepping, without scrolling the page.
  useEffect(() => {
    if (readOnly && currentRef.current) {
      currentRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [readOnly, line]);

  useEffect(() => {
    if (readOnly) return;
    const area = textareaRef.current;
    const highlight = highlightRef.current;
    if (area && highlight) {
      highlight.scrollTop = area.scrollTop;
      highlight.scrollLeft = area.scrollLeft;
    }
  }, [readOnly, value]);

  function syncScroll() {
    const area = textareaRef.current;
    const highlight = highlightRef.current;
    if (!area || !highlight) return;
    highlight.scrollTop = area.scrollTop;
    highlight.scrollLeft = area.scrollLeft;
  }

  function setValue(next, caret) {
    onChange?.(next);
    if (caret === null) return;
    requestAnimationFrame(() => {
      const area = textareaRef.current;
      if (!area) return;
      area.selectionStart = caret;
      area.selectionEnd = caret;
    });
  }

  function handleKeyDown(event) {
    if (readOnly || !onChange) return;
    const area = event.currentTarget;
    const start = area.selectionStart;
    const end = area.selectionEnd;

    if (event.key === "Tab") {
      event.preventDefault();
      if (!event.shiftKey) {
        setValue(value.slice(0, start) + INDENT + value.slice(end), start + INDENT.length);
        return;
      }
      // Un-indent the line the caret is on, up to one level.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const leading = /^ */.exec(value.slice(lineStart))[0];
      const remove = Math.min(leading.length, INDENT.length);
      if (remove > 0) {
        setValue(
          value.slice(0, lineStart) + value.slice(lineStart + remove),
          Math.max(lineStart, start - remove),
        );
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const currentLine = value.slice(lineStart, start);
      const indent = /^\s*/.exec(currentLine)[0];
      const opensBlock = /:\s*(?:#.*)?$/.test(currentLine);
      const insert = "\n" + indent + (opensBlock ? INDENT : "");
      setValue(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    }
  }

  if (readOnly) {
    return (
      <div
        className="focus-readonly"
        role="group"
        aria-label="Program source at the current step"
      >
        {lines.map((tokens, i) => {
          const number = i + 1;
          const current = number === line;
          return (
            <button
              key={number}
              type="button"
              className={[
                "focus-code-line",
                current && "is-current",
                number === justRanLine && !current && "just-ran",
                number === errorLine && "is-error",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onJumpLine?.(number)}
              title={current ? "The line about to run" : `Jump to a step that runs line ${number}`}
              ref={current ? currentRef : null}
            >
              <span className="focus-ln" aria-hidden="true">
                {number}
              </span>
              <span className="focus-code-text">
                <LineTokens tokens={tokens} />
                {current && hint ? <span className="focus-hint">→ {hint}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="focus-code-wrap">
      <pre className="focus-highlight" ref={highlightRef} aria-hidden="true">
        {lines.map((tokens, i) => (
          <div className="focus-code-line" key={i}>
            <span className="focus-ln">{i + 1}</span>
            <span className="focus-code-text">
              <LineTokens tokens={tokens} />
            </span>
          </div>
        ))}
      </pre>
      <textarea
        ref={textareaRef}
        className="focus-input"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        spellCheck="false"
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label={label}
        placeholder="# Write Python here, then press Run"
      />
    </div>
  );
}
