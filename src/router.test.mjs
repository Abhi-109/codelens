import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES, buildPath, matchPath, matchRoute, normalizePath } from './router.js';

test('every required route is in the table', () => {
  const paths = ROUTES.map((r) => r.path);
  for (const required of [
    '/',
    '/get-started',
    '/visualizer/python',
    '/visualizer/data-structures',
    '/visualizer/data-structures/:type',
    '/learn',
    '/learn/:section/:lesson',
    '/docs',
    '/docs/:page',
    '/about',
  ]) {
    assert.ok(paths.includes(required), `missing route ${required}`);
  }
});

test('route names are unique', () => {
  const names = ROUTES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
});

test('normalizePath strips query, hash and trailing slashes', () => {
  assert.equal(normalizePath('/docs/intro?from=home'), '/docs/intro');
  assert.equal(normalizePath('/docs/intro#top'), '/docs/intro');
  assert.equal(normalizePath('/docs/'), '/docs');
  assert.equal(normalizePath('/docs///'), '/docs');
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath(undefined), '/');
});

test('matchPath matches static routes exactly', () => {
  assert.deepEqual(matchPath('/docs', '/docs'), {});
  assert.equal(matchPath('/docs', '/docs/intro'), null);
  assert.equal(matchPath('/docs/intro', '/docs'), null);
  assert.equal(matchPath('/docs', '/about'), null);
});

test('matchPath captures params', () => {
  assert.deepEqual(matchPath('/docs/:page', '/docs/intro'), { page: 'intro' });
  assert.deepEqual(matchPath('/learn/:section/:lesson', '/learn/basics/2'), {
    section: 'basics',
    lesson: '2',
  });
});

test('an empty param segment is not a match', () => {
  assert.equal(matchPath('/docs/:page', '/docs/'), null);
  assert.equal(matchPath('/learn/:section/:lesson', '/learn/basics/'), null);
});

test('params are URL-decoded', () => {
  assert.deepEqual(matchPath('/docs/:page', '/docs/how%20to%20run'), {
    page: 'how to run',
  });
});

test('matchRoute picks the first matching route', () => {
  const hit = matchRoute('/visualizer/data-structures/stack');
  assert.equal(hit.route.name, 'data-structure');
  assert.deepEqual(hit.params, { type: 'stack' });
});

test('matchRoute returns null for an unknown path', () => {
  assert.equal(matchRoute('/nope'), null);
  assert.equal(matchRoute('/visualizer/data-structures/stack/deep'), null);
});

test('buildPath fills params and encodes them', () => {
  assert.equal(buildPath('home'), '/');
  assert.equal(buildPath('doc', { page: 'intro' }), '/docs/intro');
  assert.equal(
    buildPath('lesson', { section: 'basics', lesson: 'how code runs' }),
    '/learn/basics/how%20code%20runs',
  );
});

test('buildPath refuses unknown routes and missing params', () => {
  assert.throws(() => buildPath('nope'), /unknown route/);
  assert.throws(() => buildPath('lesson', { section: 'basics' }), /missing param/);
});

test('built paths round-trip through matchRoute', () => {
  const link = buildPath('data-structure', { type: 'linked-list' });
  const hit = matchRoute(link);
  assert.equal(hit.route.name, 'data-structure');
  assert.deepEqual(hit.params, { type: 'linked-list' });
});
