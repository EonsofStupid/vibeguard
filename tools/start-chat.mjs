#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChat } from './chat-runtime/supervisor.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
runChat({ root, args: process.argv.slice(2) }).catch((error) => {
  console.error('VibeGuard: ' + error.message);
  process.exitCode = 1;
});
