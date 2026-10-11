// Loaded only in launcher children and inherited by Next's Node workers.
const net = require('node:net');
const { VIBEGUARD_LEASE_PORT: port, VIBEGUARD_LEASE_TOKEN: token, VIBEGUARD_RUN_ID: runId } = process.env;
if (port && token && runId) {
  const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
  let header = '';
  let accepted = false;
  const quit = () => process.exit(1);
  const timer = setTimeout(quit, 5000);
  timer.unref();
  socket.unref();
  socket.once('connect', () => socket.write('GET /lease HTTP/1.1\r\nHost: localhost\r\nX-VibeGuard-Token: ' + token + '\r\nX-VibeGuard-Run: ' + runId + '\r\n\r\n'));
  socket.on('data', (data) => {
    if (accepted) return;
    header += data.toString();
    if (!header.includes('\r\n\r\n')) return;
    if (!header.startsWith('HTTP/1.1 200 ')) return quit();
    accepted = true;
    clearTimeout(timer);
  });
  socket.on('error', quit);
  socket.on('close', quit);
}
