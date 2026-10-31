import { existsSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, freshRun, writeJson, commandResult, receipt, npmCli, sha256, redact } from './lib/internal-candidate-utils.mjs';

export async function packInternal(directory, { beta = false } = {}) {
  const expectedVersion = beta ? '0.1.0-beta.1' : '0.0.0-internal.1';
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  if ((beta ? manifest.private === true : !manifest.private) || manifest.version !== expectedVersion) throw new Error('打包版本或 private 状态不符合通道要求。');
  for (const file of ['support-matrix.json', 'README.md', 'src/index.mjs', 'cordis.patch.yml', 'LICENSE']) {
    if (!existsSync(join(project, file))) throw new Error('打包前缺少文件：' + file);
  }
  const record = await commandResult(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory], {
    cwd: project, timeoutMs: 60_000, sanitize: value => redact(value),
  });
  writeJson(join(directory, 'pack-execution.json'), receipt(record));
  if (record.exitCode !== 0 || record.timedOut) throw new Error('内部打包失败；见 pack-execution.json。');
  const output = JSON.parse(record.rawStdout);
  const metadata = Array.isArray(output) ? output[0] : Object.values(output).find(value => value?.filename);
  if (!metadata?.filename || basename(metadata.filename) !== metadata.filename) throw new Error('打包输出缺少安全文件名。');
  const allowed = path => ['package.json', 'README.md', 'cordis.patch.yml', 'support-matrix.json', 'LICENSE', 'src/bundle.mjs', 'src/program.mjs', 'src/index.mjs', 'src/provider.mjs', 'src/control.mjs', 'src/recovery.mjs', 'src/route-verifier.mjs', 'src/settings-ui.mjs', 'src/typert.host.mjs', 'src/client.js'].includes(path)
    || /^src\/core\/[a-z-]+\.mjs$/.test(path);
  const unexpected = metadata.files.filter(file => !allowed(file.path));
  if (unexpected.length) throw new Error('打包白名单失效：' + unexpected.map(file => file.path).join(', '));
  for (const expected of ['package.json', 'README.md', 'cordis.patch.yml', 'support-matrix.json', 'LICENSE', 'src/bundle.mjs', 'src/program.mjs', 'src/index.mjs', 'src/provider.mjs', 'src/control.mjs', 'src/recovery.mjs', 'src/route-verifier.mjs', 'src/settings-ui.mjs', 'src/typert.host.mjs', 'src/client.js', 'src/core/release-transaction.mjs']) {
    if (!metadata.files.some(file => file.path === expected)) throw new Error('压缩包遗漏文件：' + expected);
  }
  const readme = readFileSync(join(project, 'README.md'), 'utf8');
  for (const match of readme.matchAll(/\]\(\.\/([^)#]+)(?:#[^)]*)?\)/g)) {
    if (!metadata.files.some(file => file.path === match[1])) throw new Error('压缩包内 README 链接缺少目标：' + match[1]);
  }
  const tarball = join(directory, metadata.filename);
  const packageReceipt = { name: metadata.name, version: metadata.version, filename: metadata.filename,
    sha256: sha256(tarball), integrity: metadata.integrity, files: metadata.files, whiteListPassed: true,
    sourceHashes: metadata.files.map(({ path }) => ({ file: path, sha256: sha256(join(project, path)) })),
    releaseChannel: beta ? 'beta' : 'internal', publicReleaseApproved: false, verification: '宿主结果另见本运行目录的 summary.json。' };
  writeJson(join(directory, 'package-receipt.json'), packageReceipt);
  return { tarball, packageReceipt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--beta')) throw new Error('pack:internal 只接受可选 --beta。');
  const beta = args[0] === '--beta';
  const { directory, runId } = freshRun(beta ? 'beta-package' : 'internal-package');
  const { packageReceipt } = await packInternal(directory, { beta });
  console.log(JSON.stringify({ runId, directory: redact(directory), ...packageReceipt }, null, 2));
}
