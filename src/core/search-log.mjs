import { GrokSearchError } from './errors.mjs';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PROVIDERS = new Set(['grok', 'grok-sources', 'tavily', 'exa', 'tinyfish', 'firecrawl']);
const safeCode = code => typeof code === 'string' && /^[\w.-]{1,64}$/.test(code) ? code : '';

/** Volatile, opt-in-by-open-page history. No filesystem, URLs, credentials or response bodies. */
export function createSearchLog({ now = Date.now, ttlMs = 30_000, capacity = 20 } = {}) {
  const sessions = new Map();
  const closed = new Set();
  const truncatedCalls = new WeakSet();
  let sequence = 0, disposed = false, expiryTimer = null;
  const scheduleExpiry = () => {
    clearTimeout(expiryTimer);
    if (disposed || sessions.size === 0) return;
    const nearest = Math.min(...[...sessions.values()].map(session => session.expires));
    expiryTimer = setTimeout(() => { prune(); scheduleExpiry(); }, Math.max(1, nearest - now()));
    expiryTimer.unref?.();
  };
  const prune = () => {
    for (const [id, session] of sessions) if (session.expires <= now()) sessions.delete(id);
  };
  const validate = id => {
    if (typeof id !== 'string' || !ID.test(id)) throw new GrokSearchError('SEARCH_LOG_SESSION_INVALID', '日志会话无效，请重新打开设置页。');
  };
  const snapshot = id => {
    validate(id); prune();
    if (disposed || closed.has(id)) return { records: [] };
    let session = sessions.get(id);
    if (!session) {
      if (sessions.size >= 8) throw new GrokSearchError('SEARCH_LOG_BUSY', '打开的日志页面过多，请关闭其他页面。');
      session = { expires: now() + ttlMs, rows: [] };
      sessions.set(id, session);
    }
    session.expires = now() + ttlMs;
    scheduleExpiry();
    return { records: structuredClone(session.rows) };
  };
  const begin = query => {
    prune();
    if (disposed || sessions.size === 0) return null;
    const at = now(), id = `search-log-${++sequence}`;
    const row = { id, at, q: String(query ?? '').slice(0, 5000), kind: 'running',
      served: null, ms: null, official: null, reason: '', detail: '', calls: [], callsComplete: false };
    for (const session of sessions.values()) {
      session.rows.unshift(structuredClone(row)); session.rows.length = Math.min(capacity, session.rows.length);
    }
    return { id, at };
  };
  const update = (token, work) => {
    if (!token || disposed) return;
    prune();
    for (const session of sessions.values()) {
      const row = session.rows.find(item => item.id === token.id);
      if (row?.kind === 'running') work(row);
    }
  };
  const call = (token, input) => update(token, row => {
    if (!PROVIDERS.has(input?.provider)) return;
    if (row.calls.length >= 16) { truncatedCalls.add(row); return; }
    const charge = input.charge;
    const amount = typeof charge?.amount === 'number' && Number.isFinite(charge.amount)
      && charge.amount >= 0 && charge.amount <= 1e9 ? charge.amount : null;
    const unit = ['credits', 'USD'].includes(charge?.unit) ? charge.unit : null;
    row.calls.push({ provider: input.provider, operation: input.operation === 'retry' ? 'retry' : 'search',
      result: ['ok', 'failed', 'cancelled'].includes(input.result) ? input.result : 'unknown',
      code: safeCode(input.code), keyIndex: Number.isSafeInteger(input.keyIndex) && input.keyIndex >= 0 && input.keyIndex < 100 ? input.keyIndex : null,
      charge: amount !== null && unit && ['reported', 'estimated'].includes(charge?.basis)
        ? { amount, unit, basis: charge.basis } : { amount: null, unit: null, basis: 'unknown' } });
  });
  const finish = (token, route = {}) => update(token, row => {
    row.ms = Math.max(0, now() - token.at);
    row.served = PROVIDERS.has(route.served) ? route.served : null;
    row.kind = route.cancelled ? 'cancelled' : route.outcome !== 'ok' ? 'failed'
      : route.grokCode === 'DISABLED' ? 'sources' : route.fallbackUsed ? 'fallback' : 'ok';
    row.reason = safeCode(route.code || (route.grokCode === 'DISABLED' ? '' : route.grokCode));
    // Only the sources-only adapter path reports every dispatched call.
    row.callsComplete = route.callsComplete === true && !truncatedCalls.has(row);
  });
  return Object.freeze({
    snapshot, begin, call, finish,
    clear(id) { validate(id); prune(); const session = sessions.get(id); if (session) session.rows = []; return { records: [] }; },
    close(id) {
      validate(id); sessions.delete(id); closed.add(id);
      while (closed.size > 64) closed.delete(closed.values().next().value);
      scheduleExpiry(); return { closed: true };
    },
    dispose() { disposed = true; sessions.clear(); closed.clear(); clearTimeout(expiryTimer); },
  });
}
