/**
 * Compare two recorded steps without moving the playback position.
 *
 * The panel is handed a pure `compareSteps` report. It draws the baseline and
 * comparison endpoints, the variables from each step, the call stack, the
 * objects the trace recorded, output added between them, and any input or error
 * events in the interval. Missing data is labelled "Not comparable" rather than
 * guessed, and an object that is absent from the later snapshot is not called
 * deleted.
 */

const STATUS_LABELS = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
  unavailable: "Not comparable",
  "only-baseline": "Only baseline",
};

const OUTCOME_LABELS = {
  handled: "Handled",
  uncaught: "Uncaught",
  raised: "Raised",
};

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

function endpointText(endpoint) {
  if (!endpoint) return "—";
  const scope = endpoint.scope ?? endpoint.function ?? "unknown scope";
  return `step ${endpoint.index + 1} · line ${endpoint.line ?? "?"} · ${scope}`;
}

function ValueCell({ text, type, status }) {
  if (text == null) {
    return <span className="cmp-missing">{status === "removed" ? "not here" : "—"}</span>;
  }
  return (
    <>
      <span className="cmp-value">{text}</span>
      {type ? <span className="cmp-type">{type}</span> : null}
    </>
  );
}

function FrameList({ frames }) {
  if (!frames?.length) return <span className="cmp-missing">no frames recorded</span>;
  return (
    <div className="cmp-frames">
      {frames.map((frame) => (
        <span key={frame.frameId} className="cmp-frame">
          {frame.function === "<module>" ? "global" : `${frame.function}()`}
          <span className="cmp-frame-depth">{frame.depth}</span>
        </span>
      ))}
    </div>
  );
}

function VariablesComparison({ report }) {
  if (report.variables.length === 0) {
    return <p className="empty">Neither step has a variable to compare.</p>;
  }
  return (
    <table className="cmp-table cmp-variables">
      <thead>
        <tr>
          <th scope="col">Variable</th>
          <th scope="col">Baseline</th>
          <th scope="col">Comparison</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {report.variables.map((row) => (
          <tr key={row.name} data-status={row.status}>
            <th scope="row">
              <code>{row.name}</code>
              {row.referenceChanged ? (
                <span className="cmp-note">reference changed</span>
              ) : null}
            </th>
            <td>
              <ValueCell text={row.textA} type={row.typeA} status={row.status} />
            </td>
            <td>
              <ValueCell text={row.textB} type={row.typeB} status={row.status} />
            </td>
            <td>
              <span className="cmp-status">{statusLabel(row.status)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutputComparison({ report }) {
  const output = report.output;
  if (!output) return null;
  if (output.status === "unchanged") {
    return <p className="cmp-same">Output is the same at both steps.</p>;
  }
  if (output.status === "added") {
    return (
      <>
        <p className="cmp-same">Printed after the baseline step:</p>
        <pre className="cmp-output added">{output.addedText}</pre>
      </>
    );
  }
  if (output.status === "removed") {
    return (
      <>
        <p className="cmp-same">Present at the baseline, but the comparison step is earlier:</p>
        <pre className="cmp-output removed">{output.removedText}</pre>
      </>
    );
  }
  return (
    <div className="cmp-output-pair">
      <div>
        <p className="cmp-same">Baseline output</p>
        <pre className="cmp-output">{output.baselineText}</pre>
      </div>
      <div>
        <p className="cmp-same">Comparison output</p>
        <pre className="cmp-output">{output.comparisonText}</pre>
      </div>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Array} props.trace the whole recorded trace
 * @param {number} props.index the playback step, which this panel never changes
 * @param {{open:boolean, baseline:number, comparison:number}} props.state
 * @param {Object} props.report the result of `compareSteps`
 * @param {(which:string, value:number) => void} props.onChange
 * @param {() => void} props.onClose
 * @param {() => void} props.onSwap
 * @param {(which:string) => void} props.onUseCurrent
 * @param {(index:number) => void} props.onJump
 */
export default function StepComparison({
  trace,
  index,
  state,
  report,
  onChange,
  onClose,
  onSwap,
  onUseCurrent,
  onJump,
}) {
  const last = Math.max(trace.length - 1, 0);
  const atStart = state.baseline <= 0;
  const atEnd = state.comparison >= last;
  const baselineAtEnd = state.baseline >= last;
  const comparisonAtStart = state.comparison <= 0;

  return (
    <section className="cmp" aria-label="Step comparison">
      <div className="cmp-head">
        <div>
          <h4>Compare two steps</h4>
          <p className="panel-hint">
            Playback stays at step {index + 1}; these two endpoints are only what is being
            compared.
          </p>
        </div>
        <div className="cmp-actions">
          <button type="button" className="ghost" onClick={onSwap} disabled={!report.available}>
            Swap
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            ✕ Close comparison
          </button>
        </div>
      </div>

      <div className="cmp-form">
        <div className="cmp-field">
          <label htmlFor="cmp-baseline">Baseline</label>
          <input
            id="cmp-baseline"
            type="number"
            min={1}
            max={Math.max(trace.length, 1)}
            value={state.baseline + 1}
            disabled={!trace.length}
            onChange={(event) => onChange("baseline", Number(event.target.value) - 1)}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => onChange("baseline", state.baseline - 1)}
            disabled={atStart}
            aria-label="Baseline one step earlier"
          >
            −
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onChange("baseline", state.baseline + 1)}
            disabled={baselineAtEnd}
            aria-label="Baseline one step later"
          >
            +
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onUseCurrent("baseline")}
            aria-label="Use the current playback step as the baseline"
          >
            Current
          </button>
        </div>
        <div className="cmp-field">
          <label htmlFor="cmp-comparison">Compare with</label>
          <input
            id="cmp-comparison"
            type="number"
            min={1}
            max={Math.max(trace.length, 1)}
            value={state.comparison + 1}
            disabled={!trace.length}
            onChange={(event) => onChange("comparison", Number(event.target.value) - 1)}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => onChange("comparison", state.comparison - 1)}
            disabled={comparisonAtStart}
            aria-label="Comparison one step earlier"
          >
            −
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onChange("comparison", state.comparison + 1)}
            disabled={atEnd}
            aria-label="Comparison one step later"
          >
            +
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onUseCurrent("comparison")}
            aria-label="Use the current playback step as the comparison"
          >
            Current
          </button>
        </div>
      </div>

      {!report.available ? (
        <p className="cmp-warning" role="status">
          {report.reason}
        </p>
      ) : (
        <div className="cmp-report">
          <p className="cmp-endpoints" aria-live="polite">
            <span>
              <strong>Baseline:</strong> {endpointText(report.baseline)}
            </span>
            <span>
              <strong>Comparison:</strong> {endpointText(report.comparison)}
            </span>
          </p>
          {!report.summary.different ? (
            <p className="cmp-same">No recorded differences between these steps.</p>
          ) : null}

          <section className="cmp-block" aria-labelledby="cmp-vars-title">
            <h5 id="cmp-vars-title">Variables</h5>
            <p className="panel-hint">
              Baseline scope: {report.baseline?.scope ?? "—"} · Comparison scope:{" "}
              {report.comparison?.scope ?? "—"}
            </p>
            <VariablesComparison report={report} />
          </section>

          <section className="cmp-block" aria-labelledby="cmp-stack-title">
            <h5 id="cmp-stack-title">Call stack</h5>
            <p className="cmp-same">
              Depth {report.stack.depthA} → {report.stack.depthB} ·{" "}
              <span data-status={report.stack.status}>{statusLabel(report.stack.status)}</span>
            </p>
            <div className="cmp-stack-pair">
              <div>
                <span className="cmp-label">Baseline</span>
                <FrameList frames={report.stack.framesA} />
              </div>
              <div>
                <span className="cmp-label">Comparison</span>
                <FrameList frames={report.stack.framesB} />
              </div>
            </div>
            {report.stack.entered.length > 0 ? (
              <p className="cmp-delta">
                Entered: {report.stack.entered.map((frame) => `${frame.function}()`).join(", ")}
              </p>
            ) : null}
            {report.stack.left.length > 0 ? (
              <p className="cmp-delta">
                Left: {report.stack.left.map((frame) => `${frame.function}()`).join(", ")}
              </p>
            ) : null}
          </section>

          <section className="cmp-block" aria-labelledby="cmp-output-title">
            <h5 id="cmp-output-title">Output</h5>
            <OutputComparison report={report} />
          </section>

          <details
            className="cmp-block"
            open={report.objects.some((row) => row.status !== "unchanged")}
          >
            <summary>Objects and memory ({report.objects.length})</summary>
            <p className="panel-hint">
              Matched only by the object ids the trace recorded. "Only baseline" means the
              later snapshot does not contain it; it does not claim the object was deleted.
            </p>
            {report.objects.length === 0 ? (
              <p className="empty">Neither step has an object in memory.</p>
            ) : (
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th scope="col">Object</th>
                    <th scope="col">Baseline</th>
                    <th scope="col">Comparison</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.objects.map((row) => (
                    <tr key={row.id} data-status={row.status}>
                      <th scope="row">{row.label}</th>
                      <td>
                        <ValueCell text={row.textA} type={row.typeA} status={row.status} />
                      </td>
                      <td>
                        <ValueCell text={row.textB} type={row.typeB} status={row.status} />
                      </td>
                      <td>
                        <span className="cmp-status">{statusLabel(row.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>

          {report.events.inputs.length > 0 || report.events.exceptions.length > 0 ? (
            <section className="cmp-block" aria-labelledby="cmp-events-title">
              <h5 id="cmp-events-title">Events between the steps</h5>
              {report.events.inputs.length > 0 ? (
                <ul className="cmp-events">
                  {report.events.inputs.map((entry) => (
                    <li key={`input-${entry.index}`}>
                      <button type="button" className="ghost" onClick={() => onJump(entry.index)}>
                        Step {entry.index + 1}
                      </button>
                      <span>input</span> <code>{entry.value}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
              {report.events.exceptions.length > 0 ? (
                <ul className="cmp-events">
                  {report.events.exceptions.map((entry) => (
                    <li key={`error-${entry.index}`}>
                      <button type="button" className="ghost" onClick={() => onJump(entry.index)}>
                        Step {entry.index + 1}
                      </button>
                      <strong>{entry.type}</strong>
                      <span>{entry.message}</span>
                      <span className="cmp-outcome" data-outcome={entry.outcome}>
                        {OUTCOME_LABELS[entry.outcome] ?? entry.outcome}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
