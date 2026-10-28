import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';
import { createSearchExecutor } from './core/search-executor.mjs';
import { GrokSearchError } from './core/errors.mjs';

export const PROVIDER_ID = 'grok-search';

// 本轮只实现查询核心；自动接管、临时字段所有权及持久恢复由控制层验收。
export function createGrokProvider({ configuration, sdkFactory, runQuery } = {}) {
  if (!configuration || typeof configuration !== 'object') throw new TypeError('需要查询配置。');
  const budgetMs = configuration.budgetMs ?? 120_000;
  let executableReady = false;
  try { executableReady = typeof configuration.executable === 'string' && isAbsolute(configuration.executable) && statSync(configuration.executable).isFile(); }
  catch { executableReady = false; }
  const executor = createSearchExecutor({
    budgetMs,
    ...(runQuery ? { runQuery } : {}),
    snapshot: () => {
      if (!executableReady) throw new GrokSearchError('GROK_PROGRAM_MISSING', 'Grok 程序不存在，请在插件设置中指定已有程序的绝对路径。');
      if (configuration.configPath && !isAbsolute(configuration.configPath)) throw new GrokSearchError('GROK_CONFIG_INVALID', 'Grok 配置文件必须使用绝对路径。');
      return { executable: configuration.executable, executableArgs: [...(configuration.executableArgs ?? [])],
        ...(configuration.configPath ? { configPath: configuration.configPath } : {}),
        ...(sdkFactory ? { sdkFactory } : {}) };
    },
  });
  return {
    provider: { id: PROVIDER_ID, available: () => executableReady && executor.snapshot().accepting,
      search: (request, signal) => executor.search(request, signal) },
    snapshot: () => ({ ...executor.snapshot(), executableReady }),
    dispose: () => executor.dispose(),
  };
}
