#!/usr/bin/env node
// Dogfood corpus: the harness reads its own source and turns every documented export into a knowledge unit.
// Output: src/server/harness/knowledge.json (committed; embedded into Atlas at seed time, grown at approval time).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/server/harness';
const SWEBOK = {
  gate: 'Software Configuration Management · Software Engineering Management',
  loop: 'Software Testing · Software Engineering Process',
  judge: 'Software Testing · Software Quality',
  costar: 'Software Requirements',
  semantic: 'Software Engineering Models and Methods (knowledge representation)',
  schemas: 'Software Design (data modelling)',
  db: 'Software Design · Software Engineering Operations (persistence)',
  metrics: 'Engineering Foundations (statistics)',
  raindrop: 'Software Engineering Operations (observability)',
  knowledge: 'Software Engineering Professional Practice (teaching)',
  index: 'Software Architecture (API surface)',
  seed: 'Software Testing (fixtures)',
};
const units = [];
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const src = readFileSync(join(DIR, f), 'utf8');
  const mod = f.replace('.ts', '');
  const header = src.match(/^\/\*\*([\s\S]*?)\*\//);
  if (header) units.push({ id: `code:${mod}`, kind: 'module', title: `${mod}.ts`, path: `${DIR}/${f}`, swebok: SWEBOK[mod] ?? 'Software Engineering',
    text: header[1].replace(/^\s*\*\s?/gm, '').trim() });
  const re = /\/\*\*([\s\S]*?)\*\/\s*\n\s*export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src))) {
    units.push({ id: `code:${mod}.${m[2]}`, kind: 'export', title: `${m[2]} (${mod}.ts)`, path: `${DIR}/${f}`, swebok: SWEBOK[mod] ?? 'Software Engineering',
      text: m[1].replace(/^\s*\*\s?/gm, '').trim() });
  }
  // undocumented exports still count, with a one-line signature so they are findable
  const re2 = /\nexport\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)([^\n]*)/g;
  while ((m = re2.exec(src))) {
    const id = `code:${mod}.${m[1]}`;
    if (!units.some((u) => u.id === id)) units.push({ id, kind: 'export', title: `${m[1]} (${mod}.ts)`, path: `${DIR}/${f}`, swebok: SWEBOK[mod] ?? 'Software Engineering', text: `${m[1]}${m[2].trim()}` });
  }
}
writeFileSync(join(DIR, 'knowledge.json'), JSON.stringify(units, null, 1) + '\n');
console.log(`knowledge units: ${units.length}`);
