export const name = 'dsh-grok-search-settings-ui';
export const inject = ['grokSearchControl'];

const REMOTE_SERVICE = 'grokSearchSettings';
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

class GrokSearchSettingsGateway {
  constructor(ctx) {
    this.ctx = ctx;
    this.typertRemote = Object.freeze({ service: this, serviceKey: REMOTE_SERVICE, namespace: REMOTE_SERVICE });
    ctx.provide(REMOTE_SERVICE, this);
  }

  async snapshot() {
    const control = this.ctx.grokSearchControl ?? null;
    if (!control || typeof control.publicSnapshot !== 'function' || typeof control.stop !== 'function') {
      return {
        available: false,
        phase: 'unavailable',
        policy: null,
        revision: 0,
        canStop: false,
        completionCommitted: false,
        routeVerified: false,
        routeChanged: false,
        releaseOperationId: null,
        error: { code: 'CONTROL_SETTINGS_UNAVAILABLE', message: '搜索控制组件当前未加载。' },
      };
    }
    return { available: true, ...control.publicSnapshot() };
  }

  async stop() {
    const control = this.ctx.grokSearchControl ?? null;
    if (!control || typeof control.stop !== 'function') {
      throw new Error('CONTROL_SETTINGS_UNAVAILABLE: 搜索控制组件当前未加载。');
    }
    const outcome = await control.stop('settings-ui-explicit-stop');
    return { outcome, snapshot: await this.snapshot() };
  }
}

Object.defineProperty(GrokSearchSettingsGateway.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: 'snapshot', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'stop', invocation: Object.freeze({ kind: 'direct' }) }),
    ]),
  }),
});

export function apply(ctx) {
  ctx.plugin(GrokSearchSettingsGateway);
}
