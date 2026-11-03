import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createSearchLog } from '../src/core/search-log.mjs';
import { createRoutedSearch } from '../src/core/routed-search.mjs';
import { createReleaseBarrier } from '../src/core/release-transaction.mjs';

test('history is opt-in, session scoped, bounded and returned as detached copies', () => {
  const log = createSearchLog(), a = randomUUID(), b = randomUUID();
  assert.equal(log.begin('not collected'), null);
  log.snapshot(a);
  const token = log.begin('<private query>');
  log.snapshot(b);
  log.call(token, { provider: 'tavily', result: 'ok', keyIndex: 0,
    charge: { basis: 'reported', amount: 1, unit: 'credits' } });
  log.finish(token, { outcome: 'ok', served: 'tavily', grokCode: 'DISABLED' });
  const first = log.snapshot(a).records[0];
  assert.equal(first.kind, 'sources');
  assert.equal(first.official, null);
  assert.equal(first.calls[0].charge.amount, 1);
  assert.equal(log.snapshot(b).records.length, 0, 'later page does not receive older query');
  first.q = 'changed';
  assert.equal(log.snapshot(a).records[0].q, '<private query>');
  for (let i = 0; i < 24; i++) log.begin('query ' + i);
  assert.equal(log.snapshot(a).records.length, 20);
  log.dispose();
});

test('clear and close prevent late results from resurrecting private queries', () => {
  const log = createSearchLog(), session = randomUUID();
  log.snapshot(session);
  const token = log.begin('cleared');
  log.clear(session);
  log.finish(token, { outcome: 'ok', served: 'grok' });
  assert.deepEqual(log.snapshot(session), { records: [] });
  log.close(session);
  log.snapshot(session);
  assert.equal(log.begin('after close'), null, 'late lease reads cannot recreate a closed page');
  log.dispose();
});

test('expired sessions do not collect, and untrusted fields are never copied', () => {
  let clock = 0;
  const log = createSearchLog({ now: () => clock }), session = randomUUID();
  assert.throws(() => log.snapshot('not-an-id'));
  log.snapshot(session);
  const token = log.begin('bounded'.repeat(2000));
  log.call(token, { provider: 'unknown', result: 'ok', api_key: 'must-not-copy' });
  log.call(token, { provider: 'exa', result: 'failed', code: 'bad <html>', charge: { amount: -1, unit: 'USD' } });
  log.finish(token, { outcome: 'failed', code: 'unsafe <body>', detail: 'must-not-copy' });
  const value = log.snapshot(session);
  assert.equal(value.records[0].q.length, 5000);
  assert.equal(value.records[0].calls.length, 1);
  assert.equal(value.records[0].calls[0].code, '');
  assert.equal(value.records[0].reason, '');
  assert.equal(JSON.stringify(value).includes('must-not-copy'), false);
  clock = 31_000;
  assert.equal(log.begin('expired'), null);
  log.dispose();
});

test('bounded call list never presents a truncated retry list as complete', () => {
  const log = createSearchLog(), id = randomUUID();
  log.snapshot(id);
  const token = log.begin('many keys');
  for (let i = 0; i < 20; i++) log.call(token, { provider: 'tavily', keyIndex: i, result: 'failed' });
  log.finish(token, { outcome: 'failed', callsComplete: true });
  assert.equal(log.snapshot(id).records[0].calls.length, 16);
  assert.equal(log.snapshot(id).records[0].callsComplete, false);
  log.dispose();
});

test('eight independent leases reject excess pages and reclaim expired slots', () => {
  let clock = 0;
  const log = createSearchLog({ now: () => clock });
  const ids = Array.from({ length: 9 }, () => randomUUID());
  for (const id of ids.slice(0, 8)) log.snapshot(id);
  assert.throws(() => log.snapshot(ids[8]), { code: 'SEARCH_LOG_BUSY' });
  clock = 29_999;
  log.snapshot(ids[0]);
  clock = 30_001;
  log.snapshot(ids[8]);
  const token = log.begin('active leases only');
  log.finish(token, { outcome: 'ok', served: 'grok' });
  assert.equal(log.snapshot(ids[0]).records.length, 1);
  assert.equal(log.snapshot(ids[8]).records.length, 1);
  assert.equal(log.snapshot(ids[1]).records.length, 0);
  log.dispose();
  assert.deepEqual(log.snapshot(ids[0]), { records: [] });
  assert.equal(log.begin('after disposal'), null);
});

test('routed search records actual results only, not diagnostics or replay requests', async () => {
  const routed = createRoutedSearch({
    grok: { search: async () => ({ content: '', sources: [{ url: 'https://result.test' }] }) },
    sourceRouter: {}, releaseBarrier: createReleaseBarrier(),
  });
  const id = randomUUID();
  routed.searchLog.snapshot(id);
  await routed.search({ query: 'real search' });
  await routed.search({ query: 'test search' }, undefined, 'test');
  await routed.testGrok({ query: 'diagnostic' });
  const rows = routed.searchLog.snapshot(id).records;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].q, 'real search');
  assert.equal(rows[0].kind, 'ok');
  assert.equal(rows[0].callsComplete, false);
  assert.equal(rows[0].calls[0].provider, 'grok');
  assert.equal(rows[0].official, null);
  await routed.dispose();
});

test('cancellation and stop finalize running records without an invented source', async () => {
  const routed = createRoutedSearch({
    grok: { search: (request, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) },
    sourceRouter: {}, releaseBarrier: createReleaseBarrier(),
  });
  const id = randomUUID(), controller = new AbortController();
  routed.searchLog.snapshot(id);
  const task = routed.search({ query: 'cancel me' }, controller.signal);
  const rejected = assert.rejects(task);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('private reason'));
  await rejected;
  const row = routed.searchLog.snapshot(id).records[0];
  assert.equal(row.kind, 'cancelled');
  assert.equal(row.served, null);
  assert.equal(JSON.stringify(row).includes('private reason'), false);
  await routed.dispose();
});
