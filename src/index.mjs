import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { WebError } from '@deepseek-ai/dsh-web';
import { createGrokProvider } from './provider.mjs';
import { createReleaseBarrier } from './core/release-transaction.mjs';
import { GrokSearchError } from './core/errors.mjs';

export const name = 'dsh-grok-search';
export const inject = ['web'];
export const Config = z.object({
  executable: z.string().default('').description('已有 grok-search-rs 程序的绝对路径。'),
  executableArgs: z.array(z.string()).default([]).description('程序启动参数；内部离线验证也使用此字段。'),
  configPath: z.string().default('').description('已有 Grok 配置文件的绝对路径；留空时由 Grok 按自身规则读取。'),
  budgetMs: z.number().min(30_000).max(120_000).default(120_000).description('单次查询总预算，单位毫秒，包含排队与本地回收。'),
});

export function apply(ctx, config) {
  const core = createGrokProvider({ configuration: config });
  const releaseBarrier = createReleaseBarrier();
  const provider = {
    ...core.provider,
    available: () => releaseBarrier.snapshot().state === 'active' && core.provider.available(),
    async search(request, signal) {
      const operationId = randomUUID();
      releaseBarrier.begin({ operationId });
      try { return await core.provider.search(request, signal); }
      finally { releaseBarrier.settle({ operationId }); }
    },
  };
  // 注册和回收均属于当前插件 fiber，没有借根上下文遗留效果。
  ctx.effect(() => () => core.dispose());
  ctx.provide('grokSearchCore', {
    snapshot: core.snapshot,
    dispose: () => core.dispose(),
    releaseBarrier,
  });
  ctx.web.registerSearchProvider({
    ...provider,
    async search(request, signal) {
      try { return await provider.search(request, signal); }
      catch (error) {
        if (signal?.aborted && error === signal.reason) throw error;
        if (error instanceof GrokSearchError) throw new WebError(error.message, error.code);
        throw new WebError('Grok 查询失败，请检查程序和配置。', 'GROK_SEARCH_FAILED');
      }
    },
  });
  if (!core.snapshot().executableReady) ctx.logger.warn('Grok 程序尚未配置；本插件不会自动切换搜索来源。');
}
