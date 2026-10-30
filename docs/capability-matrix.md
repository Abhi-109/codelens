# CodeLens capability matrix

CodeLens is a general-purpose Python execution visualizer. The Motion canvas uses
reusable animation primitives driven by the deterministic tracer and planner. It
does not require recognizing a specific program.

## Generic execution primitives (always available)

| Python construct / runtime event | Visual primitive |
|---|---|
| Variable creation / update | scalar card with before→after value |
| Expression evaluation | highlighted operand cells |
| Condition evaluation | condition result + chosen branch |
| Loop entry / iteration / exit | loop counter + iteration progression |
| Function call | new frame pushed onto call stack |
| Function return | frame leaves stack, value transferred |
| Collection mutation (list/dict/set) | cell-level insert/remove/replace |
| Object creation / reference | object card + ref indicator |
| Exception | exception transition + stack unwinding |
| Output (print) | output event tile |
| No reconstructable change | honest concise explanation |

## Specialized compositions (when recognized)

| Recognized behaviour | Enhanced visual |
|---|---|
| Sorting / searching | array cells, indices, comparison rings, swaps |
| Recursion | vertical call stack, depth, return propagation |
| Nested loops | iteration counters for each level |
| Linked lists | node cards + pointer edges |
| Trees | hierarchical layout, traversal highlight |
| Graphs | node/edge layout, visited set, queue/stack |
| Stacks / queues | LIFO/FIFO visual containers |

## Fallback rule

When a specialized composition is not recognized, CodeLens falls back to the
generic execution primitives. It never fabricates a value or claims a complete
animation for an unsupported construct. The planner reports the honest reason.

## Testing

Unseen combinations are exercised by the tracer corpus and planner quality
harness (`npm run check:planner`), which covers 122 distinct programs plus
recognition fixtures. No single example is hardcoded as the supported set.
