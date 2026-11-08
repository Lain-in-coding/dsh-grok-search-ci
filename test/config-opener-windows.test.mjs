import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createConfigLocationOpener } from '../src/core/config-opener.mjs';

// Execute the production PowerShell decision tree. Only OS discovery, process
// creation and profile lookup are replaced; these tests never open an editor.
async function productionPlan() {
  let plan;
  const opener = createConfigLocationOpener({ platform: 'win32', env: { SystemRoot: process.env.SystemRoot },
    stat: () => ({ isFile: () => true, isDirectory: () => false }),
    spawnImpl(command, args, options) {
      plan = { command, script: args.at(-1), options };
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => { child.stdout.write('DSH_GROK_OPEN_OK'); child.emit('close', 0, null); });
      return child;
    } });
  await opener.open({ path: 'C:\\synthetic\\config.toml', kind: 'file' });
  return plan;
}
const boundary = 'try {\n  Restore-DesktopUserProfile\n';
const discovery = String.raw`
function Get-AppxPackage {
  [CmdletBinding()] param([string]$Name)
  if ($Name -ne 'Microsoft.WindowsNotepad') { throw 'Unexpected package query' }
  [pscustomobject]@{ PackageFamilyName='Microsoft.WindowsNotepad_8wekyb3d8bbwe';
    PackageFullName='synthetic-package'; InstallLocation=$env:DSH_TEST_PACKAGE_ROOT;
    Status='Ok'; IsResourcePackage=$false }
}
function Get-AppxPackageManifest {
  [CmdletBinding()] param([string]$Package)
  [xml]'<Package><Applications><Application Executable="Notepad.exe" /></Applications></Package>'
}
`;
async function executeScenario(plan, setup, body = 'return 0') {
  assert.equal(plan.script.split(boundary).length, 2, 'test injection has one dispatch boundary');
  const source = plan.script.replace(boundary, String.raw`
function Restore-DesktopUserProfile {}
${discovery}
${setup}
$script:attempts = 0
function Start-EditorProcess([string]$executable) {
  $script:attempts++
  [Console]::Error.WriteLine('ATTEMPT:' + $script:attempts)
  ${body}
}
` + boundary);
  const child = spawn(plan.command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', source],
    { ...plan.options, env: { ...plan.options.env, DSH_GROK_OPEN_KIND: 'file', DSH_TEST_PACKAGE_ROOT: plan.packageRoot },
      stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 15_000);
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { ...exit, stdout: stdout.trim(), attempts: (stderr.match(/ATTEMPT:/g) || []).length, stderr };
  } finally { clearTimeout(timer); }
}

test('Windows editor selection executes its real script with isolated OS boundaries', { skip: process.platform !== 'win32' }, async t => {
  const plan = await productionPlan();
  plan.packageRoot = mkdtempSync(join(tmpdir(), 'dsh-editor-registration-'));
  writeFileSync(join(plan.packageRoot, 'Notepad.exe'), 'synthetic registration target; never executed\n', { flag: 'wx' });
  assert.equal(plan.command, join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'));
  const cases = [
    ['registered modern editor is preferred', '', 'return 0', 'modern:none', 1],
    ['normal early exit is a successful existing-instance handoff', '', 'return 0', 'modern:none', 1],
    ['no package uses classic without a failure notice',
      'function Get-AppxPackage { [CmdletBinding()] param([string]$Name) }', 'return 0', 'classic:none', 1],
    ['registration query failure is visible in the fallback status',
      "function Get-AppxPackage { [CmdletBinding()] param([string]$Name) throw 'synthetic query error' }",
      'return 0', 'classic:discovery-failed', 1],
    ['broken manifest uses exactly one fallback',
      "function Get-AppxPackageManifest { [CmdletBinding()] param([string]$Package) throw 'synthetic manifest error' }",
      'return 0', 'classic:discovery-failed', 1],
    ['escaping executable cannot be launched',
      String.raw`function Get-AppxPackageManifest { [CmdletBinding()] param([string]$Package)
        [xml]'<Package><Applications><Application Executable="..\Notepad.exe" /></Applications></Package>' }`,
      'return 0', 'classic:unavailable', 1],
    ['missing executable cannot be launched',
      String.raw`function Get-AppxPackageManifest { [CmdletBinding()] param([string]$Package)
        [xml]'<Package><Applications><Application Executable="missing-editor\Notepad.exe" /></Applications></Package>' }`,
      'return 0', 'classic:unavailable', 1],
    ['failed modern start falls back once', '',
      "if ($script:attempts -eq 1) { throw 'synthetic start failure' }; return 0", 'classic:launch-failed', 2],
    ['crashed modern start falls back once', '',
      'if ($script:attempts -eq 1) { return -1073741819 }; return 0', 'classic:early-exit', 2],
  ];
  for (const [name, setup, body, receipt, attempts] of cases) {
    await t.test(name, async () => {
      const result = await executeScenario(plan, setup, body);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, 'DSH_GROK_OPEN_OK:' + receipt);
      assert.equal(result.attempts, attempts);
    });
  }
  await t.test('failure of both editors never emits a success receipt or third attempt', async () => {
    const result = await executeScenario(plan, '', 'return -1073741819');
    assert.equal(result.code, 1);
    assert.equal(result.stdout, 'DSH_GROK_OPEN_EDITOR_ERROR:-1073741819');
    assert.equal(result.attempts, 2);
  });
});
