/** Semantic memory: Voyage embeddings (MongoDB US endpoint) + Atlas Vector Search via the Store. */
import { getConfig } from 'modelence/server';
import { dbLexicon } from './db';
import { SEED_LEXICON } from './seed';
import { LexiconEntry } from './schemas';

/** MongoDB-issued model keys (`al-…`) talk to MongoDB's endpoint; Voyage AI keys (`pa-…`) only work on Voyage's own. */
const MONGODB_BASE = process.env.VOYAGE_BASE_URL || 'https://us.ai.mongodb.com/v1';
const VOYAGE_BASE = 'https://api.voyageai.com/v1';
const baseFor = (k: string) => (k.startsWith('pa-') ? VOYAGE_BASE : MONGODB_BASE);
function key(): string {
  const raw = (getConfig('harness.voyageApiKey') as string) || process.env.VOYAGE_API_KEY || '';
  const k = raw.trim().replace(/^["']|["']$/g, '');   // dashboard-pasted values sometimes carry quotes or a newline
  if (!k) throw new Error('VOYAGE_API_KEY is not set');
  return k;
}
export async function embed(texts: string[], inputType: 'query' | 'document'): Promise<number[][]> {
  const model = process.env.VOYAGE_MODEL || 'voyage-code-4';
  const k = key();
  const res = await fetch(`${baseFor(k)}/embeddings`, {
    method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts, input_type: inputType }),
  });
  if (!res.ok) throw new Error(`Voyage HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

export async function embedLexicon(entries: LexiconEntry[] = SEED_LEXICON): Promise<number> {
  const vecs = await embed(entries.map((e) => `${e.phrase} -> ${e.canonical_label}`), 'document');
  for (let i = 0; i < entries.length; i++) {
    await dbLexicon.upsertOne({ _id: entries[i].entry_id } as any, { $set: { record: entries[i], body: entries[i].teach, embedding: vecs[i] } });
  }
  return entries.length;
}

export async function vectorResolve(text: string, k = 3): Promise<{ record: LexiconEntry; score: number }[]> {
  const [q] = await embed([text], 'query');
  const cur = await dbLexicon.vectorSearch({ field: 'embedding', embedding: q, numCandidates: 50, limit: k, indexName: 'lexicon_vec',
    projection: { record: 1, score: { $meta: 'vectorSearchScore' } } });
  const docs = await cur.toArray();
  return docs.map((d: any) => ({ record: LexiconEntry.parse(d.record), score: +Number(d.score).toFixed(4) }));
}

/** Atlas Search index status for the lexicon vector index (name, status, queryable). */
export async function vectorIndexStatus(): Promise<{ name: string; status?: string; queryable?: boolean }[]> {
  const coll = dbLexicon.rawCollection();
  const idx = await coll.listSearchIndexes().toArray();
  return idx.map((i: any) => ({ name: i.name, status: i.status, queryable: i.queryable }));
}

/** Create the vector index if the startup sync did not (e.g. the collection did not exist yet). Idempotent. */
export async function ensureVectorIndex(): Promise<{ created: boolean; indexes: { name: string; status?: string; queryable?: boolean }[] }> {
  const existing = await vectorIndexStatus();
  if (existing.some((i) => i.name === 'lexicon_vec')) return { created: false, indexes: existing };
  await dbLexicon.rawCollection().createSearchIndexes([{
    name: 'lexicon_vec', type: 'vectorSearch',
    definition: { fields: [{ type: 'vector', path: 'embedding', numDimensions: 1024, similarity: 'cosine' }] },
  } as any]);
  return { created: true, indexes: await vectorIndexStatus() };
}

/** Offline fallback: token-overlap (Jaccard) over the seed lexicon. Used when the embedding service is unavailable or rate-limited. */
const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
export function overlapResolve(text: string, k = 3, entries: LexiconEntry[] = SEED_LEXICON): { record: LexiconEntry; score: number }[] {
  const q = tokens(text);
  return entries
    .map((e) => { const p = tokens(`${e.phrase} ${e.canonical_label}`); const inter = [...q].filter((w) => p.has(w)).length; const union = new Set([...q, ...p]).size; return { record: e, score: union ? +(inter / union).toFixed(4) : 0 }; })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
