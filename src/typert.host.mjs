const errorSchema = {
  type: 'object',
  properties: { code: { type: ['string', 'null'] }, message: { type: 'string' } },
  required: ['code', 'message'], additionalProperties: false,
};
const nullableError = { anyOf: [errorSchema, { type: 'null' }] };
const nullableOperation = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const snapshotJsonSchema = {
  type: 'object',
  properties: {
    available: { type: 'boolean' }, phase: { type: 'string' },
    policy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    revision: { type: 'number' }, canStop: { type: 'boolean' },
    completionCommitted: { type: 'boolean' },
    routeVerified: { type: 'boolean' }, routeChanged: { type: 'boolean' },
    releaseOperationId: nullableOperation, error: nullableError,
  },
  required: ['available', 'phase', 'policy', 'revision', 'canStop', 'completionCommitted', 'routeVerified',
    'routeChanged', 'releaseOperationId', 'error'],
  additionalProperties: false,
};
const stopJsonSchema = {
  type: 'object',
  properties: {
    outcome: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        recordCommitted: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        completionCommitted: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        inFlightInvalidated: { type: 'boolean' }, drainSettled: { type: 'boolean' },
        routeChanged: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        routeVerified: { type: 'boolean' }, operationId: { type: 'string' },
        error: errorSchema,
      },
      required: ['kind', 'recordCommitted', 'completionCommitted', 'routeChanged', 'routeVerified'],
      additionalProperties: true,
    },
    snapshot: snapshotJsonSchema,
  },
  required: ['outcome', 'snapshot'], additionalProperties: false,
};

function codec(typeSymbol, jsonSchema) {
  return Object.freeze({
    mode: 'strict', typeSymbol,
    create: () => ({ safeParse: value => ({ success: true, value }) }),
    get jsonSchema() { return structuredClone(jsonSchema); },
  });
}

const snapshotCodec = codec('dsh-grok-search/settings#GrokSearchSettingsSnapshot', snapshotJsonSchema);
const stopCodec = codec('dsh-grok-search/settings#GrokSearchSettingsStopResult', stopJsonSchema);

const invocations = [
  {
    id: 'dsh-grok-search#grokSearchSettings/snapshot', service: 'grokSearchSettings',
    namespace: 'grokSearchSettings', method: 'snapshot',
    description: 'Read the current product control state for the plugin settings page.',
    invocation: { kind: 'direct' }, parameters: [], result: snapshotCodec,
  },
  {
    id: 'dsh-grok-search#grokSearchSettings/stop', service: 'grokSearchSettings',
    namespace: 'grokSearchSettings', method: 'stop',
    description: 'Explicitly stop search takeover and return the recorded author route.',
    invocation: { kind: 'direct' }, parameters: [], result: stopCodec,
  },
];

export const TYPERT = Object.freeze({
  package: 'dsh-grok-search',
  face: 'host',
  schemas: [],
  invocations,
  model: Object.freeze({ services: [], events: [], objects: [] }),
});

export default TYPERT;

export function clientContribution() {
  return Object.freeze({
    package: 'dsh-grok-search',
    descriptors: invocations.map(descriptor => Object.freeze({
      id: descriptor.id,
      service: descriptor.service,
      namespace: descriptor.namespace,
      method: descriptor.method,
      description: descriptor.description,
      invocation: descriptor.invocation,
      parameters: descriptor.parameters,
      result: descriptor.result,
    })),
  });
}
