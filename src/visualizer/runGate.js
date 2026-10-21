// Guards asynchronous run work against a source or run that has moved on.
//
// A run is identified by both the run counter and the exact source it started
// with. The counter rejects a newer run; the source check rejects an edit made
// while an older run was still in flight. Keeping both checks here makes the
// rule testable without mounting the workspace.

export function createRunGate() {
  let current = 0;
  return {
    begin(source) {
      current += 1;
      return { id: current, source };
    },
    /** True when no newer run has started since this one. */
    isLatest(run) {
      return Boolean(run) && run.id === current;
    },
    /** True when this run is latest and still describes the current source. */
    isCurrent(run, currentSource) {
      return this.isLatest(run) && run.source === currentSource;
    },
  };
}
