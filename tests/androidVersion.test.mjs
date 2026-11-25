import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_VERSION_CODE, parseReleaseTag, versionCodeFor, withReleaseVersion } from '../scripts/set-android-version.mjs';

test('release tags map to a version name and an ordered versionCode', () => {
  assert.deepEqual(parseReleaseTag('v1.2.3'), { major: 1, minor: 2, patch: 3, version: '1.2.3' });
  assert.equal(versionCodeFor('v1.2.3'), 10203);
  assert.equal(versionCodeFor('1.0.0'), 10000);
  assert.equal(versionCodeFor('v0.0.1'), 1);
});

test('later releases always get a higher versionCode', () => {
  const tags = ['v0.9.99', 'v1.0.0', 'v1.0.1', 'v1.0.10', 'v1.1.0', 'v1.99.99', 'v2.0.0', 'v10.0.0'];
  const codes = tags.map(versionCodeFor);
  assert.deepEqual([...codes].sort((a, b) => a - b), codes);
  assert.equal(new Set(codes).size, codes.length);
});

test('malformed or out-of-range tags are rejected', () => {
  for (const bad of ['v1.2', 'v1.2.3.4', 'release-1', 'v1.100.0', 'v1.0.100', 'v1.2.3-beta', '', undefined]) {
    assert.throws(() => versionCodeFor(bad), /release tag/, String(bad));
  }
  assert.throws(() => versionCodeFor('v0.0.0'), /no valid Android versionCode/);
});

test('the versionCode stays under Android maximum for the largest accepted tag', () => {
  assert.ok(versionCodeFor('v99999.99.99') <= MAX_VERSION_CODE);
});

test('withReleaseVersion sets version and android.versionCode without touching anything else', () => {
  const app = Object.freeze({ expo: Object.freeze({ name: 'FinFeast', version: '1.0.0', android: Object.freeze({ package: 'com.finfeast.app' }) }) });
  const next = withReleaseVersion(app, 'v1.4.2');
  assert.equal(next.expo.version, '1.4.2');
  assert.deepEqual(next.expo.android, { package: 'com.finfeast.app', versionCode: 10402 });
  assert.equal(next.expo.name, 'FinFeast');
  assert.equal(app.expo.version, '1.0.0');
});
