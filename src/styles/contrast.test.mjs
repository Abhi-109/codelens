// Contrast is a property of the palette, not of any one component: a colour
// that fails here fails in every corner that uses it, so it is measured once,
// against the tokens the themes actually ship. Nothing below is hardcoded -
// if a token changes, the ratios below change with it.
//
// Backgrounds are the real surfaces a foreground lands on, and a translucent
// token (an "-bg" tint) is composited onto its surface before it is measured,
// because that is the colour a reader actually sees.
//
// Two minimums are used: 4.5 for text (WCAG AA, normal size - the app's
// smallest labels are 11px, so nothing gets to claim "large text"), and 3.0
// for graphics - a shape outline, an arrow, a focus ring - where 1.4.11 is the
// rule that keeps a diagram readable rather than merely present.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(join(here, 'tokens.css'), 'utf8');

/** The declarations of the block that starts at `selector`. */
function declarations(selector) {
  const at = tokensCss.indexOf(selector);
  if (at < 0) throw new Error(`tokens.css has no ${selector} block`);
  const open = tokensCss.indexOf('{', at);
  let depth = 0;
  let end = open;
  for (let i = open; i < tokensCss.length; i += 1) {
    if (tokensCss[i] === '{') depth += 1;
    else if (tokensCss[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const vars = {};
  for (const [, name, value] of tokensCss
    .slice(open + 1, end)
    .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[name] = value.trim();
  }
  return vars;
}

/** Resolve one token to [r, g, b, alpha], following var() indirection. */
function colour(name, vars, seen = new Set()) {
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  const raw = vars[name];
  if (raw == null) return null;
  const ref = raw.match(/^var\((--[\w-]+)\)$/);
  if (ref) return colour(ref[1], vars, new Set([...seen, name]));

  let m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const h = m[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  m = raw.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1];
    return [0, 2, 4].map((i) => parseInt(h[i] + h[i], 16)).concat(1);
  }
  m = raw.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/i);
  if (m) {
    const raw = m[4] == null ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    return [Number(m[1]), Number(m[2]), Number(m[3]), raw];
  }
  return null;
}

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function luminance([r, g, b]) {
  return 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
}
/** A translucent colour as it really appears: on top of the surface behind it. */
function over(fg, bg) {
  const alpha = fg[3];
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)).concat(1);
}
function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

// :root alone is the light default, so it is read together with the light
// block - exactly what a browser with no data-theme attribute would do.
const themes = {
  light: { ...declarations(':root,'), ...declarations("[data-theme='light']") },
  dark: declarations("[data-theme='dark']"),
};

// [foreground, background, minimum, what a reader uses it for]
const PAIRS = [
  ['--text', '--bg', 4.5, 'body text on the page'],
  ['--text', '--surface', 4.5, 'body text on a panel'],
  ['--text', '--code-bg', 4.5, 'body text on a code panel'],
  ['--text-h', '--bg', 4.5, 'headings on the page'],
  ['--text-h', '--surface', 4.5, 'headings on a panel'],
  ['--accent', '--bg', 4.5, 'accent link on the page'],
  ['--accent', '--surface', 4.5, 'accent link on a panel'],
  ['--accent', '--code-bg', 4.5, 'accent text on a code panel'],
  ['--ok', '--surface', 4.5, 'success text'],
  ['--warn', '--surface', 4.5, 'warning text'],
  ['--danger', '--surface', 4.5, 'error text'],
  ['--ok', '--bg', 4.5, 'success text on the page'],
  ['--warn', '--bg', 4.5, 'warning text on the page'],
  ['--danger', '--bg', 4.5, 'error text on the page'],
  ['--ok', '--code-bg', 4.5, 'success text on a code panel'],
  ['--warn', '--code-bg', 4.5, 'warning text on a code panel'],
  ['--btn-primary-fg', '--btn-primary-bg', 4.5, 'primary button label'],
  ['--btn-primary-fg', '--btn-primary-hover-bg', 4.5, 'primary button label, hovered'],
  ['--on-accent', '--accent-fill', 4.5, 'label on the accent fill'],
  // --border-strong is a hairline. It is not what identifies a control - the
  // label is, and the focus ring below is what carries the state - so WCAG
  // 1.4.11 does not ask it for 3:1, and forcing it would turn a hairline into
  // a rule. Kept in the list so the number is on the record.
  ['--border-strong', '--bg', 1.0, 'hairline separators (decorative)'],
  ['--focus', '--bg', 3.0, 'focus ring on the page'],
  ['--focus', '--surface', 3.0, 'focus ring on a panel'],
  // Every focus ring in the app is outline-offset: 2px, so it lands on the
  // page around the control rather than on the control's own fill. The one
  // inset ring (.inspector-body, -2px) lands on the code panel, which is the
  // pair measured above.
  ['--edge-call', '--bg', 3.0, 'call path'],
  ['--edge-return', '--bg', 3.0, 'return path'],
  ['--edge-back', '--bg', 3.0, 'loop-back path and the loop shapes it returns to'],
  ['--edge-error', '--bg', 3.0, 'exception path'],
  // The control-flow canvas names its five shape families by colour alone.
  ['--slate', '--bg', 3.0, 'neutral flow shapes'],
  ['--copper', '--bg', 3.0, 'input/output flow shapes'],
  ['--teal', '--bg', 3.0, 'start, end and return shapes'],
  ['--violet', '--bg', 3.0, 'call shapes'],
  ['--teal', '--surface', 3.0, 'oval terminators on a panel'],
  ['--violet', '--surface', 3.0, 'call boxes on a panel'],
];

function measure(vars, fgName, bgName) {
  const rawFg = colour(fgName, vars);
  const bg = colour(bgName, vars);
  if (!rawFg || !bg) return null;
  const fg = rawFg[3] < 1 ? over(rawFg, bg) : rawFg;
  return contrast(fg, bg);
}

test('every colour pair the UI draws meets its WCAG minimum', () => {
  const bad = [];
  for (const [theme, vars] of Object.entries(themes)) {
    for (const [fgName, bgName, min, what] of PAIRS) {
      const ratio = measure(vars, fgName, bgName);
      assert.ok(ratio !== null, `${theme}: could not read ${fgName} or ${bgName}`);
      if (ratio < min) {
        bad.push(
          `${theme}: ${fgName} on ${bgName} is ${ratio.toFixed(2)}:1, ` +
            `needs ${min}:1 - ${what}`,
        );
      }
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join('\n')}\n`);
});

test('the accent does both of its jobs legibly: as text, and as a fill under white', () => {
  // --accent is pulled two ways at once. Lighten it and links read on a dark
  // surface while white sinks into a filled button; darken it and the button
  // wins while the links fall under AA. On a dark surface no single colour
  // can hold both (the window does not overlap), so the roles are split into
  // --accent and --accent-fill. On a light surface they coincide at #3b5bff,
  // which is why this test checks the *outcome* rather than insisting the two
  // tokens always differ: what must hold is that both jobs stay legible.
  for (const [theme, vars] of Object.entries(themes)) {
    const white = [255, 255, 255, 1];
    const asFill = contrast(white, colour('--accent-fill', vars));
    assert.ok(
      asFill >= 4.5,
      `${theme}: a white label on --accent-fill is ${asFill.toFixed(2)}:1, needs 4.5:1`,
    );
    for (const surface of ['--bg', '--surface', '--code-bg']) {
      const asText = measure(vars, '--accent', surface);
      assert.ok(
        asText >= 4.5,
        `${theme}: --accent as text on ${surface} is ${asText.toFixed(2)}:1, needs 4.5:1`,
      );
    }
  }
});

// A var() that resolves to nothing does not fail loudly: the declaration is
// dropped at computed-value time and the property falls back to its initial
// value, so a control-flow shape silently loses its family colour and every
// stroke turns black. This is the test that catches that.
const RUNTIME_SET = new Set([
  // Written onto the layout element by App.jsx while the splitter is dragged.
  '--col-left',
  '--col-mid',
]);

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') && entry.name !== 'tokens.css' ? [path] : [];
  });
}

test('every colour named in the stylesheets is defined as a token', () => {
  const defined = new Set(Object.keys(themes.light).concat(Object.keys(themes.dark)));
  const dangling = [];
  for (const file of cssFiles(here)) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(/var\((--[\w-]+)/g)) {
      if (defined.has(name) || RUNTIME_SET.has(name)) continue;
      dangling.push(`${name} (used in ${file.slice(here.length + 1).replace(/\\/g, '/')})`);
    }
  }
  assert.deepEqual(dangling, [], `undefined tokens:\n${[...new Set(dangling)].join('\n')}\n`);
});
