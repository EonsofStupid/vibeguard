import { spawn, execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };

export function parseArgs(args) {
  let command = 'start';
  let port = 0;
  if (['start', 'status', 'stop'].includes(args[0])) command = args.shift();
  if (args.length) {
    if (command !== 'start' || args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) throw new Error('Usage: node tools/start-chat.mjs [start [--port 0..65535] | status | stop]');
    port = Number(args[1]);
    if (!Number.isInteger(port) || port > 65535) throw new Error('Port must be between 0 and 65535; 0 chooses an available port automatically.');
  }
  return { command, port };
}

export function urlFromOutput(output) {
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const found = clean.match(/Local:\s+(http:\/\/127\.0\.0\.1:(\d+))(?:\s|\/|$)/);
  return found && Number(found[2]) > 0 && Number(found[2]) <= 65535 ? found[1] + '/' : null;
}

function request(url, { method = 'GET', headers = {}, timeout = 1500, maxBytes = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const req = http.request(url, { method, headers }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > maxBytes) req.destroy(new Error('Response exceeded the size limit.'));
      });
      res.on('end', () => finish(null, { status: res.statusCode, body }));
      res.on('error', finish);
    });
    const timer = setTimeout(() => req.destroy(new Error('Request timed out.')), timeout);
    req.on('error', finish);
    req.end();
  });
}

function validOwner(owner, root) {
  return owner?.root === root && Number.isInteger(owner.pid) && owner.pid > 0
    && Number.isInteger(owner.controlPort) && owner.controlPort > 0 && owner.controlPort <= 65535
    && typeof owner.token === 'string' && owner.token.length >= 32
    && typeof owner.runId === 'string' && owner.runId.length >= 32;
}

async function contact(owner, route = 'status') {
  const result = await request('http://' + host + ':' + owner.controlPort + '/' + route, {
    method: route === 'stop' ? 'POST' : 'GET',
    headers: { 'X-VibeGuard-Token': owner.token, 'X-VibeGuard-Run': owner.runId },
  });
  const state = JSON.parse(result.body);
  if (result.status !== 200 || state.runId !== owner.runId || state.root !== owner.root) throw new Error('Launcher identity could not be verified.');
  return state;
}

async function readOwner(lock, root) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
      if (!validOwner(owner, root)) throw new Error('Invalid chat ownership record; no processes were stopped.');
      return owner;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await access(lock); } catch { return null; }
      await delay(100);
    }
  }
  throw new Error('Another launcher has an incomplete ownership record. No second server was started.');
}

async function removeOwnLock(lock, runId) {
  try {
    const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
    if (owner.runId === runId) await rm(lock, { recursive: true, force: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function acquire(lock, root, owner) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(lock);
      await writeFile(path.join(lock, 'owner.tmp'), JSON.stringify(owner), { flag: 'wx' });
      await rename(path.join(lock, 'owner.tmp'), path.join(lock, 'owner.json'));
      return null;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readOwner(lock, root);
      if (!existing) continue;
      try { return await contact(existing); } catch {
        if (alive(existing.pid)) throw new Error('An existing chat launcher is unresponsive. No duplicate was started and no unrelated process was stopped.');
        // Serialize reclamation so two starters cannot rename each other's new lock.
        const reclaim = lock + '.reclaim';
        try { await mkdir(reclaim); } catch (error) { if (error.code === 'EEXIST') { await delay(150); continue; } throw error; }
        try {
          const current = await readOwner(lock, root);
          if (current?.runId !== existing.runId || alive(current.pid)) continue;
          const stale = lock + '.stale-' + randomUUID();
          try { await rename(lock, stale); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          await rm(stale, { recursive: true, force: true });
        } finally { await rm(reclaim, { recursive: true, force: true }); }
      }
    }
  }
  throw new Error('Chat startup ownership changed repeatedly. Try again after the current launcher finishes.');
}

async function killOwnedTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 }, () => resolve()));
  } else {
    child.kill('SIGTERM');
  }
  const deadline = Date.now() + 1000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(25);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

export async function runChat({ root, args = [], childCommand, startupTimeout = 30_000, log = console.log, errorLog = console.error }) {
  root = path.resolve(root);
  const { command, port } = parseArgs([...args]);
  const runtime = path.join(root, '.runtime');
  const lock = path.join(runtime, 'chat-launcher');
  if (command !== 'start') {
    const owner = await readOwner(lock, root);
    if (!owner) { log('VibeGuard chat is stopped.'); return; }
    let state;
    try { state = await contact(owner, command); } catch (error) {
      if (!alive(owner.pid)) { log('VibeGuard chat is stopped. The next start will replace its stale launcher record.'); return; }
      throw new Error('The recorded launcher did not respond with its verified identity. No processes were stopped. ' + error.message);
    }
    if (command === 'status') {
      log('VibeGuard chat: ' + state.phase + (state.url ? ' at ' + state.url : ''));
      return;
    }
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      try { await access(lock); } catch { log('VibeGuard chat stopped.'); return; }
      await delay(100);
    }
    throw new Error('Shutdown has not completed within 7 seconds. Check the launcher terminal.');
  }

  const client = path.join(root, 'vibeguard');
  const next = path.join(client, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!childCommand) {
    try { await access(next); } catch { throw new Error('Next.js is missing. Run: corepack pnpm --dir vibeguard install --frozen-lockfile'); }
  }
  await mkdir(runtime, { recursive: true });
  const runId = randomUUID();
  const token = randomUUID();
  const state = { runId, root, phase: 'starting', url: null };
  const leases = new Set();
  let child;
  let ownsLock = false;
  let shutdown;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let finishCode = 0;
  const control = http.createServer((req, res) => {
    if (req.headers['x-vibeguard-token'] !== token || req.headers['x-vibeguard-run'] !== runId) { res.writeHead(403).end(); return; }
    if (req.url === '/lease' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.flushHeaders();
      leases.add(res);
      res.on('close', () => leases.delete(res));
      return;
    }
    if (req.url === '/status' && req.method === 'GET' || req.url === '/stop' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state));
      if (req.url === '/stop') res.once('finish', () => void stop());
      return;
    }
    res.writeHead(404).end();
  });
  control.requestTimeout = 0;
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(0, host, resolve); });
  const owner = { root, runId, token, pid: process.pid, controlPort: control.address().port };

  const stop = (code = 0) => {
    if (shutdown) return shutdown;
    finishCode = code;
    state.phase = 'stopping';
    shutdown = (async () => {
      for (const lease of leases) lease.destroy();
      control.closeAllConnections();
      control.close();
      await killOwnedTree(child);
      if (ownsLock) await removeOwnLock(lock, runId);
      resolveDone();
    })();
    return shutdown;
  };
  const onSignal = () => { void stop(); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);

  try {
    const existing = await acquire(lock, root, owner);
    if (existing) {
      log('VibeGuard chat is already ' + existing.phase + (existing.url ? ': ' + existing.url : '') + '. No duplicate started.');
      return;
    }
    ownsLock = true;
    if (shutdown) { await removeOwnLock(lock, runId); return; }
    const nodeOptions = [process.env.NODE_OPTIONS, '--require=' + JSON.stringify(path.join(here, 'lease.cjs').replaceAll('\\', '/'))].filter(Boolean).join(' ');
    const spec = childCommand || { executable: process.execPath, args: [next, 'dev', '--hostname', host, '--port', String(port)], cwd: client };
    child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd || root,
      env: { ...process.env, ...spec.env, VIBEGUARD_DASHBOARD_ROLE: 'chat', VIBEGUARD_CHAT_PORT: '', VIBEGUARD_LEASE_PORT: String(owner.controlPort), VIBEGUARD_LEASE_TOKEN: token, VIBEGUARD_RUN_ID: runId, NODE_OPTIONS: nodeOptions },
      windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let childFailure;
    child.on('error', (error) => { childFailure = error; void stop(1); });
    child.on('exit', (code, signal) => {
      if (!shutdown) { childFailure = new Error('Chat server exited (code ' + code + ', signal ' + signal + ').'); errorLog(childFailure.message); void stop(code || 1); }
    });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output = (output + text).slice(-16_384);
      // A split port number cannot be mistaken for a complete URL.
      const complete = output.slice(0, Math.max(output.lastIndexOf('\n'), output.lastIndexOf('\r')) + 1);
      state.url ||= urlFromOutput(complete);
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    log('Starting VibeGuard; an available port will be selected automatically. Keep this terminal open.');
    const deadline = Date.now() + startupTimeout;
    while (!shutdown && Date.now() < deadline) {
      if (childFailure) throw childFailure;
      if (state.url) {
        try {
          const page = await request(state.url, { timeout: Math.min(2000, Math.max(1, deadline - Date.now())) });
          if (page.status === 200 && /<title>\s*VibeGuard\s*<\/title>/i.test(page.body)) {
            if (shutdown) break;
            state.phase = 'ready';
            await writeFile(path.join(lock, 'url.txt'), state.url + '\n');
            log('VibeGuard page ready: ' + state.url);
            log('Page availability verified; model and memory connectivity are separate checks. Ctrl+C stops this server and its workers.');
            break;
          }
        } catch { /* bounded readiness polling */ }
      }
      await delay(100);
    }
    if (!shutdown && state.phase !== 'ready') throw new Error('Chat did not become ready within ' + startupTimeout / 1000 + ' seconds. Its server and workers are being stopped.');
    await done;
    if (finishCode) throw childFailure || new Error('Chat server stopped after a failure.');
  } finally {
    await stop(finishCode);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
  }
}
