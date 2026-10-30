/* The hash table's learning extras, below the two-panel lab.
 *
 * Everything here is computed from the same model the animation uses: the
 * predict exercise compares against bucketIndex(), the comparison runs the
 * real insert path, and the collision hint calls findCollision(). None of it
 * is a second, illustrative narrative.
 */

import { useState } from 'react';
import {
  CANDIDATE_KEYS,
  bucketIndex,
  compareStrategies,
  findCollision,
  hashFunctionLabel,
  previewInsert,
  previewResize,
  rawHash,
  strategyLabel,
} from './hashTable.js';

const entriesOf = (state) =>
  state.strategy === 'chaining'
    ? state.table.flat().map(({ key, value }) => ({ key, value }))
    : state.table.filter((slot) => slot && !slot.tombstone).map(({ key, value }) => ({ key, value }));

function PredictBucket({ state, suggestion }) {
  const [key, setKey] = useState("apple");
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(null);

  const actual = bucketIndex(state.hashFn, key, state.capacity, state.universal);
  const raw = rawHash(state.hashFn, key);
  const fresh =
    checked &&
    checked.key === key &&
    checked.raw === raw &&
    checked.capacity === state.capacity &&
    checked.hashFn === state.hashFn;

  function check(event) {
    event.preventDefault();
    const guess = Number(answer);
    setChecked({
      key,
      raw,
      capacity: state.capacity,
      hashFn: state.hashFn,
      guess,
      correct: Number.isInteger(guess) && guess === actual,
    });
  }

  return (
    <div className="ds-extra-card">
      <h3>Predict the bucket</h3>
      <p className="ds-extra-copy">
        At capacity {state.capacity} with {hashFunctionLabel(state.hashFn).toLowerCase()}, which bucket
        does a key target? The answer is the same calculation the table performs.
      </p>
      <form className="ds-predict" onSubmit={check}>
        <label className="ds-field">
          <span>Key</span>
          <input
            type="text"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setChecked(null);
            }}
            aria-label="Predict key"
          />
        </label>
        <label className="ds-field">
          <span>Bucket</span>
          <input
            type="number"
            min="0"
            max={state.capacity - 1}
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value);
              setChecked(null);
            }}
            aria-label="Predicted bucket"
          />
        </label>
        <button type="submit" className="ds-btn">
          Check
        </button>
      </form>
      {fresh ? (
        <p className={`ds-feedback${checked.correct ? ' is-correct' : ' is-wrong'}`} role="status">
          {checked.correct
            ? `Correct: ${key} hashes to bucket ${actual}.`
            : `Not quite. ${key} hashes to bucket ${actual}, not ${checked.guess}.`}{" "}
          Raw hash {raw}
          {state.hashFn === "multiplication"
            ? " scaled by the golden-ratio fraction."
            : state.hashFn === "universal"
              ? `; (${state.universal.a} × (${raw} mod ${state.universal.p}) + ${state.universal.b}) mod ${state.universal.p}, then mod ${state.capacity} = ${actual}.`
              : ` mod ${state.capacity} = ${actual}.`}
        </p>
      ) : null}
      {suggestion ? (
        <p className="ds-extra-hint">
          Collision detective: <strong>{suggestion.a}</strong> and <strong>{suggestion.b}</strong> both
          target bucket {suggestion.index} with this configuration.{" "}
          <button
            type="button"
            className="ds-link-button"
            onClick={() => {
              setKey(suggestion.b);
              setAnswer(String(suggestion.index));
              setChecked(null);
            }}
          >
            Use {suggestion.b}
          </button>
        </p>
      ) : (
        <p className="ds-extra-hint">No collision among the candidate keys at this capacity.</p>
      )}
    </div>
  );
}

function PredictNextSlot({ state, onReplay }) {
  const [key, setKey] = useState("apple");
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(null);

  const preview = previewInsert(state, key, "1");
  const ready = preview && !preview.error;
  const fresh =
    checked &&
    checked.key === key &&
    checked.capacity === state.capacity &&
    checked.strategy === state.strategy &&
    checked.hashFn === state.hashFn;

  function check(event) {
    event.preventDefault();
    if (!ready) return;
    const guess = Number(answer);
    setChecked({
      key,
      capacity: state.capacity,
      strategy: state.strategy,
      hashFn: state.hashFn,
      guess,
      correct: Number.isInteger(guess) && guess === preview.slot,
      preview,
    });
  }

  const prompt = !ready
    ? "Type a key to preview its placement."
    : state.strategy === "chaining"
      ? `With separate chaining the key is appended to its home bucket ${preview.home}. Which bucket holds it?`
      : state.strategy === "robin-hood"
        ? `The first probe is bucket ${preview.home}. Robin Hood may swap with a resident on the way, so predict the final slot, not the next probe (${preview.nextProbe}).`
        : `The home bucket is ${preview.home}. Which slot finally holds the key after ${strategyLabel(state.strategy).toLowerCase()}?`;

  return (
    <div className="ds-extra-card">
      <h3>Predict the next slot</h3>
      <p className="ds-extra-copy">{prompt}</p>
      <form className="ds-predict" onSubmit={check}>
        <label className="ds-field">
          <span>Key</span>
          <input
            type="text"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setChecked(null);
            }}
            aria-label="Predict next slot key"
          />
        </label>
        <label className="ds-field">
          <span>{state.strategy === "chaining" ? "Bucket" : "Slot"}</span>
          <input
            type="number"
            min="0"
            max={state.capacity - 1}
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value);
              setChecked(null);
            }}
            aria-label="Predicted slot"
          />
        </label>
        <button type="submit" className="ds-btn" disabled={!ready}>
          Check slot
        </button>
      </form>
      {fresh ? (
        <>
          <p className={`ds-feedback${checked.correct ? " is-correct" : " is-wrong"}`} role="status">
            {checked.correct
              ? `Correct: ${checked.key} lands in slot ${checked.preview.slot}.`
              : `Not quite. ${checked.key} lands in slot ${checked.preview.slot}, not ${checked.guess}.`}{" "}
            {checked.preview.updated
              ? `${checked.key} is already stored, so this is an update to its value.`
              : `It inspected ${checked.preview.probes} ${checked.preview.probes === 1 ? "slot" : "slots"}.`}{" "}
            {checked.preview.swaps
              ? `Robin Hood displaced ${checked.preview.swaps} ${checked.preview.swaps === 1 ? "resident" : "residents"} on the way.`
              : ""}
          </p>
          {onReplay ? (
            <button
              type="button"
              className="ds-link-button"
              onClick={() => onReplay("insert", { key: checked.key, value: "1" })}
            >
              Replay placement
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PredictResize({ state, onReplay }) {
  const [key, setKey] = useState("apple");
  const [checked, setChecked] = useState(null);
  const preview = previewResize(state, key);
  const ready = preview && !preview.error;
  const threshold = `${(state.threshold * 100).toFixed(0)}%`;
  const fresh =
    checked &&
    checked.key === key &&
    checked.capacity === state.capacity &&
    checked.strategy === state.strategy &&
    checked.hashFn === state.hashFn;

  function answer(guess) {
    if (!ready) return;
    setChecked({
      key,
      capacity: state.capacity,
      strategy: state.strategy,
      hashFn: state.hashFn,
      guess,
      correct: guess === preview.grows,
      preview,
    });
  }

  return (
    <div className="ds-extra-card">
      <h3>Will it resize?</h3>
      <p className="ds-extra-copy">
        The table holds {state.count} {state.count === 1 ? "key" : "keys"} in {state.capacity}{" "}
        {state.capacity === 1 ? "slot" : "slots"} (load {(state.count / state.capacity).toFixed(2)}),
        and the threshold is {threshold}. If you insert a new key, will the table grow?
      </p>
      <p className="ds-extra-hint">
        The growth check runs after a <em>new</em> key is placed. Updating a key that is already stored
        does not change the count.
      </p>
      <div className="ds-predict">
        <label className="ds-field">
          <span>Key</span>
          <input
            type="text"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setChecked(null);
            }}
            aria-label="Resize prediction key"
          />
        </label>
        <button type="button" className="ds-btn" onClick={() => answer(true)} disabled={!ready}>
          Yes, it grows
        </button>
        <button type="button" className="ds-btn" onClick={() => answer(false)} disabled={!ready}>
          No, it stays
        </button>
      </div>
      {fresh ? (
        <>
          <p className={`ds-feedback${checked.correct ? " is-correct" : " is-wrong"}`} role="status">
            {checked.correct ? "Correct. " : "Not quite. "}
            {checked.preview.updated
              ? `${checked.key} is already stored, so the insert updates its value: the count stays ${checked.preview.countBefore} and the growth check does not run.`
              : checked.preview.placed
                ? `After the insert the load is ${checked.preview.countAfter}/${checked.preview.from} = ${checked.preview.loadAfter.toFixed(2)}, ${checked.preview.loadAfter > checked.preview.threshold ? "above" : "at or below"} the ${threshold} threshold, so the table ${checked.preview.grows ? `grows from ${checked.preview.from} to ${checked.preview.to}` : `stays at ${checked.preview.from}`}.`
                : "The table cannot place another key, so it cannot grow."}
          </p>
          {onReplay ? (
            <button
              type="button"
              className="ds-link-button"
              onClick={() => onReplay("insert", { key: checked.key, value: "1" })}
            >
              Replay resize
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StrategyComparison({ state, entries }) {
  const keys = entries.length >= 3 ? entries.map((entry) => entry.key) : undefined;
  const rows = compareStrategies({
    keys,
    capacity: state.capacity,
    hashFn: state.hashFn,
    params: state.universal,
  });
  return (
    <div className="ds-extra-card ds-extra-wide">
      <h3>Compare the strategies</h3>
      <p className="ds-extra-copy">
        The same {keys ? `${keys.length} keys from this table` : "fixed eight-key demo set"} inserted into
        capacity {state.capacity}, with resizing off. Probes are entries or slots inspected; collisions
        are inspections that found a different key. These are operation-model counts, not timings.
      </p>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <caption className="ds-sr">Strategy comparison for the current workload</caption>
          <thead>
            <tr>
              <th scope="col">Strategy</th>
              <th scope="col">Collisions</th>
              <th scope="col">Probes</th>
              <th scope="col">Avg / insert</th>
              <th scope="col">Max</th>
              <th scope="col">Placed</th>
              <th scope="col">Load</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.id === state.strategy ? "is-current" : undefined}>
                <th scope="row">{row.label}</th>
                <td>{row.collisions}</td>
                <td>{row.probes}</td>
                <td>{row.averageProbes.toFixed(2)}</td>
                <td>{row.maxProbes}</td>
                <td>
                  {row.occupied}
                  {row.failed ? ` (${row.failed} failed)` : ""}
                </td>
                <td>{row.loadFactor.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ds-extra-hint">
        No strategy is always best: chaining tolerates a load above 1, probing loses slots to
        clustering and tombstones, and double hashing needs a prime capacity for a full cycle.
      </p>
    </div>
  );
}

function ComplexityCard() {
  return (
    <div className="ds-extra-card ds-extra-wide">
      <h3>Expected versus worst case</h3>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <caption className="ds-sr">Hash table complexity</caption>
          <thead>
            <tr>
              <th scope="col">Operation</th>
              <th scope="col">Expected / average</th>
              <th scope="col">Worst case</th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">Insert</th><td>O(1) under good hashing and a bounded load</td><td>O(n)</td></tr>
            <tr><th scope="row">Search / contains</th><td>O(1) under the same assumptions</td><td>O(n)</td></tr>
            <tr><th scope="row">Delete</th><td>O(1) under the same assumptions</td><td>O(n)</td></tr>
            <tr><th scope="row">Update</th><td>O(1) under the same assumptions</td><td>O(n)</td></tr>
            <tr><th scope="row">Rehash / resize</th><td>O(n) for the rebuild</td><td>O(n)</td></tr>
          </tbody>
        </table>
      </div>
      <ul className="ds-extra-list">
        <li>Expected constant time is a statement about a good hash and a workload, not a promise for every key set.</li>
        <li>Separate chaining averages about O(1 + α) where α is the load factor; open addressing degrades sharply as free slots run out.</li>
        <li>One resize is linear even when an ordinary insert is expected constant. Amortised over a doubling sequence it is still constant per insert.</li>
        <li>Timing a tiny table in a browser is noisy; the probe and collision counts above are the honest comparison.</li>
      </ul>
    </div>
  );
}

export default function HashTableExtras({ state, onReplay }) {
  const entries = entriesOf(state);
  const load = state.count / state.capacity;
  const suggestion = findCollision(
    state.hashFn,
    state.capacity,
    [...CANDIDATE_KEYS, ...entries.map((entry) => entry.key)],
    state.universal,
  );

  return (
    <section className="ds-extras" aria-labelledby="ds-extras-title">
      <h2 id="ds-extras-title">Explore this table</h2>
      <div className="ds-facts">
        <span><strong>{strategyLabel(state.strategy)}</strong> strategy</span>
        <span>{state.count} keys / {state.capacity} buckets</span>
        <span>load factor {state.count}/{state.capacity} = <strong>{load.toFixed(2)}</strong></span>
        <span>{state.tombstones} {state.tombstones === 1 ? "tombstone" : "tombstones"}</span>
      </div>
      {state.hashFn === "universal" ? (
        <p className="ds-extra-hint">
          Universal parameters: seed <strong>{state.universal.seed}</strong>, a ={" "}
          <strong>{state.universal.a}</strong>, b = <strong>{state.universal.b}</strong>, p ={" "}
          <strong>{state.universal.p}</strong> (prime, above the capacity cap). The family bounds the
          chance of a collision when parameters are chosen from it; a fixed seed still collides for
          some key pairs, and changing the seed does not have to move every key.
        </p>
      ) : null}
      <div className="ds-extra-grid">
        <PredictBucket state={state} suggestion={suggestion} />
        <PredictNextSlot state={state} onReplay={onReplay} />
        <PredictResize state={state} onReplay={onReplay} />
        <StrategyComparison state={state} entries={entries} />
        <ComplexityCard />
      </div>
    </section>
  );
}
