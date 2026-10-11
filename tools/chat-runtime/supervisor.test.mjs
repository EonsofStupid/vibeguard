import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs, urlFromOutput } from './supervisor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '../..');
const harness = path.join(here, 'fixture-launcher.mjs');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await delay(40); }
  throw new Error('Condition did not complete within ' + timeout + 'ms.');
}
function launch(root, mode = 'ready', command = 'start') {
  const child = spawn(process.execPath, [harness, root, mode, command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (v) => { output += v; });
  child.stderr.on('data', (v) => { output += v; });
  child.output = () => output;
  child.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code)); });
  return child;
}
async function rootFor(t) {
  await mkdir(path.join(workspace, '.runtime'), { recursive: true });
  const root = await mkdtemp(path.join(workspace, '.runtime', 'launcher-test-'));
  const owned = new Set();
  t.after(async () => {
    // Only fixture processes created by this test are eligible for cleanup.
    for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const name of ['child.pid', 'grandchild.pid']) {
      try { const pid = Number(await readFile(path.join(root, name), 'utf8')); if (Number.isInteger(pid) && pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL'); } catch {}
    }
    await delay(100);
    await rm(root, { recursive: true, force: true });
  });
  return { root, start(mode, command) { const child = launch(root, mode, command); owned.add(child); return child; } };
}
async function pids(root) {
  let ids;
  await until(async () => {
    try {
      ids = await Promise.all(['child.pid', 'grandchild.pid'].map(async (name) => Number(await readFile(root + '/' + name, 'utf8'))));
      // File creation precedes the asynchronous write. An empty file is not PID 0.
      return ids.every((pid) => Number.isInteger(pid) && pid > 0);
    } catch { return false; }
  });
  return ids;
}
async function gone(ids) { await until(() => ids.every((pid) => !alive(pid))); }

test('defaults to OS-assigned port and validates explicit options', () => {
  assert.deepEqual(parseArgs([]), { command: 'start', port: 0 });
  assert.deepEqual(parseArgs(['start', '--port', '0']), { command: 'start', port: 0 });
  assert.throws(() => parseArgs(['--port', '65536']));
  assert.throws(() => parseArgs(['status', '--port', '3001']));
  assert.equal(urlFromOutput('\x1b[32m- Local: http://127.0.0.1:54321\x1b[0m\n'), 'http://127.0.0.1:54321/');
});

test('dynamic URL, duplicate launch, status, and stop preserve unrelated listener', { timeout: 15000 }, async (t) => {
  const f = await rootFor(t);
  const unrelated = http.createServer((req, res) => res.end('unrelated'));
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  t.after(() => unrelated.close());
  const child = f.start();
  await until(() => child.output().includes('page ready:'));
  const ids = await pids(f.root);
  const url = (await readFile(f.root + '/.runtime/chat-launcher/url.txt', 'utf8')).trim();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.notEqual(Number(new URL(url).port), unrelated.address().port);
  const second = f.start();
  assert.equal(await second.finished, 0);
  assert.match(second.output(), /already ready/);
  assert.deepEqual(await pids(f.root), ids);
  const status = f.start('ready', 'status');
  assert.equal(await status.finished, 0);
  assert.ok(status.output().includes(url));
  const stop = f.start('ready', 'stop');
  assert.equal(await stop.finished, 0, stop.output());
  assert.equal(await child.finished, 0, child.output());
  await gone(ids);
  assert.equal(unrelated.listening, true);
  await assert.rejects(access(f.root + '/.runtime/chat-launcher'));
});

test('concurrent starts create one server', { timeout: 15000 }, async (t) => {
  const f = await rootFor(t);
  const one = f.start();
  const two = f.start();
  await until(() => one.output().includes('No duplicate') || two.output().includes('No duplicate'));
  await until(() => one.output().includes('page ready:') || two.output().includes('page ready:'));
  const duplicate = one.output().includes('No duplicate') ? one : two;
  assert.equal(await duplicate.finished, 0, duplicate.output());
  const stop = f.start('ready', 'stop');
  assert.equal(await stop.finished, 0, stop.output());
  await Promise.all([one.finished, two.finished]);
  await gone(await pids(f.root));
});

for (const mode of ['hang', 'fail']) {
  test(mode + ' startup cleans child and grandchild', { timeout: 12000 }, async (t) => {
    const f = await rootFor(t);
    const child = f.start(mode);
    const ids = await pids(f.root);
    assert.equal(await child.finished, 1, child.output());
    await gone(ids);
    await assert.rejects(access(f.root + '/.runtime/chat-launcher'));
  });
}

test('abrupt supervisor loss ends descendants and stale record can be replaced', { timeout: 15000 }, async (t) => {
  const f = await rootFor(t);
  const child = f.start();
  await until(() => child.output().includes('page ready:'));
  const ids = await pids(f.root);
  child.kill('SIGKILL');
  await child.finished;
  await gone(ids);
  const next = f.start();
  await until(() => next.output().includes('page ready:'));
  const stop = f.start('ready', 'stop');
  assert.equal(await stop.finished, 0, stop.output());
  assert.equal(await next.finished, 0, next.output());
});

test('stale record with live unrelated PID is never killed or replaced', { timeout: 8000 }, async (t) => {
  const f = await rootFor(t);
  const lock = f.root + '/.runtime/chat-launcher';
  await mkdir(lock, { recursive: true });
  const server = http.createServer((req, res) => res.writeHead(403).end('{}'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const record = { root: path.resolve(f.root), pid: process.pid, runId: randomUUID(), token: randomUUID(), controlPort: server.address().port };
  await writeFile(lock + '/owner.json', JSON.stringify(record));
  const child = f.start();
  assert.equal(await child.finished, 1);
  assert.match(child.output(), /unresponsive/);
  assert.equal(server.listening, true);
  assert.deepEqual(JSON.parse(await readFile(lock + '/owner.json')), record);
});
