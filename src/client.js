window.__ModuleLoader__.load({
  id: 'dsh-grok-search',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');

    const NS = 'settings.grokSearch';
    const inject = ['slots', 'locale', 'remote'];
    const zh = {
      tab: 'Grok 搜索',
      title: 'Grok 搜索接管',
      description: '搜索由用户已有的 grok-search-rs 提供。停止接管会恢复原来的搜索设置。',
      phase: '当前状态',
      required: '正在接管',
      released: '已恢复原搜索',
      incomplete: '释放未完成',
      takeoverIncomplete: '接管未完成',
      conflict: '接管冲突',
      checking: '正在检查',
      stopped: '已停止接管',
      unavailable: '控制组件不可用',
      stop: '停止接管并恢复原搜索',
      stopping: '正在停止…',
      retry: '重试',
      verified: '路由与原始搜索计数已验证',
      failed: '操作失败，请保留错误信息。',
      restart: 'PluginManager 停用或移除后必须完整重启 DSH 才会生效。',
    };
    const en = {
      tab: 'Grok search', title: 'Grok search takeover',
      description: 'Search is served by the grok-search-rs program you provide. Stopping takeover restores the previous search setting.',
      phase: 'Current state', required: 'Takeover active', released: 'Original search restored',
      incomplete: 'Release incomplete', takeoverIncomplete: 'Takeover incomplete',
      conflict: 'Takeover conflict', checking: 'Checking', stopped: 'Takeover stopped',
      unavailable: 'Control unavailable',
      stop: 'Stop takeover and restore search', stopping: 'Stopping…', retry: 'Retry',
      verified: 'Route and original-search counter verified', failed: 'The operation failed; keep the error details.',
      restart: 'After disabling or removing the bundle in PluginManager, fully restart DSH.',
    };

    const css = '.grokSearchSettings{padding:16px 0;max-width:680px;display:flex;flex-direction:column;gap:12px}.grokSearchSettings h2{margin:0;font-size:16px}.grokSearchSettings p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.grokSearchSettings .status{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:10px 12px}.grokSearchSettings button{width:max-content;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;padding:7px 12px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.grokSearchSettings button:disabled{cursor:default;opacity:.55}.grokSearchSettings .error{color:var(--dsw-alias-state-error-primary)}';
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-grok-search/settings.css"]')) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-grok-search';
      tag.dataset.pluginCss = 'dsh-grok-search/settings.css';
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const errorJsonSchema = {
      type: 'object',
      properties: { code: { type: ['string', 'null'] }, message: { type: 'string' } },
      required: ['code', 'message'], additionalProperties: false,
    };

    const phaseLabelKey = value => {
      if (!value?.available) return 'unavailable';
      if (value.policy === 'released') {
        return value.completionCommitted === true && value.routeVerified === true ? 'released' : 'incomplete';
      }
      if (value.phase === 'conflict') return 'conflict';
      if (value.phase === 'checking' || value.phase === 'idle') return 'checking';
      if (value.phase === 'stopping') return 'stopping';
      if (value.phase === 'stopped') return 'stopped';
      return value.canStop ? 'required' : 'takeoverIncomplete';
    };

    const formatStopError = error => {
      const code = error?.code ?? 'ERROR';
      const message = error?.message ?? String(error);
      return `${code}: ${message}`;
    };

    const mergeStopFailure = (current, error, latestSnapshot = null) => ({
      ...current,
      stopping: false,
      ...(latestSnapshot === null ? {} : { value: latestSnapshot }),
      error: formatStopError(error),
    });

    function clientSchemas() {
      const schemas = {
        snapshot: {
          type: 'object',
          properties: {
            available: { type: 'boolean' }, phase: { type: 'string' },
            policy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            revision: { type: 'number' }, canStop: { type: 'boolean' },
            completionCommitted: { type: 'boolean' },
            routeVerified: { type: 'boolean' }, routeChanged: { type: 'boolean' },
            releaseOperationId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            error: { anyOf: [errorJsonSchema, { type: 'null' }] },
          },
          required: ['available', 'phase', 'policy', 'revision', 'canStop', 'completionCommitted',
            'routeVerified', 'routeChanged', 'releaseOperationId', 'error'],
          additionalProperties: false,
        },
        stop: {
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
                error: errorJsonSchema,
              },
              required: ['kind', 'recordCommitted', 'completionCommitted', 'routeChanged', 'routeVerified'],
              additionalProperties: true,
            },
            snapshot: undefined,
          },
          required: ['outcome', 'snapshot'], additionalProperties: false,
        },
      };
      schemas.stop.properties.snapshot = schemas.snapshot;
      return schemas;
    }

    function GrokSearchSettings({ t, remote }) {
      const [state, setState] = react.useState({ status: 'loading' });
      const refresh = react.useCallback(async () => {
        const result = await remote.grokSearchSettings.snapshot();
        if (!result || result.ok !== true) throw new Error(result?.error?.message ?? 'snapshot unavailable');
        setState({ status: 'ready', value: result.value });
      }, [remote]);
      react.useEffect(() => { refresh().catch(error => {
        console.error('[dsh-grok-search] settings snapshot failed:', error);
        setState({ status: 'error' });
      }); }, [refresh]);
      const stop = async () => {
        setState(current => ({ ...current, stopping: true }));
        try {
          const result = await remote.grokSearchSettings.stop();
          if (!result || result.ok !== true) {
            const failure = new Error(result?.error?.message ?? 'stop unavailable');
            failure.code = result?.error?.code ?? 'CONTROL_STOP_UNAVAILABLE';
            throw failure;
          }
          setState({ status: 'ready', value: result.value.snapshot, outcome: result.value.outcome });
        } catch (error) {
          let latestSnapshot = null;
          try {
            const latest = await remote.grokSearchSettings.snapshot();
            if (latest?.ok === true) latestSnapshot = latest.value;
          } catch {}
          setState(current => mergeStopFailure(current, error, latestSnapshot));
        }
      };
      if (state.status === 'loading') return jsx('div', { className: 'grokSearchSettings',
        'data-grok-search-loading': true, children: jsx('p', { children: t('phase') }) });
      if (state.status === 'error') return jsx('div', { className: 'grokSearchSettings',
        'data-grok-search-error': true, children: [
        jsx('p', { className: 'error', children: t('failed') }),
        jsx('button', { type: 'button', onClick: () => { setState({ status: 'loading' }); refresh().catch(() => setState({ status: 'error' })); }, children: t('retry') }),
      ] });
      const value = state.value;
      const phase = t(phaseLabelKey(value));
      return jsxs('section', { className: 'grokSearchSettings', 'data-grok-search-settings': true, children: [
        jsx('h2', { children: t('title') }),
        jsx('p', { children: t('description') }),
        jsxs('div', { className: 'status', children: [
          jsx('strong', { children: t('phase') }),
          jsx('p', { children: phase }),
          value.routeVerified ? jsx('p', { children: t('verified') }) : null,
          value.error ? jsx('p', { className: 'error', role: 'alert', children: `${value.error.code}: ${value.error.message}` }) : null,
        ] }),
        jsx('button', { type: 'button', disabled: !value.canStop || state.stopping === true,
          onClick: stop, children: state.stopping ? t('stopping') : t('stop') }),
        jsx('p', { children: t('restart') }),
        state.error ? jsx('p', { className: 'error', role: 'alert', children: state.error }) : null,
      ] });
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'grok-search-settings: locale');
      const t = ctx.locale.bind(NS);
      const jsonSchemas = clientSchemas();
      const clientCodecs = {
        snapshot: {
          mode: 'strict', typeSymbol: 'dsh-grok-search/settings#GrokSearchSettingsSnapshot',
          create: () => ({ safeParse: value => ({ success: true, value }) }),
          get jsonSchema() { return structuredClone(jsonSchemas.snapshot); },
        },
        stop: {
          mode: 'strict', typeSymbol: 'dsh-grok-search/settings#GrokSearchSettingsStopResult',
          create: () => ({ safeParse: value => ({ success: true, value }) }),
          get jsonSchema() { return structuredClone(jsonSchemas.stop); },
        },
      };
      const descriptors = ['snapshot', 'stop'].map(method => ({
        id: `dsh-grok-search#grokSearchSettings/${method}`,
        service: 'grokSearchSettings', namespace: 'grokSearchSettings', method,
        description: method === 'snapshot'
          ? 'Read the current product control state for the plugin settings page.'
          : 'Explicitly stop search takeover and return the recorded author route.',
        invocation: { kind: 'direct' }, parameters: [], result: clientCodecs[method],
      }));
      const mounted = ctx.remote.$mount({ package: 'dsh-grok-search', descriptors });
      ctx.effect(() => async () => {
        const disposable = await mounted.catch(() => null);
        await disposable?.();
      }, 'grok-search-settings: remote contribution');
      ctx.effect(() => ctx.inject(['remote.grokSearchSettings'], (settingsCtx) => {
        settingsCtx.slots.inject('settings.plugins.tab', () => settingsCtx.slots.register({
          name: 'settings.plugins.tab', id: 'grok-search', order: 30,
          label: () => t('tab'), locale: NS,
          inject: () => ({ t, remote: settingsCtx.remote }),
        }, GrokSearchSettings));
      }), 'grok-search-settings: tab after namespace mount');
    }
    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    exports.__test = Object.freeze({ phaseLabelKey, mergeStopFailure, schemas: clientSchemas });
    return module.exports;
  },
});
