/**
 * Dogfooding: the harness indexes ITS OWN codebase and ITS OWN learned rules into a vector-searched
 * knowledge collection, then explains itself to a vibecoder in plain terms with the code it points at.
 *   - `knowledge.json`  : every documented export of this harness (extracted by scripts/extract-knowledge.mjs)
 *   - approved rules    : each approval grows the collection (growFromRule) — the leash and the lesson are one record
 *   - lexicon + failures: the seed vocabulary, so a layman's phrase lands next to the engineering term
 * Retrieval: Atlas Vector Search over Voyage embeddings (`knowledge_vec`), token-overlap fallback.
 */
import { Store, schema } from 'modelence/server';
import { embed } from './semantic';
import { SEED_FAILURES, SEED_LEXICON } from './seed';
import type { GuardrailRule } from './schemas';
import UNITS from './knowledge.json';

export type KnowledgeUnit = {
  id: string; kind: 'module' | 'export' | 'rule' | 'lexicon' | 'failure';
  title: string; text: string; path?: string; swebok: string; layman?: string;
};

export const dbKnowledge = new Store('knowledge', {
  schema: { record: schema.object({}), body: schema.string().optional(), embedding: schema.array(schema.number()).optional() },
  indexes: [{ key: { 'record.kind': 1 } }],
  searchIndexes: [Store.vectorIndex({ field: 'embedding', dimensions: 1024, similarity: 'cosine', indexName: 'knowledge_vec' })],
});

/** Plain-language gloss for the engineering vocabulary the harness uses about itself. */
const LAYMAN: Record<string, string> = {
  'code:gate': 'The gate is the rulebook\'s lock: the AI can suggest a new rule, only you can switch it on, and nothing is ever erased.',
  'code:loop': 'One run = the AI tries every task, a checker grades it, and each kind of failure becomes a suggested rule.',
  'code:judge': 'The judge is a fixed checklist, not another AI, so the same code always gets the same grade.',
  'code:costar': 'COSTAR scores how complete your request is and asks at most two questions before any money is spent.',
  'code:semantic': 'Semantic memory turns your words into numbers so "make it take payments" finds "payment integration".',
  'code:schemas': 'Schemas are the shapes of every record — a rule, a run, a lesson — so nothing malformed can be stored.',
  'code:db': 'Each memory type is a MongoDB collection: rules, runs, lexicon, failures, receipts.',
  'code:metrics': 'Pass rates come with an interval because six tasks is a small sample; the interval says how sure we are.',
  'code:raindrop': 'Every suggestion, every human decision and every run is also sent to Raindrop so the learning is observable.',
  'code:knowledge': 'This file: the harness reads its own code and rules so it can explain itself to you.',
};

function seedUnits(): KnowledgeUnit[] {
  const code = (UNITS as KnowledgeUnit[]).map((u) => ({ ...u, layman: LAYMAN[u.id] ?? LAYMAN[u.id.split('.')[0]] }));
  const lex: KnowledgeUnit[] = SEED_LEXICON.map((e) => ({ id: `lexicon:${e.entry_id}`, kind: 'lexicon', title: e.canonical_label, text: `${e.phrase} -> ${e.canonical_label}. ${e.teach}`, swebok: 'Software Engineering Professional Practice (vocabulary)', layman: e.teach }));
  const fail: KnowledgeUnit[] = SEED_FAILURES.map((c) => ({ id: `failure:${c.category_id}`, kind: 'failure', title: c.title, text: `${c.title}. ${c.signal} ${c.why_it_matters}`, swebok: c.category_id.startsWith('security') ? 'Software Security' : c.category_id.startsWith('cost') ? 'Software Engineering Economics' : c.category_id.startsWith('safety') ? 'Software Engineering Operations' : 'Software Quality', layman: c.why_it_matters }));
  return [...code, ...lex, ...fail];
}

export function ruleUnit(rule: GuardrailRule): KnowledgeUnit {
  const ev = rule.origin.evidence;
  return {
    id: `rule:${rule.rule_id}`, kind: 'rule', title: `${rule.rule_id} · ${rule.category}`,
    text: `${rule.user_message} Trigger: ${rule.trigger.pattern}. ${ev ? `Learned from: "${ev.prompt}" -> ${ev.matched}` : ''}`,
    swebok: rule.category.startsWith('security') ? 'Software Security' : rule.category.startsWith('cost') ? 'Software Engineering Economics' : 'Software Engineering Operations',
    layman: rule.user_message,
  };
}

async function upsertUnits(units: KnowledgeUnit[]): Promise<number> {
  for (let i = 0; i < units.length; i += 32) {
    const batch = units.slice(i, i + 32);
    const vecs = await embed(batch.map((u) => `${u.title}. ${u.text}`), 'document');
    for (let j = 0; j < batch.length; j++) {
      await dbKnowledge.upsertOne({ _id: batch[j].id } as any, { $set: { record: batch[j], body: batch[j].layman ?? '', embedding: vecs[j] } });
    }
  }
  return units.length;
}

/** Index the harness's own code + vocabulary. Idempotent. */
export async function indexKnowledge(): Promise<{ indexed: number; kinds: Record<string, number> }> {
  const units = seedUnits();
  const n = await upsertUnits(units);
  const kinds: Record<string, number> = {};
  for (const u of units) kinds[u.kind] = (kinds[u.kind] ?? 0) + 1;
  return { indexed: n, kinds };
}

/** Called on approval: the collection grows with what the harness just learned. Never throws into the gate. */
export async function growFromRule(rule: GuardrailRule): Promise<void> {
  try { await upsertUnits([ruleUnit(rule)]); } catch (e) { console.warn('[knowledge] grow skipped:', (e as Error).message); }
}

export type Explanation = KnowledgeUnit & { score: number };

/** "Explain this to me": vector search over the harness's knowledge of itself. Falls back to token overlap. */
export async function explain(query: string, k = 5): Promise<{ hits: Explanation[]; resolver: string }> {
  try {
    const [q] = await embed([query], 'query');
    const cur = await dbKnowledge.vectorSearch({ field: 'embedding', embedding: q, numCandidates: 100, limit: k, indexName: 'knowledge_vec', projection: { record: 1, score: { $meta: 'vectorSearchScore' } } });
    const docs = await cur.toArray();
    return { hits: docs.map((d: any) => ({ ...(d.record as KnowledgeUnit), score: +Number(d.score).toFixed(4) })), resolver: 'atlas-vector-search+voyage' };
  } catch (e: any) {
    const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
    const q = tokens(query);
    const hits = seedUnits().map((u) => { const p = tokens(`${u.title} ${u.text}`); const inter = [...q].filter((w) => p.has(w)).length; return { ...u, score: +(inter / (new Set([...q, ...p]).size || 1)).toFixed(4) }; })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
    return { hits, resolver: `token-overlap fallback (${String(e?.message ?? e).slice(0, 60)})` };
  }
}
