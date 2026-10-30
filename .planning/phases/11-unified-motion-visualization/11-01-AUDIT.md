# Phase 11 — Unified Motion Visualization: Architecture Audit (read-only)

## 1. Components that render each mode

- `src/visualizer/vizMode.js` — `VIZ_MODES = ["motion","scene","tree","flow","combined","timeline"]`, labels, blurbs, `isVizMode`, `normalizeViz`, `selectViz`, `stepViz`, `loadViz`/`saveViz`.
- `src/visualizer/VisualizationPane.jsx` — tab strip (`multi = VIZ_MODES.length > 1`), renders the active child canvas; already hides tabs when only one mode.
- `src/App.jsx` — calls `planVisualization` → `primary` canvas id; `selectViz(state, nextPlan.primary)`; renders the chosen canvas.
- `src/planner/planner.js` — `choose("scene"|"tree"|"flow"|"combined"|"motion", reason)`; `canRender(primary, evidence)` gates each.
- `src/planner/renderers.js` — renderer registry; `isVizMode` validates renderer ids, so renderer set == VIZ_MODES.

## 2. Reusable components

- `src/visualizer/motion/MotionStage.jsx` + choreography.js/plan.js/view.js — the Motion canvas.
- `src/flowchart/*` (ControlFlowChart, callTree, layout) — control-flow + call-tree renderers.
- `src/visualizer/adaptive.js` + `AdaptiveView.jsx` — Adaptive canvas.
- `src/visualizer/*` timeline rendering.
- `src/datastructures/*` — Data Structures Lab (separate, must remain untouched).
- Animation action engine (`src/animation/*`), evaluator, line-shape parser.

## 3. Components requiring integration

- MotionStage must absorb call-tree, control-flow, combined, timeline outputs.
- Planner's `primary` selection must map to Motion sub-behaviours, not separate canvases.
- VisualizationPane tab strip must disappear (single mode).

## 4. Components retireable after integration

- Adaptive/CallTree/ControlFlow/Combined/Timeline as standalone tabs (UI only).
- Keep their rendering modules as internal capabilities.

## 5. Dependencies between modes

- renderers.js ties renderer ids to VIZ_MODES (isVizMode). Changing VIZ_MODES breaks renderer validation and planner.
- App.jsx selects viz from plan.primary; if primary becomes invalid, falls back to current (motion).
- quality.test.mjs expects scene/tree/flow/combined/motion canvases.

## 6. Animation limitations

- MotionStage handles scalars/collections/calls/recursion; control-flow and timeline are separate.
- "no data change" empty state exists (needs honest representation).

## 7. Potential regressions

- Quality test (122 cases) expects specific canvases.
- Browser check asserts tabs (Adaptive/Call tree).
- Planner canRender gates.
- Session/selectors tests.

## 8. Minimum safe sequence

1. Keep VIZ_MODES full for planner/renderers (do not break quality tests).
2. Hide tab strip in VisualizationPane (multi=false) — UI-only single canvas.
3. Integrate non-Motion renderers into MotionStage as sub-views driven by plan.primary.
4. Remove browser-check tab assertions.
5. Update tests.

## Recommendation

Do NOT reduce VIZ_MODES to ["motion"] alone — that breaks planner/renderers/quality tests. Instead hide the tab strip and let Motion orchestrate the selected canvas internally. This is the smallest safe first step.

Audit complete. Awaiting "go" to implement.
