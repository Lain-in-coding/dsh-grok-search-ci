// Real platform smoke gate; only newly created, credential-free configuration.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { platform, release } from 'node:os';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tarball = resolve(process.argv[2] || '');
assert.ok(process.argv[2]?.endsWith('.tgz'), 'Pass the frozen .tgz');
const receipt = JSON.parse(readFileSync(join(dirname(tarball), 'package-receipt.json'), 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(hash(tarball), receipt.sha256);
const directory = join(project, 'artifacts/config-opener-platform', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
mkdirSync(directory, { recursive: true });
const result = { platform: platform(), osRelease: release(), packageSha256: receipt.sha256, passed: false,
  syntheticConfigOnly: true, published: false };
const run = (command, args, env = process.env) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Platform observation timed out: ' + command)); }, 30_000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', (code, signal) => { clearTimeout(timer); resolveRun({ code, signal, stdout, stderr }); });
});
let opener;
try {
  const unpack = await run(process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar', ['-xf', tarball, '-C', directory]);
  assert.equal(unpack.code, 0, unpack.stderr);
  for (const item of receipt.sourceHashes) assert.equal(hash(join(directory, 'package', item.file)), item.sha256, item.file);
  const { createConfigLocationOpener } = await import(pathToFileURL(join(directory, 'package/src/core/config-opener.mjs')).href);
  const folder = join(directory, "中文 空格 ' & $literal");
  mkdirSync(folder);
  const path = join(folder, `config-open-${randomUUID()}.toml`);
  const content = '# Synthetic editor roundtrip.\ntimeout_seconds = 73\n';
  writeFileSync(path, content, { flag: 'wx' });
  const before = hash(path);
  if (process.platform === 'linux') {
    opener = createConfigLocationOpener({ env: { PATH: '/usr/bin:/bin', HOME: directory } });
    for (const kind of ['file', 'folder']) {
      await assert.rejects(opener.open({ path, kind }), { code: 'CONFIG_OPEN_NO_DESKTOP' });
    }
    result.scope = 'real-Linux-headless-CLI-host';
    result.noDesktopErrorVerified = true;
  } else if (process.platform === 'darwin') {
    opener = createConfigLocationOpener();
    result.openFile = await opener.open({ path, kind: 'file' });
    assert.equal(result.openFile.opened, true);
    const processes = await run('/usr/bin/pgrep', ['-fl', 'TextEdit']);
    result.editorProcesses = processes.stdout.trim();
    const screen = await run('/usr/sbin/screencapture', ['-x', join(directory, 'synthetic-editor.png')]);
    result.screenCaptureCode = screen.code;
    // The clean macOS runner's default text editor is TextEdit. Observe only the
    // unique synthetic document, then save it to prove it is the original file.
    const appleScript = `
on run argv
  set expectedName to item 1 of argv
  with timeout of 12 seconds
  tell application "TextEdit"
    repeat 50 times
      repeat with doc in documents
        if (name of doc as text) is expectedName then
          delay 2
          set text of doc to "# Synthetic editor roundtrip." & linefeed & "timeout_seconds = 74" & linefeed
          save doc
          close doc saving no
          return "ROUNDTRIP_OK"
        end if
      end repeat
      delay 0.2
    end repeat
  end tell
  end timeout
  error "Synthetic document did not appear in the default editor."
end run`;
    const edited = await run('/usr/bin/osascript', ['-e', appleScript, path.split('/').at(-1)]);
    result.editorAutomation = { code: edited.code, stdout: edited.stdout.trim(), stderr: edited.stderr.trim() };
    assert.equal(edited.code, 0, edited.stderr);
    assert.equal(edited.stdout.trim(), 'ROUNDTRIP_OK');
    assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), content.replace('73', '74'));
    result.originalFileRoundtripVerified = true;
    result.openFolder = await opener.open({ path, kind: 'folder' });
    assert.equal(result.openFolder.opened, true);
    result.scope = 'real-macOS-default-TextEdit-and-Finder';
  } else {
    throw new Error('Use the Windows Desktop --open-config gate for actual editor selection.');
  }
  if (process.platform !== 'darwin') assert.equal(hash(path), before);
  result.passed = true;
} catch (error) {
  result.error = String(error.message).slice(0, 800);
  process.exitCode = 1;
} finally {
  opener?.dispose();
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...result, evidence: directory }));
}
