// A renderer for one validated visualization scene.
//
// It reads scene items and nothing else: no trace, no heap, no adapter logic.
// The registry has already proved every line, frame, object, slot and statement
// stage exists at the selected step, so this file only decides how to lay that
// proven state out. Click targets either move to a recorded source line/call
// start or select a live call; none of them invent a step.
//
// The scene's primary region is the stage. Variables, stack, memory, output and
// execution context are secondary detail: present, but behind one disclosure so
// the execution concept wins the center of the workspace.

import { useMemo } from "react";
import { highlightMap, slotKey } from "./sceneKeys.js";
import { algorithmLayout } from "./stageLayout.js";

const TONE_CLASS = {
  focus: "scene-tone-focus",
  changed: "scene-tone-changed",
  muted: "scene-tone-muted",
  warning: "scene-tone-warning",
};

const REGION_ORDER = {
  algorithm: 0,
  source: 1,
  variables: 2,
  stack: 3,
  memory: 4,
  output: 5,
  context: 6,
};

const STATUS_LABEL = {
  partial: "Partial view",
  unsupported: "Not available",
};

function objectGroups(items) {
  const groups = [];
  const byId = new Map();
  for (const item of items) {
    if (item.kind === "object") {
      const group = { object: item, slots: [] };
      groups.push(group);
      byId.set(item.objectId, group);
    } else if (item.kind === "slot") {
      const group = byId.get(item.objectId);
      if (group) group.slots.push(item);
    }
  }
  return groups;
}

function outcomeLabel(outcome) {
  if (outcome === "true") return "True";
  if (outcome === "false") return "False";
  if (outcome === "else") return "Else";
  return "";
}

function changeLabel(change) {
  if (change.changeKind === "new" || change.changeKind === "new-slot") return "new";
  if (change.changeKind === "removed" || change.changeKind === "removed-slot") return "removed";
  return "changed";
}

function LineButton({ line, text, indent = 0, onJumpLine, className = "" }) {
  if (line == null) return null;
  return (
    <button
      type="button"
      className={`stage-code-line${className ? ` ${className}` : ""}`}
      onClick={() => onJumpLine?.(line)}
      title={`Go to a step that runs line ${line}`}
    >
      <span className="stage-code-number">{line}</span>
      <code style={{ paddingLeft: `${Math.max(indent, 0)}ch` }}>{text}</code>
    </button>
  );
}

function NextObserved({ line, onJumpLine }) {
  if (line == null) return null;
  return (
    <button
      type="button"
      className="stage-next"
      onClick={() => onJumpLine?.(line)}
      title={`Go to line ${line}`}
    >
      <span className="stage-next-label">Next observed</span>
      <span>line {line}</span>
    </button>
  );
}

function StageValues({ values }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="stage-values" aria-label="Values used by this step">
      {values.map((value) => (
        <span key={value.name} className="stage-value">
          <span className="stage-value-name">{value.name}</span>
          <span className="stage-value-text">{value.text}</span>
        </span>
      ))}
    </div>
  );
}

function LoopRibbon({ loopContext, onJumpLine }) {
  if (!loopContext) return null;
  return (
    <button
      type="button"
      className="loop-ribbon"
      onClick={() => onJumpLine?.(loopContext.line)}
      title={`Go to the loop header on line ${loopContext.line}`}
    >
      <span className="loop-ribbon-mark" aria-hidden="true" />
      <span className="loop-ribbon-statement">{loopContext.statement}</span>
      <span className="loop-ribbon-round">Round {loopContext.iteration}</span>
    </button>
  );
}

function ChangeCards({ changes, onJumpLine }) {
  if (!changes || changes.length === 0) return null;
  return (
    <div className="change-flow">
      {changes.map((change, i) => {
        const kind = changeLabel(change);
        return (
          <div key={`${change.name}-${i}`} className={`change-card change-${kind}`}>
            <span className="change-name">{change.name}</span>
            {kind === "changed" ? (
              <>
                <span className="change-from">{change.from ?? "—"}</span>
                <span className="change-arrow" aria-hidden="true">
                  →
                </span>
                <span className="change-to">{change.to ?? "—"}</span>
              </>
            ) : (
              <span className="change-to">{change.to ?? change.from ?? "—"}</span>
            )}
            <span className="change-kind">{kind}</span>
            {change.line != null ? (
              <button
                type="button"
                className="change-line"
                onClick={() => onJumpLine?.(change.line)}
                title={`Go to line ${change.line}`}
              >
                line {change.line}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function BranchStage({ stage, onJumpLine }) {
  const bodyLines = new Set(
    stage.branches.flatMap((branch) => (branch.body ?? []).map((line) => line.line)),
  );
  const branchLines = new Set(stage.branches.map((branch) => branch.line));
  const nextIsShown =
    stage.nextLine != null && (bodyLines.has(stage.nextLine) || branchLines.has(stage.nextLine));

  return (
    <div className="stage-branch">
      <div className="stage-hero">
        <div className="stage-hero-main">
          <span className="stage-hero-label">
            {stage.outcome ? "Observed result" : "Condition"}
          </span>
          <code className="stage-expression">
            {stage.display ?? stage.expression ?? stage.statement}
          </code>
        </div>
        {stage.outcome ? (
          <span className={`stage-outcome outcome-${stage.outcome}`}>
            {outcomeLabel(stage.outcome)}
          </span>
        ) : null}
      </div>
      <StageValues values={stage.values} />
      <ol className="branch-chain" aria-label="Branch chain at this step">
        {stage.branches.map((branch) => (
          <li key={branch.line} className={`branch-node branch-${branch.state}`}>
            <span className="branch-mark" aria-hidden="true" />
            <div className="branch-content">
              <LineButton
                line={branch.line}
                text={branch.text}
                onJumpLine={onJumpLine}
                className="branch-code"
              />
              <div className="branch-meta">
                {branch.outcome ? (
                  <span className={`branch-outcome outcome-${branch.outcome}`}>
                    {outcomeLabel(branch.outcome)}
                  </span>
                ) : null}
                {branch.state === "next" ? (
                  <span className="branch-note">next observed condition</span>
                ) : null}
                {branch.state === "unreached" ? (
                  <span className="branch-note">not reached</span>
                ) : null}
                {branch.bodyState === "skipped" ? (
                  <span className="branch-note skipped">body skipped</span>
                ) : null}
                {branch.bodyState === "taken" ? (
                  <span className="branch-note taken">body runs</span>
                ) : null}
              </div>
              {branch.body.length > 0 &&
              branch.bodyState !== "next" &&
              branch.bodyState !== "unreached" ? (
                <ul className={`branch-body ${branch.bodyState}`}>
                  {branch.body.map((line) => (
                    <li key={line.line}>
                      <span className="branch-body-number">{line.line}</span>
                      <code>{line.text}</code>
                    </li>
                  ))}
                  {branch.bodyMore > 0 ? (
                    <li className="branch-body-more">
                      {branch.bodyMore} more line{branch.bodyMore === 1 ? "" : "s"}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {!nextIsShown ? <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} /> : null}
    </div>
  );
}

function LoopStage({ stage, onJumpLine }) {
  const exited = stage.outcome === "false";
  return (
    <div className="stage-loop">
      <div className="stage-hero">
        <div className="stage-hero-main">
          <span className="stage-hero-label">
            {stage.loopKind === "for" ? "Loop round" : "Condition check"}
          </span>
          <code className="stage-expression">
            {stage.loopKind === "for" ? stage.statement : stage.display ?? stage.statement}
          </code>
        </div>
        <span className="stage-round">Round {stage.iteration}</span>
      </div>
      <div className="loop-state">
        {stage.loopKind === "for" ? (
          stage.nextValue != null ? (
            <span className="loop-next">
              next <code>{stage.loopTarget} = {stage.nextValue}</code>
            </span>
          ) : (
            <span className="loop-next exited">no more items</span>
          )
        ) : (
          <span className={`stage-outcome outcome-${stage.outcome ?? "none"}`}>
            {exited ? "False" : stage.outcome === "true" ? "True" : "Not recorded"}
          </span>
        )}
        <StageValues values={stage.values} />
      </div>
      <div className="loop-body-wrap">
        <span className="loop-body-label">Loop body</span>
        <ul className="loop-body">
          {stage.body.map((line) => (
            <li key={line.line}>
              <span className="branch-body-number">{line.line}</span>
              <code>{line.text}</code>
            </li>
          ))}
          {stage.bodyMore > 0 ? (
            <li className="branch-body-more">
              {stage.bodyMore} more line{stage.bodyMore === 1 ? "" : "s"}
            </li>
          ) : null}
        </ul>
      </div>
      {exited ? (
        <p className="stage-exit">
          The loop ends here.
        </p>
      ) : null}
      {exited ? <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} /> : null}
    </div>
  );
}

function AssignmentStage({ stage, onJumpLine }) {
  return (
    <div className="stage-assignment">
      <LineButton
        line={stage.line}
        text={stage.statement}
        onJumpLine={onJumpLine}
        className="stage-main-code"
      />
      {stage.changes.length > 0 ? (
        <ChangeCards changes={stage.changes} onJumpLine={onJumpLine} />
      ) : (
        <p className="stage-note">No value changed on this line.</p>
      )}
      <LoopRibbon loopContext={stage.loopContext} onJumpLine={onJumpLine} />
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function PrintStage({ stage, onJumpLine }) {
  return (
    <div className="stage-print">
      {stage.printed != null ? (
        stage.printed === "" ? (
          <p className="stage-note">A blank line was printed.</p>
        ) : (
          <pre className="stage-printed">{stage.printed}</pre>
        )
      ) : (
        <p className="stage-note">No text was recorded on this step.</p>
      )}
      <LineButton
        line={stage.line}
        text={stage.statement}
        onJumpLine={onJumpLine}
        className="stage-sub-code"
      />
      <LoopRibbon loopContext={stage.loopContext} onJumpLine={onJumpLine} />
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function CallStage({ stage, onJumpLine }) {
  return (
    <div className="stage-call">
      <div className="stage-call-title">
        <span className="stage-hero-label">{stage.label}</span>
        <code className="stage-expression">
          {stage.functionName === "<module>" ? "program entry" : `${stage.functionName}()`}
        </code>
      </div>
      {stage.args.length > 0 ? (
        <div className="call-args">
          {stage.args.map((arg) => (
            <span key={arg.name} className="stage-value">
              <span className="stage-value-name">{arg.name}</span>
              <span className="stage-value-text">{arg.text}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="stage-note">No arguments were recorded for this call.</p>
      )}
      <LoopRibbon loopContext={stage.loopContext} onJumpLine={onJumpLine} />
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function ReturnStage({ stage, onJumpLine }) {
  return (
    <div className="stage-return">
      <span className="stage-hero-label">{stage.functionName}</span>
      <div className="stage-return-value">
        {stage.returnValue != null ? (
          <>
            <span className="stage-return-arrow" aria-hidden="true">
              returns
            </span>
            <code>{stage.returnValue}</code>
          </>
        ) : (
          <span className="stage-note">Returns no value.</span>
        )}
      </div>
      <LoopRibbon loopContext={stage.loopContext} onJumpLine={onJumpLine} />
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function CompletionStage({ stage, onJumpLine }) {
  return (
    <div className="stage-complete">
      <span className="stage-hero-label">{stage.label}</span>
      <p className="stage-note">The last line has run. There is no more code to execute.</p>
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function ErrorStage({ stage, onJumpLine }) {
  return (
    <div className="stage-error">
      <span className="stage-hero-label">{stage.label}</span>
      <div className="stage-error-type">{stage.error?.type ?? "Error"}</div>
      {stage.error?.message ? <p className="stage-error-message">{stage.error.message}</p> : null}
      {stage.statement ? (
        <LineButton
          line={stage.line}
          text={stage.statement}
          onJumpLine={onJumpLine}
          className="stage-sub-code"
        />
      ) : null}
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function InputStage({ stage, onJumpLine }) {
  return (
    <div className="stage-input">
      <span className="stage-hero-label">{stage.label}</span>
      {stage.printed != null ? <pre className="stage-printed">{stage.printed}</pre> : null}
      {stage.statement ? (
        <LineButton
          line={stage.line}
          text={stage.statement}
          onJumpLine={onJumpLine}
          className="stage-sub-code"
        />
      ) : null}
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function StepStage({ stage, onJumpLine }) {
  return (
    <div className="stage-step">
      <LineButton
        line={stage.line}
        text={stage.statement}
        onJumpLine={onJumpLine}
        className="stage-main-code"
      />
      {stage.note ? <p className="stage-note">{stage.note}</p> : null}
      <LoopRibbon loopContext={stage.loopContext} onJumpLine={onJumpLine} />
      <NextObserved line={stage.nextLine} onJumpLine={onJumpLine} />
    </div>
  );
}

function StatementStage({ stage, onJumpLine }) {
  if (stage.kind === "branch") return <BranchStage stage={stage} onJumpLine={onJumpLine} />;
  if (stage.kind === "loop") return <LoopStage stage={stage} onJumpLine={onJumpLine} />;
  if (stage.kind === "assignment") return <AssignmentStage stage={stage} onJumpLine={onJumpLine} />;
  if (stage.kind === "print" || stage.kind === "output") {
    return <PrintStage stage={stage} onJumpLine={onJumpLine} />;
  }
  if (stage.kind === "call") return <CallStage stage={stage} onJumpLine={onJumpLine} />;
  if (stage.kind === "return") return <ReturnStage stage={stage} onJumpLine={onJumpLine} />;
  if (stage.kind === "complete") {
    return <CompletionStage stage={stage} onJumpLine={onJumpLine} />;
  }
  if (stage.kind === "input") return <InputStage stage={stage} onJumpLine={onJumpLine} />;
  if (stage.kind === "error") {
    return <ErrorStage stage={stage} onJumpLine={onJumpLine} />;
  }
  return <StepStage stage={stage} onJumpLine={onJumpLine} />;
}

function SlotGrid({ group, highlights, label }) {
  const object = group.object;
  return (
    <div className="scene-object" aria-label={object.label}>
      <div className="scene-object-head">
        <span className="scene-object-name">{object.label}</span>
        <span className="scene-object-type">{object.objectType}</span>
      </div>
      {group.slots.length > 0 ? (
        <ol className="scene-sequence" aria-label={`${label}: ${object.label}`}>
          {group.slots.map((slot) => {
            const tone = highlights.get(slotKey(slot));
            const where = slot.index !== undefined ? `index ${slot.index}` : slot.slotKey;
            return (
              <li
                key={slotKey(slot)}
                className={`scene-cell${tone ? ` ${TONE_CLASS[tone] ?? ""}` : ""}`}
                title={`${where}: ${slot.text} (${slot.valueType ?? "value"})`}
                aria-label={`${where}: ${slot.text}${tone === "focus" ? ", selected" : ""}`}
              >
                <span className="scene-cell-index">{where}</span>
                <span className="scene-cell-value">{slot.text}</span>
                <span className="scene-cell-type">{slot.valueType}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="scene-empty">The recorded sequence is empty.</p>
      )}
    </div>
  );
}

function InvocationTree({ items, onJumpCall, onSelectFrame }) {
  const minDepth = Math.min(...items.map((item) => item.depth ?? 0));
  const ordered = [...items].sort(
    (left, right) => (left.firstIndex ?? 0) - (right.firstIndex ?? 0),
  );
  return (
    <ol className="scene-invocations" aria-label="Recorded recursive invocations">
      {ordered.map((item) => {
        const depth = Math.min(Math.max((item.depth ?? 0) - minDepth, 0), 8);
        const args = (item.args ?? [])
          .map((arg) => `${arg.name} = ${arg.text}`)
          .join(", ");
        const outcome =
          item.outcome === "returned" && item.returnValue != null
            ? `returned ${item.returnValue}`
            : item.outcome === "raised"
              ? `raised ${item.exceptionType ?? "an exception"}`
              : item.outcome ?? "unfinished";
        return (
          <li key={item.frameId} className="scene-invocation-row">
            <button
              type="button"
              className={`scene-invocation${item.current ? " current" : ""}${
                item.active ? " active" : ""
              }`}
              style={{ "--depth": depth }}
              onClick={() => {
                onSelectFrame?.(item.frameId);
                if (item.firstIndex != null) onJumpCall?.(item.frameId, item.firstIndex);
              }}
              title={`Go to where ${item.function} was called on line ${item.callLine ?? "?"}`}
            >
              <span className="scene-invocation-main">
                <span className="scene-invocation-name">{item.function}</span>
                {args ? <span className="scene-invocation-args">({args})</span> : null}
              </span>
              <span className="scene-invocation-meta">
                {item.current ? <span className="scene-tag">here</span> : null}
                {item.baseCase ? <span className="scene-tag">base case</span> : null}
                <span className="scene-invocation-outcome">{outcome}</span>
              </span>
            </button>
            {item.hiddenChildren > 0 ? (
              <span className="scene-hidden">
                {item.hiddenChildren} deeper call{item.hiddenChildren === 1 ? "" : "s"} not shown
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function AlgorithmStage({ regions, highlights, onJumpCall, onSelectFrame }) {
  return (
    <div className={`stage-algorithm stage-algorithm-${algorithmLayout(regions)}`}>
      {regions.map((region) => {
        const invocations = region.items.filter((item) => item.kind === "invocation");
        let content = null;
        if (invocations.length > 0) {
          content = (
            <InvocationTree
              items={invocations}
              onJumpCall={onJumpCall}
              onSelectFrame={onSelectFrame}
            />
          );
        } else {
          const groups = objectGroups(region.items);
          content =
            groups.length > 0 ? (
              <div className="scene-objects">
                {groups.map((group) => (
                  <SlotGrid
                    key={group.object.objectId}
                    group={group}
                    highlights={highlights}
                    label={region.label}
                  />
                ))}
              </div>
            ) : (
              <p className="scene-empty">No recorded state is available for this view yet.</p>
            );
        }
        return (
          <section key={region.id} className="stage-algorithm-block">
            {regions.length > 1 ? <h5>{region.label}</h5> : null}
            {content}
          </section>
        );
      })}
    </div>
  );
}

function VariableRegion({ items }) {
  return (
    <dl className="scene-variables">
      {items.map((item) => (
        <div key={`${item.frameId}-${item.name}`}>
          <dt>
            {item.name}
            {item.isArg ? <span className="scene-tag">arg</span> : null}
          </dt>
          <dd title={item.valueType}>{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function StackRegion({ items, onSelectFrame }) {
  return (
    <ol className="scene-stack" aria-label="Call stack at this step">
      {items.map((item) => (
        <li key={item.frameId}>
          <button
            type="button"
            className={`scene-frame${item.current ? " current" : ""}`}
            onClick={() => onSelectFrame?.(item.frameId)}
            title="Show this call's variables without moving the step"
          >
            <span className="scene-frame-name">{item.function}</span>
            <span className="scene-frame-meta">
              {item.status ?? "active"}
              {item.callLine != null ? ` · called on line ${item.callLine}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function MemoryRegion({ items, highlights }) {
  const groups = objectGroups(items);
  return (
    <div className="scene-memory">
      {groups.map((group) => (
        <SlotGrid
          key={group.object.objectId}
          group={group}
          highlights={highlights}
          label="Memory"
        />
      ))}
    </div>
  );
}

function ContextRegion({ items, onJumpLine }) {
  return (
    <dl className="scene-context">
      {items.map((item, i) => (
        <div key={`${item.name}-${i}`}>
          <dt>{item.name}</dt>
          <dd>
            {item.text}
            {item.line != null ? (
              <button
                type="button"
                className="scene-link"
                onClick={() => onJumpLine?.(item.line)}
              >
                line {item.line}
              </button>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailRegion({ region, highlights, onJumpLine, onSelectFrame }) {
  let body = null;
  if (region.kind === "variables") body = <VariableRegion items={region.items} />;
  else if (region.kind === "stack") body = <StackRegion items={region.items} onSelectFrame={onSelectFrame} />;
  else if (region.kind === "memory") body = <MemoryRegion items={region.items} highlights={highlights} />;
  else if (region.kind === "output") body = <pre className="scene-output">{region.items.map((item) => item.text).join("")}</pre>;
  else if (region.kind === "context") body = <ContextRegion items={region.items} onJumpLine={onJumpLine} />;
  else body = <p className="scene-empty">This region has no renderer.</p>;
  return (
    <section className={`detail-block detail-${region.kind}`}>
      <h6>{region.label}</h6>
      {body}
    </section>
  );
}

/**
 * Draw one scene.
 *
 * @param {Object} props
 * @param {Object} props.scene a scene accepted by `validateScene`
 * @param {(line: number) => void} [props.onJumpLine]
 * @param {(frameId: number, firstIndex: number) => void} [props.onJumpCall]
 * @param {(frameId: number) => void} [props.onSelectFrame]
 */
export default function SceneView({
  scene,
  onJumpLine,
  onJumpCall,
  onSelectFrame,
}) {
  const highlights = useMemo(() => highlightMap(scene?.highlights), [scene?.highlights]);
  const regions = useMemo(
    () =>
      [...(scene?.regions ?? [])].sort(
        (left, right) => (REGION_ORDER[left.kind] ?? 99) - (REGION_ORDER[right.kind] ?? 99),
      ),
    [scene?.regions],
  );
  const algorithms = useMemo(
    () => regions.filter((region) => region.kind === "algorithm"),
    [regions],
  );
  const source = useMemo(
    () => regions.find((region) => region.kind === "source") ?? null,
    [regions],
  );
  const details = useMemo(
    () =>
      regions.filter(
        (region) =>
          region.kind !== "source" &&
          region.kind !== "algorithm" &&
          !(
            region.kind === "output" &&
            (scene?.stage?.kind === "print" || scene?.stage?.kind === "output")
          ),
      ),
    [regions, scene?.stage],
  );

  if (!scene) return <p className="scene-empty">No visualization scene is available.</p>;
  const stage = scene.stage ?? null;
  const title = stage?.label ?? scene.title;
  const detailCount = details.length;

  return (
    <section className="scene-view" aria-label={scene.accessibility?.label ?? scene.title}>
      <header className="stage-head">
        <div className="stage-heading">
          <h4>{title}</h4>
          {!stage && scene.subtitle ? <span className="stage-context">{scene.subtitle}</span> : null}
        </div>
        {scene.status !== "ok" ? (
          <span className={`scene-status scene-status-${scene.status}`}>
            {STATUS_LABEL[scene.status] ?? scene.status}
          </span>
        ) : null}
      </header>

      {scene.status !== "ok" && scene.unsupportedReason ? (
        <p className="scene-note">{scene.unsupportedReason}</p>
      ) : null}

      <div className="stage-surface">
        {stage ? (
          <StatementStage stage={stage} onJumpLine={onJumpLine} />
        ) : algorithms.length > 0 ? (
          <>
            {source?.items?.length ? (
              <LineButton
                line={source.items[0].line}
                text={source.items[0].text}
                indent={source.items[0].indent}
                onJumpLine={onJumpLine}
                className="stage-sub-code"
              />
            ) : null}
            <AlgorithmStage
              regions={algorithms}
              highlights={highlights}
              onJumpCall={onJumpCall}
              onSelectFrame={onSelectFrame}
            />
          </>
        ) : (
          <p className="scene-empty">No recorded state is available for this view yet.</p>
        )}
      </div>

      {!stage && scene.changes?.length > 0 ? (
        <ChangeCards changes={scene.changes} onJumpLine={onJumpLine} />
      ) : null}

      {detailCount > 0 ? (
        <details className="stage-details">
          <summary>
            <span>Step details</span>
            <span className="stage-details-count">
              {detailCount} section{detailCount === 1 ? "" : "s"}
            </span>
          </summary>
          <div className="detail-grid">
            {details.map((region) => (
              <DetailRegion
                key={region.id}
                region={region}
                highlights={highlights}
                onJumpLine={onJumpLine}
                onSelectFrame={onSelectFrame}
              />
            ))}
          </div>
        </details>
      ) : null}

      {scene.evidence?.length > 0 ? (
        <details className="scene-evidence">
          <summary>Why this view</summary>
          <ul>
            {scene.evidence.map((item, i) => (
              <li key={`${item.source}-${item.kind}-${i}`}>
                <span className="scene-evidence-source">{item.source}</span>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
