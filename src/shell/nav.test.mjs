import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES, matchRoute } from '../router.js';
import { FOOTER_LINKS, isActive, NAV } from './nav.js';

/* The navigation is the product's front door, so these tests read the real
   NAV list in src/shell/nav.js (the same object AppShell renders) rather than
   restating it. Restating would let the test drift from the site. */

const item = (label) => NAV.find((n) => n.label === label);

test('"Visualize" is in the nav and leads to the language picker', () => {
  const visualize = item('Visualize');
  assert.ok(visualize, 'nav is missing a "Visualize" item');
  assert.equal(visualize.to, '/get-started');
});

test('no nav item claims to be a Python-only product', () => {
  // The product is language-neutral; Python belongs to the one language page.
  for (const entry of NAV) {
    assert.doesNotMatch(entry.label, /python/i, `"${entry.label}" over-specifies Python`);
  }
});

test('"Visualize" is active on both the picker and the Python visualizer', () => {
  const visualize = item('Visualize');
  for (const path of ['/get-started', '/visualizer/python']) {
    const match = matchRoute(path, ROUTES);
    assert.ok(match, `${path} is not a known route`);
    assert.ok(
      isActive(match.route.name, visualize.match),
      `"Visualize" should be active on ${path} (route "${match.route.name}")`,
    );
  }
});

test('each nav item is active on exactly the routes it claims', () => {
  for (const entry of NAV) {
    const targets = Array.isArray(entry.match) ? entry.match : [entry.match];
    // Every claimed route name must exist in the real route table.
    for (const name of targets) {
      assert.ok(
        ROUTES.some((r) => r.name === name),
        `"${entry.label}" matches unknown route "${name}"`,
      );
    }
    // And every nav href must itself be a routable path.
    assert.ok(matchRoute(entry.to, ROUTES), `"${entry.label}" points at unroutable ${entry.to}`);
  }
});

test('exactly one nav item is active on any given route', () => {
  // Guards two highlighted links at once (e.g. Visualize vs Get Started).
  for (const route of ROUTES) {
    const active = NAV.filter((entry) => isActive(route.name, entry.match));
    if (active.length > 1) {
      assert.fail(`routes "${route.name}" lights up ${active.map((a) => a.label).join(' and ')}`);
    }
  }
});

test('the footer repeats the nav minus "Home"', () => {
  assert.deepEqual(
    FOOTER_LINKS.map((n) => n.label),
    NAV.filter((n) => n.label !== 'Home').map((n) => n.label),
  );
  // The wordmark covers home, so no footer entry should point at the root.
  for (const link of FOOTER_LINKS) assert.notEqual(link.to, '/');
});
