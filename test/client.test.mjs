import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { TYPERT } from '../src/typert.host.mjs';

function loadClient() {
  let factory;
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild() {} },
  };
  const window = { __ModuleLoader__: { load(definition) { factory = definition.factory; } } };
  const context = { window, document, structuredClone, console };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), context,
    { filename: 'src/client.js' });
  assert.equal(typeof factory, 'function');
  const react = { useState: () => [], useCallback: value => value, useEffect() {} };
  const jsx = () => ({});
  return factory(name => name === 'react' ? react : { jsx, jsxs: jsx });
}

function validate(value, schema, path = '$') {
  if (schema.anyOf) {
    let valid = false;
    for (const option of schema.anyOf) {
      try { validate(value, option, path); valid = true; break; } catch {}
    }
    assert.ok(valid, `${path} did not match anyOf`);
    return;
  }
  if (Array.isArray(schema.type)) {
    let valid = false;
    for (const type of schema.type) {
      try { validate(value, { ...schema, type }, path); valid = true; break; } catch {}
    }
    assert.ok(valid, `${path} did not match type union`);
    return;
  }
  if (schema.type === 'object') {
    assert.equal(typeof value, 'object', `${path} must be an object`);
    assert.ok(value !== null && !Array.isArray(value), `${path} must be an object`);
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) validate(item, schema.properties[key], `${path}.${key}`);
      else assert.notEqual(schema.additionalProperties, false, `${path}.${key} is not allowed`);
    }
    return;
  }
  if (schema.type === 'string') assert.equal(typeof value, 'string', `${path} must be a string`);
  else if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', `${path} must be a boolean`);
  else if (schema.type === 'number') assert.equal(typeof value, 'number', `${path} must be a number`);
}

const snapshot = {
  available: true,
  phase: 'released',
  policy: 'released',
  revision: 3,
  canStop: false,
  completionCommitted: true,
  routeVerified: true,
  routeChanged: true,
  releaseOperationId: 'operation',
  error: null,
};

const outcomes = [
  {
    kind: 'released', recordCommitted: true, completionCommitted: true,
    inFlightInvalidated: true, drainSettled: true, routeChanged: true, routeVerified: true,
    operationId: 'operation', envelope: {}, routeReceipt: {},
  },
  {
    kind: 'already-released', recordCommitted: false, completionCommitted: true,
    routeChanged: true, routeVerified: true,
  },
  {
    kind: 'incomplete', recordCommitted: false, completionCommitted: false,
    inFlightInvalidated: true, drainSettled: true, routeChanged: null, routeVerified: false,
    operationId: 'operation', error: { code: 'CONTROL_RECORD_WRITE_FAILED', message: 'write failed' },
  },
];

test('client phase mapping distinguishes all public control phases', () => {
  const client = loadClient();
  const key = client.__test.phaseLabelKey;
  assert.equal(key({ available: false }), 'unavailable');
  assert.equal(key({ available: true, policy: 'released', completionCommitted: true, routeVerified: true }), 'released');
  assert.equal(key({ available: true, policy: 'released', completionCommitted: false, routeVerified: true }), 'incomplete');
  assert.equal(key({ available: true, policy: 'required', phase: 'conflict' }), 'conflict');
  assert.equal(key({ available: true, policy: 'required', phase: 'checking' }), 'checking');
  assert.equal(key({ available: true, policy: 'required', phase: 'idle' }), 'checking');
  assert.equal(key({ available: true, policy: 'required', phase: 'stopping' }), 'stopping');
  assert.equal(key({ available: true, policy: 'required', phase: 'stopped' }), 'stopped');
  assert.equal(key({ available: true, policy: 'required', phase: 'incomplete', canStop: true }), 'required');
  assert.equal(key({ available: true, policy: 'required', phase: 'incomplete', canStop: false }), 'takeoverIncomplete');
});

test('client stop failure merges the latest snapshot and preserves the local error', () => {
  const client = loadClient();
  const current = { status: 'ready', value: { phase: 'required' }, stopping: true, error: null };
  const latest = { phase: 'incomplete', policy: 'required', canStop: false };
  const withSnapshot = client.__test.mergeStopFailure(current,
    { code: 'CONTROL_CAS_CONFLICT', message: 'lost race' }, latest);
  assert.equal(withSnapshot.value, latest);
  assert.equal(withSnapshot.stopping, false);
  assert.equal(withSnapshot.error, 'CONTROL_CAS_CONFLICT: lost race');

  const withoutSnapshot = client.__test.mergeStopFailure(current,
    { code: 'CONTROL_RELEASE_DRAIN_TIMEOUT', message: 'still busy' }, null);
  assert.equal(withoutSnapshot.value, current.value);
  assert.equal(withoutSnapshot.error, 'CONTROL_RELEASE_DRAIN_TIMEOUT: still busy');
});

test('client and host schemas accept every real stop outcome shape', () => {
  const client = loadClient();
  const clientSchemas = client.__test.schemas();
  const hostSnapshot = TYPERT.invocations.find(entry => entry.method === 'snapshot').result.jsonSchema;
  const hostStop = TYPERT.invocations.find(entry => entry.method === 'stop').result.jsonSchema;

  assert.deepEqual(JSON.parse(JSON.stringify(clientSchemas.snapshot)), hostSnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(clientSchemas.stop)), hostStop);
  validate(snapshot, hostSnapshot);
  for (const outcome of outcomes) validate({ outcome, snapshot }, hostStop);
});
