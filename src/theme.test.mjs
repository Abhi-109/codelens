import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTheme, resolveTheme } from './theme.js';

test('normalizeTheme keeps only the two real themes', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
});

test('normalizeTheme rejects everything else', () => {
  for (const bad of [null, undefined, '', 'DARK', 'Blue', 'auto', 0, 1, {}]) {
    assert.equal(normalizeTheme(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('the stored choice wins over the OS preference', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});

test('with no stored choice the OS preference decides', () => {
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
});

test('a junk stored value is treated as no choice at all', () => {
  assert.equal(resolveTheme('solarized', true), 'dark');
  assert.equal(resolveTheme('', false), 'light');
});

test('no information at all lands on light, the documented default', () => {
  assert.equal(resolveTheme(undefined, undefined), 'light');
});
