import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'agentengine.exe');
const projectId = '6acbc84c07e49c5b0f33c510';
// Named contexts and explicit project/org/base-url flags are mutually exclusive.
const target = ['--context', 'hack', '--no-log'];
let key = '';

function readSetting(text, name) {
  const line = text.split(/\r?\n/).find(line => line.trimStart().startsWith(name + '='));
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function redact(text) {
  return key ? text.split(key).join('[redacted]') : text;
}

function run(args, { input = '', timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cli, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout.trim()) console.log(redact(stdout.trim()));
      if (stderr.trim()) console.error(redact(stderr.trim()));
      if (error) {
        reject(new Error(error.killed ? 'Command timed out; this is a failure. Check memory status before retrying.' : 'Command failed (exit ' + error.code + '). Stopped; no dependent command was run.'));
      } else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

try {
  const env = await readFile(path.join(root, 'rrflow', 'agents', 'rrflow', '.env'), 'utf8');
  key = readSetting(env, 'LLM_API_KEY');
  if (!key || !key.startsWith('sk-') || /[\r\n]/.test(key)) throw new Error('The existing RRFlow LLM_API_KEY is missing or does not match the configured OpenAI provider. Nothing was uploaded.');
  if (process.argv.includes('--check')) {
    console.log('Local OpenAI key found. Target: vibeguard / ' + projectId + ', context hack, PROJECT scope. No network calls or changes made.');
  } else {
    console.log('1/3 Saving the existing OpenAI key and matching provider at PROJECT scope.');
    await run(['secret', 'set', '--from-file', '-', '--on-empty', 'error', '--project-scope', ...target], {
      input: 'LLM_API_KEY=' + key + '\nOPENAI_API_KEY=' + key + '\nMONGOMEM_LLM_PROVIDER=openai\n',
      timeout: 60000,
    });
    console.log('2/3 Applying the existing hosted memory configuration; waiting up to five minutes.');
    await run(['memory', 'apply', '--wait', ...target], { timeout: 330000 });
    console.log('3/3 Verifying memory runtime state.');
    const status = await run(['memory', 'status', ...target]);
    const plain = status.replace(/\x1b\[[0-9;]*m/g, '');
    if (!plain.split(/\r?\n/).some(line => /^[ \t]*state:[ \t]*ready[ \t]*$/.test(line))) throw new Error('Memory did not explicitly report state: ready. No agent redeployment was attempted.');
    console.log('PASS: project memory reports ready. A memory write/read and chat request still need verification. No agent was redeployed.');
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
