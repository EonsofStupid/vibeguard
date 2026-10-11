import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
const [root, mode] = process.argv.slice(2);
if (mode === 'grandchild') {
  await writeFile(root + '/grandchild.pid', String(process.pid));
  setInterval(() => {}, 1000);
} else {
  await writeFile(root + '/child.pid', String(process.pid));
  spawn(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'), root, 'grandchild'], { env: process.env, windowsHide: true, stdio: 'ignore' });
  if (mode === 'fail') setTimeout(() => process.exit(9), 300);
  if (mode === 'hang' || mode === 'fail') setInterval(() => {}, 1000);
  else {
    const server = http.createServer((req, res) => res.end('<title>VibeGuard</title>fixture'));
    server.listen(0, '127.0.0.1', () => {
      const line = '\x1b[32m- Local: http://127.0.0.1:' + server.address().port + '/\x1b[0m\n';
      process.stdout.write(line.slice(0, 36));
      setTimeout(() => process.stdout.write(line.slice(36)), 50);
    });
  }
}
