import { mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, existsSync, lstatSync, realpathSync, constants } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { candidateRuntime } from './lib/candidate-runtime.mjs';

// 只检查官方程序的 fuse 字节，不修改二进制或放宽运行策略。
export function readElectronFuseWire(binary) {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const offset = binary.indexOf(sentinel);
  if (offset < 0 || binary.indexOf(sentinel, offset + 1) !== -1) throw new Error('Electron fuse sentinel is absent or ambiguous.');
  const header = offset + sentinel.length;
  const version = binary[header], length = binary[header + 1];
  if (version !== 1 || !Number.isInteger(length) || length < 6 || header + 2 + length > binary.length) {
    throw new Error('Unsupported or truncated Electron fuse wire.');
  }
  const states = binary.subarray(header + 2, header + 2 + length);
  if ([...states].some(value => ![0x30, 0x31, 0x72].includes(value))) throw new Error('Invalid Electron fuse state.');
  return { version, length, offset, wire: states.toString('ascii'),
    runAsNode: states[0] === 0x31, nodeCliInspect: states[3] === 0x31,
    embeddedAsarIntegrityValidation: states[4] !== 0x30, onlyLoadAppFromAsar: states[5] !== 0x30 };
}

export function assertDevelopmentFuseCompatibility(fuses) {
  if (!fuses.runAsNode || !fuses.nodeCliInspect || fuses.onlyLoadAppFromAsar || fuses.embeddedAsarIntegrityValidation) {
    throw new Error('Official Electron fuses do not permit this isolated development fixture.');
  }
}

export function resolveNewTemporaryRunRoot(runRoot) {
  if (typeof runRoot !== 'string' || !isAbsolute(runRoot)) throw new Error('An absolute temporary --run-root is required.');
  const temporaryAlias = resolve(tmpdir()), temporary = realpathSync(temporaryAlias);
  const providedRoot = resolve(runRoot);
  const aliasRelative = relative(temporaryAlias, providedRoot);
  const underAlias = aliasRelative && aliasRelative !== '..'
    && !aliasRelative.startsWith('..' + sep) && !isAbsolute(aliasRelative);
  // macOS commonly exposes /var as the system alias of /private/var.
  // Resolve only that known tmpdir prefix; links below the run root remain forbidden.
  const root = underAlias ? join(temporary, aliasRelative) : providedRoot;
  const inside = relative(temporary, root);
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)
    || !inside.split(sep)[0].startsWith('dsh-deferred-desktop-')) {
    throw new Error('Desktop fixture root must stay inside a dedicated temporary namespace.');
  }
  let current = temporary;
  for (const part of inside.split(sep)) {
    current = join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink() || (entry && !entry.isDirectory())) throw new Error('Desktop fixture root contains a link or non-directory.');
  }
  if (lstatSync(root, { throwIfNoEntry: false })) throw new Error('A new independent --run-root is required.');
  return root;
}

export function inspectDesktopPreparation(desktopExecutable, runRoot) {
  const root = resolveNewTemporaryRunRoot(runRoot);
  const desktop = candidateRuntime(desktopExecutable);
  const source = desktop.binaryDir;
  const pnpmEntry = join(desktop.resourcesDir, desktop.app.version === '0.2.0-rc.2'
    ? 'runtime/pnpm/bin/pnpm.mjs'
    : 'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs');
  if (!existsSync(pnpmEntry)) throw new Error('The matching Desktop pnpm resource is missing.');
  const fuses = readElectronFuseWire(readFileSync(desktop.fuseBinary));
  assertDevelopmentFuseCompatibility(fuses);
  return { root, desktop, source, resourcesDir: desktop.resourcesDir, pnpmEntry, fuses };
}

export function prepareDesktopFixture(desktopExecutable, runRoot, { versionedControlRecord = false, productEntries = false,
  pluginManagerEntries = false, m004 = false, m004BudgetMs = 120000 } = {}) {
  const { root, desktop, source, resourcesDir, pnpmEntry, fuses } = inspectDesktopPreparation(desktopExecutable, runRoot);
  const actualProject = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const profile = join(root, 'dsh-home', 'profiles', 'desktop');
  const hashFile = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const identities = [];
  let electronRoot, resources, electron;
  if (process.platform === 'darwin') {
    if (pluginManagerEntries) {
      electronRoot = dirname(desktop.executable);
      resources = resourcesDir;
      electron = desktop.executable;
    } else {
      const appRoot = resolve(dirname(desktop.executable), '..', '..');
      electronRoot = join(root, 'DeepSeek Harness.app');
      const packagedArchive = join(resourcesDir, 'app.asar');
      cpSync(appRoot, electronRoot, {
        recursive: true, errorOnExist: true, force: false, preserveTimestamps: true,
        // Like the Windows fixture, use the shipped default_app runtime with the
        // original archive passed as argv. Never delete or rewrite an ASAR or re-sign code.
        filter: path => resolve(path) !== resolve(packagedArchive),
      });
      resources = join(electronRoot, 'Contents', 'Resources');
      electron = join(electronRoot, 'Contents', 'MacOS', 'DeepSeek Harness');
      const sourceDefault = join(resourcesDir, 'default_app.asar');
      if (!existsSync(sourceDefault)) throw new Error('The mac default_app.asar is missing.');
      for (const [name, original, destination] of [['DeepSeek Harness', desktop.executable, electron],
        ['default_app.asar', sourceDefault, join(resources, 'default_app.asar')]]) {
        const sha256 = hashFile(original);
        if (hashFile(destination) !== sha256) throw new Error('Official mac app copy identity mismatch.');
        identities.push({ name, sha256 });
      }
    }
  } else {
    electronRoot = join(root, 'electron');
    mkdirSync(electronRoot, { recursive: true });
    resources = join(electronRoot, 'resources');
    mkdirSync(resources);
    const fileNames = ['DeepSeek Harness.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
      'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'resources.pak',
      'snapshot_blob.bin', 'v8_context_snapshot.bin', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'];
    for (const name of fileNames) {
      const original = join(source, name), destination = join(electronRoot, name === 'DeepSeek Harness.exe' ? 'electron.exe' : name);
      copyFileSync(original, destination, constants.COPYFILE_EXCL);
      const sha256 = hashFile(original);
      if (hashFile(destination) !== sha256) throw new Error('Official binary copy identity mismatch.');
      identities.push({ name, sha256 });
    }
    cpSync(join(source, 'locales'), join(electronRoot, 'locales'), { recursive: true, errorOnExist: true, force: false });
    for (const name of ['default_app.asar', 'icon.png', 'tray.ico']) {
      copyFileSync(join(resourcesDir, name), join(resources, name), constants.COPYFILE_EXCL);
      const sha256 = hashFile(join(resourcesDir, name));
      if (hashFile(join(resources, name)) !== sha256) throw new Error('Official resource copy identity mismatch.');
      identities.push({ name: 'resources/' + name, sha256 });
    }
    electron = join(electronRoot, 'electron.exe');
  }
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  const createBundle = (name, exports, patch) => {
    const path = join(profile, 'node_modules', name); mkdirSync(path);
    write(join(path, 'package.json'), { name, version: '0.0.0', private: true, type: 'module',
      exports: { './package.json': './package.json', './cordis.patch.yml': './cordis.patch.yml', ...exports },
      engines: { dsh: '0.2.1-rc.2 || 0.2.1-rc.3' }, dsh: { bundle: { patch: './cordis.patch.yml' } } });
    write(join(path, 'cordis.patch.yml'), patch); return path;
  };
  const fixture = createBundle('candidate-offline-fixture', { '.': './desktop-fixture.mjs' }, [{ insert: [
    { id: 'fixture-desktop', name: 'candidate-offline-fixture' },
  ] }, { id: 'agent-default-model', config: { provider: 'candidate-offline', model: 'fixture-native' } },
  { id: 'web', config: { searchProvider: 'candidate-original', fetchProvider: 'candidate-fetch' }, inject: { candidateExistingDependency: { probe: 'retain-existing' } } },
  { id: 'web-search-deepseek', disabled: true }, { id: 'web-fetch-http', disabled: true },
  { id: 'llm-deepseek-account', disabled: true }, { id: 'llm-deepseek', config: { apiKeyEnv: 'DSH_DESKTOP_OFFLINE_SENTINEL' } },
  { id: 'desktop-product-telemetry', disabled: true }, { id: 'product-analytics', config: { enabled: false } },
  { id: 'agent-preset-registry', config: { default: 'desktop-fixture' } },
  { insert: [{ id: 'preset-desktop-fixture', name: '@deepseek-ai/dsh-agent-preset', config: {
    id: 'desktop-fixture', title: '离线桌面控制验收', plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '离线桌面控制验收', complete: true, includeRuntimeContext: false } },
      { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: m004 ? m004BudgetMs : 30000, fetchTimeoutMs: 30000 } },
    ],
  } }] }]);
  const copyCore = destination => {
    mkdirSync(destination, { recursive: true });
    for (const module of ['control-intent-store.mjs', 'startup-recovery.mjs', 'release-transaction.mjs', 'product-control.mjs', 'original-search-counter.mjs', 'errors.mjs', 'mcp-search.mjs', 'result-map.mjs', 'search-executor.mjs']) {
      copyFileSync(join(actualProject, 'src/core', module), join(destination, module), constants.COPYFILE_EXCL);
    }
  };
  copyCore(fixture);
  write(join(fixture, 'desktop-fixture.mjs'), readFileSync(join(actualProject, 'fixtures/deferred-release/desktop-fixture.mjs'), 'utf8')
    .replaceAll('../../src/core/', './'));
  copyFileSync(join(actualProject, 'fixtures/internal-candidate/host-fixture.mjs'), join(fixture, 'host-fixture.mjs'));
  if (productEntries) {
    const product = createBundle('dsh-grok-search', {
      '.': './index.mjs',
      './control': './control.mjs',
      './recovery': './recovery.mjs',
      './route-verifier': './route-verifier.mjs',
      './control-intent': './core/control-intent-store.mjs',
      './startup-recovery': './core/startup-recovery.mjs',
    }, [{ insert: [
      { id: 'grok-search-core', name: 'dsh-grok-search', ...(m004 ? { config: {
        executable: process.execPath,
        executableArgs: [join(actualProject, 'fixtures/mcp/grok-server.mjs'), 'structured'],
        budgetMs: m004BudgetMs,
      } } : {}) },
      { id: 'grok-search-control', name: 'dsh-grok-search/control' },
      { id: 'grok-search-route-verifier', name: 'dsh-grok-search/route-verifier' },
      { id: 'grok-search-recovery', name: 'dsh-grok-search/recovery' },
    ] }]);
    for (const file of ['index.mjs', 'provider.mjs', 'control.mjs', 'recovery.mjs', 'route-verifier.mjs']) {
      copyFileSync(join(actualProject, 'src', file), join(product, file), constants.COPYFILE_EXCL);
    }
    copyCore(join(product, 'core'));
    write(join(profile, 'package.json'), { name: 'isolated-desktop-profile', private: true, type: 'module', dependencies: {
      'candidate-offline-fixture': '0.0.0', 'dsh-grok-search': '0.0.0',
    }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
      'candidate-offline-fixture', 'dsh-grok-search'] } } });
  } else if (pluginManagerEntries) {
    const fixtureDependency = join(root, 'fixture-package');
    cpSync(fixture, fixtureDependency, { recursive: true, errorOnExist: true, force: false });
    write(join(profile, 'package.json'), { name: 'isolated-desktop-profile', version: '0.0.0', private: true, type: 'module',
      dependencies: { 'candidate-offline-fixture': 'file:../../../fixture-package' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'candidate-offline-fixture'] } } });
    write(join(profile, '.npmrc'), 'auto-install-peers=false\nstrict-peer-dependencies=false\n');
    write(join(profile, 'cordis.patch.yml'), '- id: hmr\n  disabled: true\n');
  } else {
  for (const [name, parts] of [['candidate-controlled-search', [['owner', 'applyOwner', ['loader', 'profileContext']], ['provider', 'applyProvider', ['web', 'candidateControlOwner']]]],
   ['candidate-search-recovery', [['recovery', 'applyRecovery', ['loader', 'profileContext']]]]]) {
    const exports = Object.fromEntries(parts.map(([label]) => ['./' + label, './' + label + '.mjs']));
    const bundle = createBundle(name, exports, [{ insert: parts.map(([label]) => ({ id: 'control-' + label, name: name + '/' + label })) }]);
    copyCore(bundle);
    write(join(bundle, 'control.mjs'), readFileSync(join(actualProject, 'fixtures/deferred-release/control.mjs'), 'utf8')
      .replaceAll('../../src/core/', './'));
    for (const [label, apply, inject] of parts) write(join(bundle, label + '.mjs'), `export { ${apply} as apply } from './control.mjs'; export const name='desktop-control-${label}'; export const inject=${JSON.stringify(inject)};\n`);
  }
  write(join(profile, 'package.json'), { name: 'isolated-desktop-profile', private: true, type: 'module', dependencies: {
    'candidate-offline-fixture': '0.0.0', 'candidate-controlled-search': '0.0.0', 'candidate-search-recovery': '0.0.0',
  }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
    'candidate-offline-fixture', 'candidate-controlled-search', 'candidate-search-recovery'] } } });
  }
  if (!pluginManagerEntries) write(join(profile, 'cordis.patch.yml'), '[]\n');
  mkdirSync(join(root, 'workspace'));
  const paths = { versionedControlRecord, root, electron, archive: desktop.archivePath,
    dshHome: join(root, 'dsh-home'), profile, userData: join(root, 'electron-data'),
    runtime: join(desktop.archivePath, 'dsh'), primaryRuntime: join(resourcesDir, 'runtime', 'primary-runtime'),
    pnpmEntry, token: randomUUID(), workspace: join(root, 'workspace') };
  write(join(root, 'local-control.json'), paths);
  write(join(root, 'preparation.json'), { version: desktop.app.version, binaryCopies: identities,
    appArchiveSha256: hashFile(desktop.archivePath), originalSourceUnchanged: true,
    startupMode: process.platform === 'darwin' ? (pluginManagerEntries ? 'official-packaged-mac-app' : 'official-mac-app-copy-default-app-development-load-original-asar')
      : 'official-default-app-development-load-original-asar', packagedStartupValidated: false,
    dependenciesInstalled: false, profile: '<temporary-profile>', privateCapabilityExcluded: true, fuses });
  return { version: desktop.app.version, root: '<independent-temporary-run>', binaryCopies: identities.length,
    originalAsarUnmodified: true, startupMode: process.platform === 'darwin' ? (pluginManagerEntries ? 'packaged-app' : 'mac-development') : 'development', dependencyInstall: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!['--desktop', '--run-root', '--control-record-mode', '--entry-mode', '--m004-budget'].includes(process.argv[i]) || !process.argv[i + 1]
      || options.has(process.argv[i].slice(2))) throw new Error('Expected unique named preparation arguments.');
    options.set(process.argv[i].slice(2), process.argv[i + 1]);
  }
  const mode = options.get('control-record-mode') ?? 'legacy';
  if (!['legacy', 'versioned'].includes(mode)) throw new Error('Expected legacy or versioned control record mode.');
  const entryMode = options.get('entry-mode') ?? 'fixture';
  const m004BudgetMs = Number(options.get('m004-budget') ?? 120000);
  if (![60000, 90000, 120000].includes(m004BudgetMs)) throw new Error('M0-04 budget must be 60000, 90000 or 120000 ms.');
  if (!['fixture', 'product', 'plugin-manager', 'm0-04'].includes(entryMode)) throw new Error('Expected fixture, product, plugin-manager or m0-04 entry mode.');
  console.log(JSON.stringify(prepareDesktopFixture(options.get('desktop'), options.get('run-root'), {
    versionedControlRecord: mode === 'versioned', productEntries: entryMode === 'product' || entryMode === 'm0-04',
    pluginManagerEntries: entryMode === 'plugin-manager', m004: entryMode === 'm0-04', m004BudgetMs,
  })));
}
