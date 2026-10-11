import { runChat } from './supervisor.mjs';
import { fileURLToPath } from 'node:url';
const [root, mode = 'ready', command = 'start'] = process.argv.slice(2);
runChat({
  root, args: [command], startupTimeout: 1200,
  childCommand: { executable: process.execPath, args: [fileURLToPath(new URL('./fixture.mjs', import.meta.url)), root, mode] },
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
