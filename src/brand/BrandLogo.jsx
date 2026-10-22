import { WORDMARK_PATH } from "./wordmarkPath.js";
import "./brand.css";

/* The mark: a code-block C with a focus dot in the lens. The opening on the
   right is the trace leaving the frame; the dot is the step in focus. */
const MARK_PATH =
  "M37.5 31.2V32.5A5.5 5.5 0 0 1 32 38H16A5.5 5.5 0 0 1 10.5 32.5V15.5" +
  "A5.5 5.5 0 0 1 16 10H32A5.5 5.5 0 0 1 37.5 15.5V16.8";

function MarkShapes() {
  return (
    <>
      <path
        d={MARK_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="6.4"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="3.9" fill="currentColor" />
    </>
  );
}

/** The standalone symbol. Decorative unless a label is passed. */
export function BrandMark({ className = "", label, decorative = false }) {
  const labelled = !decorative;

  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      viewBox="0 0 48 48"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? label || "CodeLens" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <MarkShapes />
    </svg>
  );
}

/** The horizontal lockup. The symbol keeps its accent; the wordmark follows
 *  --logo-word so the same component works in both themes. */
export function BrandLogo({ className = "", decorative = false }) {
  const labelled = !decorative;

  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      viewBox="0 0 192 48"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? "CodeLens" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <path
        className="brand-logo-word"
        transform="translate(56 32) scale(0.22)"
        d={WORDMARK_PATH}
      />
      <g className="brand-logo-mark">
        <MarkShapes />
      </g>
    </svg>
  );
}
