import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANDIDATE_VERSIONS } from '../scripts/lib/candidate-runtime.mjs';

const readJson = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const versions = ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5'];

test('rc.5 兼容补丁同步版本、宿主声明与锁文件，不放宽到未来版本', () => {
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json');
  const matrix = readJson('support-matrix.json');
  assert.equal(manifest.version, '0.1.1');
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(matrix.packageVersion, manifest.version);
  assert.equal(manifest.engines.dsh, versions.join(' || '));
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  assert.deepEqual(lock.packages[''].peerDependencies, manifest.peerDependencies);
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-web', '@deepseek-ai/dsh-typert-protocol']) {
    assert.equal(manifest.peerDependencies[name], manifest.engines.dsh);
  }
  assert.deepEqual(manifest.dependencies, { '@modelcontextprotocol/client': '2.4.0', 'smol-toml': '1.9.1' });
});

test('支持矩阵保留旧组合，只增加 rc.5 三组合，不把 Windows/macOS Web 或 rc.4 Desktop 写成通过', () => {
  const matrix = readJson('support-matrix.json');
  const targets = matrix.targets.map(row => `${row.platform}/${row.host}/${row.dsh}`).sort();
  const expected = [
    ...['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5'].flatMap(version =>
      ['win32-x64', 'darwin-arm64'].map(platform => `${platform}/Desktop/${version}`)),
    ...versions.map(version => `linux-x64/CLI/Web/${version}`),
  ].sort();
  assert.deepEqual(targets, expected);
  assert.equal(new Set(targets).size, expected.length);
  assert(matrix.unsupported.some(value => value.includes('Windows 与 macOS') && value.includes('CLI/Web')));
  assert(matrix.notTested.some(value => value.includes('rc.4') && value.includes('Desktop')));
});

test('Desktop 候选工具接受 rc.5 但保留历史边界，不能以 alpha 或未来 rc 替代实测', () => {
  assert(CANDIDATE_VERSIONS.includes('0.2.1-rc.5'));
  assert(CANDIDATE_VERSIONS.includes('0.2.1-rc.2'));
  assert(CANDIDATE_VERSIONS.includes('0.2.1-rc.3'));
  assert(!CANDIDATE_VERSIONS.includes('0.2.2-alpha.2'));
  assert(!CANDIDATE_VERSIONS.includes('0.2.1-rc.6'));
});
