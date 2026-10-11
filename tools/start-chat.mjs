#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, mkdir, open, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = path.join(workspaceRoot, 'vibeguard');
const runtimeRoot = path.join(workspaceRoot, '.runtime');
const nextBinary = path.join(clientRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const args = process.argv.slice(2);
const port = args.length === 0 ? 3001 : args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
const validPort = Number.isInteger(port) && port > 0 && port <= 65535;
const suffix = validPort && port !== 3001 ? '-' + port : '';
const stdoutPath = path.join(runtimeRoot, 'chat-server' + suffix + '.log');
const stderrPath = path.join(runtimeRoot, 'chat-server-error' + suffix + '.log');
const pidPath = path.join(runtimeRoot, 'chat' + suffix + '.pid');
const chatUrl = 'http://127.0.0.1:' + port + '/';
const titlePattern = /<title>\s*VibeGuard\s*<\/title>/i;

function probe(timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const request = http.get(chatUrl, { headers: { Accept: 'text/html' } }, (response) => {
      let html = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        html += chunk;
        if (html.length > 2_000_000) {
          finish({ kind: 'occupied', detail: 'The response exceeded the readiness size limit.' });
          request.destroy();
        }
      });
      response.on('end', () => {
        if (response.statusCode === 200 && titlePattern.test(html)) {
          finish({ kind: 'ready' });
        } else {
          finish({ kind: 'occupied', detail: 'Port ' + port + ' returned HTTP ' + response.statusCode + ' without the expected VibeGuard page.' });
        }
      });
      response.on('error', (error) => finish({ kind: 'occupied', detail: 'The HTTP response failed (' + (error.code || error.name) + ').' }));
    });
    request.on('error', (error) => {
      finish(error.code === 'ECONNREFUSED'
        ? { kind: 'refused', detail: 'No server is listening on port ' + port + '.' }
        : { kind: 'occupied', detail: 'The connection could not be verified (' + (error.code || error.name) + ').' });
    });
    timer = setTimeout(() => {
      finish({ kind: 'occupied', detail: 'The readiness request timed out.' });
      request.destroy();
    }, timeoutMs);
  });
}

async function main() {
  if (!validPort) throw new Error('Usage: node tools/start-chat.mjs [--port NUMBER], where NUMBER is between 1 and 65535.');
  const current = await probe();
  if (current.kind === 'ready') {
    console.log('VibeGuard is already running: ' + chatUrl);
    console.log('Verified the page only (HTTP 200); the model connection is unverified. The existing server was left running.');
    return;
  }
  if (current.kind !== 'refused') {
    throw new Error(current.detail + ' No second server was started.');
  }
  try {
    await access(nextBinary);
  } catch {
    throw new Error('Next.js is not installed. From the repository root, run: corepack pnpm --dir vibeguard install --frozen-lockfile');
  }
  await mkdir(runtimeRoot, { recursive: true });
  const stdout = await open(stdoutPath, 'a');
  let stderr;
  let child;
  try {
    stderr = await open(stderrPath, 'a');
    child = spawn(process.execPath, [nextBinary, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: clientRoot,
      env: { ...process.env, VIBEGUARD_CHAT_PORT: String(port) },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdout.fd, stderr.fd],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    await writeFile(pidPath, String(child.pid) + '\n', 'utf8');
  } finally {
    await stdout.close();
    if (stderr) await stderr.close();
  }

  console.log('Starting VibeGuard on ' + chatUrl);
  const deadline = Date.now() + 30_000;
  let last = { detail: 'No HTTP response was received.' };
  while (Date.now() < deadline) {
    last = await probe(Math.min(2500, Math.max(1, deadline - Date.now())));
    if (last.kind === 'ready') {
      console.log('VibeGuard page is ready: ' + chatUrl);
      console.log('Verified the page only (HTTP 200); the model connection is unverified. The server stays running after this command exits.');
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('The server exited before the page became ready (exit ' + child.exitCode + ', signal ' + child.signalCode + ').');
    }
    await delay(Math.min(500, Math.max(1, deadline - Date.now())));
  }
  throw new Error('VibeGuard did not become ready within 30 seconds. ' + last.detail + ' The launched process was left running for diagnosis.');
}

main().catch((error) => {
  console.error('VibeGuard startup failed: ' + error.message);
  console.error('Server output: ' + stdoutPath);
  console.error('Server errors: ' + stderrPath);
  process.exitCode = 1;
});
