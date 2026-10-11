#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, runChat } from './chat-runtime/supervisor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const args = process.argv.slice(2);

// Modelence logs its configured URL, not server.address() when PORT=0. Ask the
// OS for a free port and retry only a proven bind race, after owned cleanup.
async function availablePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const { command, port } = parseArgs([...args]);
  let clientAsset;
  if (command === 'start') {
    try { await access(path.join(root, '.modelence/build/app.mjs')); }
    catch { throw new Error('Build the workbench first: npm --prefix web run build'); }
    const index = await readFile(path.join(root, '.modelence/build/client/index.html'), 'utf8');
    clientAsset = index.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
    if (!clientAsset) throw new Error('The built workbench has no client entry asset. Rebuild before starting.');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    let selectedPort;
    try {
      await runChat({
        root,
        args,
        startupTimeout: 60_000,
        childCommand: async () => {
          selectedPort = port || await availablePort();
          return {
            executable: process.execPath,
            args: ['--env-file=.env', 'scripts/start.mjs'],
            cwd: root,
            env: {
              NODE_ENV: 'production',
              PORT: String(selectedPort),
              MODELENCE_PORT: String(selectedPort),
              MODELENCE_SITE_URL: `http://127.0.0.1:${selectedPort}`,
            },
          };
        },
        outputUrl: (output) => selectedPort && /Application started on /.test(output) ? `http://127.0.0.1:${selectedPort}/` : null,
        // The React page sets its title after hydration. Verify the built entry
        // asset rather than accepting any listener that happens to return 200.
        pageReady: (page) => page.status === 200 && page.body.includes(`src="${clientAsset}"`) && page.body.includes('id="root"'),
      });
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || port || attempt === 2) throw error;
      console.log('The selected port was claimed during startup; retrying with another available port.');
    }
  }
}

main().catch((error) => {
  console.error('VibeGuard: ' + error.message);
  process.exitCode = 1;
});
