/** The VibeGuard harness as a Modelence module: queries for the judges' view, mutations for the human gate. */
import z from 'zod';
import { Module } from 'modelence/server';
import { dbRules, dbRuns, dbLexicon, dbFailures, dbAudit, dbCostar } from './db';
import { allRules } from './gate';
import { runOnce } from './loop';
import { scorePrompt, missing, sideConversation, uiSpec } from './costar';
import { vectorResolve, embedLexicon, vectorIndexStatus, ensureVectorIndex } from './semantic';
import { RunResult } from './schemas';
import { SEED_FAILURES, SEED_LEXICON } from './seed';
import { liveImprovement } from './live-improvement';

const strip = (d: any) => d.record;

export default new Module('harness', {
  configSchema: {
    voyageApiKey: { type: 'string', default: '', isPublic: false },
  },
  stores: [dbRules, dbRuns, dbLexicon, dbFailures, dbAudit, dbCostar],

  queries: {
    liveImprovement,
    summary: async () => {
      const runs = (await dbRuns.fetch({}, { sort: { 'record.at': 1 } })).map(strip).map((r: any) => ({ ...r, traces: undefined }));
      const rules = await allRules();
      const audit = (await dbAudit.fetch({}, { sort: { at: 1 } })).map(({ _id, ...a }: any) => a).slice(-50);
      return { runs, rules, audit };
    },
    run: async (args: unknown) => {
      const { runId } = z.object({ runId: z.string() }).parse(args);
      const d: any = await dbRuns.findOne({ _id: runId } as any);
      if (!d) throw new Error(`no run ${runId}`);
      return RunResult.parse(d.record);
    },
    costar: async (args: unknown) => {
      const { prompt } = z.object({ prompt: z.string().min(1).max(4000) }).parse(args);
      const scores = scorePrompt(prompt); const gaps = missing(scores);
      let resolver = 'atlas-vector-search+voyage'; let lexicon: any[] = [];
      try { lexicon = (await vectorResolve(prompt, 3)).map(({ record, score }) => ({ ...record, score })); }
      catch (e: any) { resolver = `unavailable: ${e?.message ?? e}`; }
      await dbCostar.insertOne({ record: { prompt, scores, missing: gaps, at: new Date().toISOString() }, body: '' } as any);
      return { scores, missing: gaps, ask: sideConversation(gaps), ui: uiSpec(gaps), lexicon, resolver };
    },
    memoryTypes: async () => ({
      procedural: await dbRules.countDocuments({}), episodic: await dbRuns.countDocuments({}),
      semantic: await dbLexicon.countDocuments({}), taxonomic: await dbFailures.countDocuments({}),
      receipts: await dbAudit.countDocuments({}),
      vectorIndex: await vectorIndexStatus().catch((e: any) => [{ name: 'error', status: String(e?.message ?? e) }]),
    }),
  },

  mutations: {
    runEvaluation: async () => {
      const n = (await dbRuns.countDocuments({})) + 1;
      const r = await runOnce(`run_${String(n).padStart(3, '0')}`);
      return { ...r, traces: undefined };
    },
    approveRule: async () => {
      throw new Error('Review the exact proposal with RRFlow to approve a harness change.');
    },
    revertRule: async () => {
      throw new Error('Reversion requires a version-bound human review and an audit receipt.');
    },
    seed: async () => {
      for (const c of SEED_FAILURES) await dbFailures.upsertOne({ _id: c.category_id } as any, { $set: { record: c, body: c.why_it_matters } });
      const embedded = await embedLexicon(SEED_LEXICON).catch(() => 0);
      const index = await ensureVectorIndex().catch((e: any) => ({ created: false, indexes: [{ name: 'error', status: String(e?.message ?? e) }] }));
      return { failures: SEED_FAILURES.length, lexiconEmbedded: embedded, vectorIndex: index };
    },
    ensureIndexes: async () => ensureVectorIndex(),
    reset: async () => {
      throw new Error('Rules and audit receipts are retained. Start a new experiment instead.');
    },
  },
});
