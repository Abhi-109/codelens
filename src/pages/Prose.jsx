/* The small renderer shared by lessons and documentation pages.
 *
 * Content is data (plain objects) rather than JSX so the lesson and doc
 * modules can be imported by node --test: a claim with no page, a page with
 * no content, or a link to an example that does not exist then fails a test
 * instead of shipping. This file is the only place a block becomes markup.
 */

export function Blocks({ blocks }) {
  return blocks.map((block, i) => {
    if (block.h) return <h2 key={i}>{block.h}</h2>;
    if (block.p) return <p key={i}>{block.p}</p>;
    if (block.list) {
      return (
        <ul key={i}>
          {block.list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    }
    if (block.code) {
      return (
        <pre key={i} className="lesson-code">
          <code>{block.code}</code>
        </pre>
      );
    }
    if (block.note) return <p key={i} className="prose-note">{block.note}</p>;
    return null;
  });
}

/** Questions a reader can answer, folded away so the answer is not a spoiler. */
export function Checkpoints({ items }) {
  return (
    <ul className="checkpoints">
      {items.map((item) => (
        <li key={item.q}>
          <details className="checkpoint">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
