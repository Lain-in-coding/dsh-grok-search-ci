export class GrokSearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GrokSearchError';
    this.code = code;
  }
}

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function timeoutError() {
  return new GrokSearchError('GROK_TIMEOUT', '搜索已超出工作预算，请缩短查询或检查上游。');
}
