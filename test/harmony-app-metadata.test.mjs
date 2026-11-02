import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppMetadataLoader } from '../src/views/RemoteEmulator/HarmonyAppMetadata.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('only visible rows load and cached rows do not start another scan', async () => {
  const requests = [], changes = [], states = [];
  const loader = createAppMetadataLoader({
    request: async (_, row) => { requests.push(row.bundle); return { label: row.bundle }; },
    apply: (...args) => changes.push(args), loading: value => states.push(value),
  });
  const rows = Array.from({ length: 211 }, (_, i) => ({ bundle: `app.${i}` }));
  loader.update(rows.slice(0, 7)); await tick();
  assert.equal(requests.length, 7); assert.equal(changes.length, 7); assert.equal(states.at(-1), false);
  loader.update(rows.slice(0, 7)); await tick(); assert.equal(requests.length, 7);
  loader.update(rows.slice(7, 14)); await tick(); assert.equal(requests.length, 14);
  loader.dispose();
});
test('a page change discards the old response and hydrates the latest page', async () => {
  const requests = [], changes = []; let finish;
  const loader = createAppMetadataLoader({
    request: (_, row) => { requests.push(row.bundle); return new Promise(resolve => { finish = resolve; }); },
    apply: (...args) => changes.push(args), loading: () => {},
  });
  loader.update([{ bundle: 'old.1' }, { bundle: 'old.2' }]);
  loader.update([{ bundle: 'new.1' }]); finish({ label: 'stale' }); await tick();
  assert.deepEqual(requests, ['old.1', 'new.1']); assert.equal(changes.length, 0);
  finish({ label: 'current' }); await tick(); assert.equal(changes[0][0], 'new.1');
  loader.dispose();
});
test('failure, hide and session reset release loading without updating stale rows', async () => {
  const states = [], changes = []; let reject;
  const loader = createAppMetadataLoader({
    request: () => new Promise((_, fail) => { reject = fail; }),
    apply: (...args) => changes.push(args), loading: value => states.push(value),
  });
  loader.update([{ bundle: 'app.1' }]); reject(new Error('failed')); await tick();
  assert.deepEqual(changes[0], ['app.1', { unavailable: true }]); assert.equal(states.at(-1), false);
  loader.update([{ bundle: 'app.2' }]); loader.update([], false);
  assert.equal(states.at(-1), false); loader.reset(); reject(new Error('disconnected')); await tick();
  assert.equal(changes.length, 1); assert.equal(states.at(-1), false); loader.dispose();
});
