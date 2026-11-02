import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANDIDATE_VERSIONS } from '../scripts/lib/candidate-runtime.mjs';
import * as desktopPreparation from '../scripts/deferred-release-desktop-prepare.mjs';

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

test('支持矩阵覆盖 rc.2 至 rc.5 的十二个明确组合，不扩张 Windows/macOS 独立 Web', () => {
  const matrix = readJson('support-matrix.json');
  const targets = matrix.targets.map(row => `${row.platform}/${row.host}/${row.dsh}`).sort();
  const expected = [
    ...versions.flatMap(version =>
      ['win32-x64', 'darwin-arm64'].map(platform => `${platform}/Desktop/${version}`)),
    ...versions.map(version => `linux-x64/CLI/Web/${version}`),
  ].sort();
  assert.deepEqual(targets, expected);
  assert.equal(new Set(targets).size, expected.length);
  assert(matrix.unsupported.some(value => value.includes('Windows 与 macOS') && value.includes('CLI/Web')));
  assert(matrix.notTested.some(value => value.includes('rc.4') && value.includes('Desktop')));
});

test('rc.4 Desktop 属于源码审查支持，不得冒充官方 Desktop 原包实测', () => {
  const matrix = readJson('support-matrix.json');
  assert.deepEqual(Object.keys(matrix.verificationLevels ?? {}).sort(), ['host-tested', 'source-reviewed']);
  for (const row of matrix.targets) {
    assert(Object.hasOwn(matrix.verificationLevels, row.verificationLevel));
  }
  const inferred = matrix.targets.filter(row => row.verificationLevel === 'source-reviewed');
  assert.deepEqual(inferred.map(row => `${row.platform}/${row.host}/${row.dsh}`).sort(), [
    'darwin-arm64/Desktop/0.2.1-rc.4', 'win32-x64/Desktop/0.2.1-rc.4',
  ]);
  assert.equal(matrix.targets.filter(row => row.verificationLevel === 'host-tested').length, 10);
  for (const row of inferred) {
    assert.match(row.verification, /源码/);
    assert.match(row.verification, /未.*实测/);
    assert.doesNotMatch(row.verification, /自动化测试通过/);
  }
});

test('Desktop 候选工具接受 rc.5 但保留历史边界，不能以 alpha 或未来 rc 替代实测', () => {
  assert(CANDIDATE_VERSIONS.includes('0.2.1-rc.5'));
  assert(CANDIDATE_VERSIONS.includes('0.2.1-rc.2'));
  assert(CANDIDATE_VERSIONS.includes('0.2.1-rc.3'));
  assert(!CANDIDATE_VERSIONS.includes('0.2.2-alpha.2'));
  assert(!CANDIDATE_VERSIONS.includes('0.2.1-rc.6'));
});

test('隔离测试 bundle 使用被核验的真实宿主版本，不能因旧版硬编码被 rc.5 跳过', () => {
  assert.equal(typeof desktopPreparation.fixtureDshEngines, 'function');
  for (const version of CANDIDATE_VERSIONS) {
    assert.deepEqual(desktopPreparation.fixtureDshEngines(version), { dsh: version });
  }
  for (const version of ['', '0.2.1-rc.6', '0.2.2-alpha.2', '*']) {
    assert.throws(() => desktopPreparation.fixtureDshEngines(version));
  }
});
