/** Semantic memory: Voyage embeddings (MongoDB US endpoint) + Atlas Vector Search via the Store. */
import { getConfig } from 'modelence/server';
import { dbLexicon } from './db';
import { SEED_LEXICON } from './seed';
import { LexiconEntry } from './schemas';

const BASE = 'https://us.ai.mongodb.com/v1';
function key(): string {
  const raw = (getConfig('harness.voyageApiKey') as string) || process.env.VOYAGE_API_KEY || '';
  const k = raw.trim().replace(/^["']|["']$/g, '');   // dashboard-pasted values sometimes carry quotes or a newline
  if (!k) throw new Error('VOYAGE_API_KEY is not set');
  return k;
}
export async function embed(texts: string[], inputType: 'query' | 'document'): Promise<number[][]> {
  const model = process.env.VOYAGE_MODEL || 'voyage-code-4';
  const res = await fetch(`${BASE}/embeddings`, {
    method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
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
