/**
 * Atlas collections = Agent Engine memory types. Documents keep the shape the Python harness
 * already wrote today ({_id, record, body}) so both engines read the same data.
 */
import { Store, schema } from 'modelence/server';


export const dbRules = new Store('rules', {          // procedural memory
  schema: { record: schema.object({}), body: schema.string().optional() },
  indexes: [{ key: { 'record.status': 1 } }],
});
export const dbRuns = new Store('runs', {            // episodic memory
  schema: { record: schema.object({}), body: schema.string().optional() },
  indexes: [{ key: { 'record.at': 1 } }],
});
export const dbLexicon = new Store('lexicon', {      // semantic memory (Voyage embeddings, 1024-d)
  schema: { record: schema.object({}), body: schema.string().optional(), embedding: schema.array(schema.number()).optional() },
  indexes: [],
  searchIndexes: [Store.vectorIndex({ field: 'embedding', dimensions: 1024, similarity: 'cosine', indexName: 'lexicon_vec' })],
});
export const dbFailures = new Store('failures', {    // taxonomic memory
  schema: { record: schema.object({}), body: schema.string().optional() },
  indexes: [],
});
export const dbAudit = new Store('audit', {          // receipts, append-only
  schema: { at: schema.string(), event: schema.string(), rule_id: schema.string(), version: schema.number(), status: schema.string(), actor: schema.string(), reason: schema.string().optional() },
  indexes: [{ key: { at: 1 } }],
});
export const dbCostar = new Store('costar', {        // short-term: prompt captures
  schema: { record: schema.object({}), body: schema.string().optional() },
  indexes: [],
});
export const dbRaindrop = new Store('raindrop_log', {   // RRFlow on Raindrop: every emission (interaction, tool span, signal, self-diagnosis, eval run) mirrored here
  schema: {
    at: schema.string(), kind: schema.string(), name: schema.string(), event_id: schema.string(), status: schema.string(),
    ref: schema.object({}).optional(), sentiment: schema.string().optional(), detail: schema.string().optional(), url: schema.string().optional(), error: schema.string().optional(),
  },
  indexes: [{ key: { at: -1 } }, { key: { event_id: 1 } }],
});
