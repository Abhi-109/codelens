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

export default function HashTableExtras({ state }) {
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
        <StrategyComparison state={state} entries={entries} />
        <ComplexityCard />
      </div>
    </section>
  );
}
