/** The VibeGuard harness as a Modelence module: queries for the judges' view, mutations for the human gate. */
import z from 'zod';
import { Module } from 'modelence/server';
import { dbRules, dbRuns, dbLexicon, dbFailures, dbAudit, dbCostar } from './db';
import { allRules, approve, revert, GateError } from './gate';
import { runOnce } from './loop';
import { scorePrompt, missing, sideConversation, uiSpec } from './costar';
import { vectorResolve, embedLexicon } from './semantic';
import { Actor, RunResult } from './schemas';
import { SEED_FAILURES, SEED_LEXICON } from './seed';

const strip = (d: any) => d.record;

/** A signed-in Modelence user is the actor of record; an anonymous dashboard viewer acts as the `human:` actor it names.
 *  The gate only checks the human/agent prefix — binding identity to auth is the production hardening, not the demo. */
type Ctx = { user?: { handle?: string } | null } | undefined;
const whoIs = (ctx: Ctx, fallback: string) => (ctx?.user?.handle ? `human:${ctx.user.handle}` : fallback);

export default new Module('harness', {
  configSchema: {
    voyageApiKey: { type: 'string', default: '', isPublic: false },
  },
  stores: [dbRules, dbRuns, dbLexicon, dbFailures, dbAudit, dbCostar],

  queries: {
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
    }),
  },

  mutations: {
    runEvaluation: async () => {
      const n = (await dbRuns.countDocuments({})) + 1;
      const r = await runOnce(`run_${String(n).padStart(3, '0')}`);
      return { ...r, traces: undefined };
    },
    approveRule: async (args: unknown, ctx: Ctx) => {
      const { ruleId, actor } = z.object({ ruleId: z.string(), actor: Actor }).parse(args);
      try { return await approve(ruleId, whoIs(ctx, actor)); } catch (e) { if (e instanceof GateError) throw new Error(e.message); throw e; }
    },
    revertRule: async (args: unknown, ctx: Ctx) => {
      const { ruleId, actor, reason } = z.object({ ruleId: z.string(), actor: Actor, reason: z.string().default('') }).parse(args);
      try { return await revert(ruleId, whoIs(ctx, actor), reason); } catch (e) { if (e instanceof GateError) throw new Error(e.message); throw e; }
    },
    seed: async () => {
      for (const c of SEED_FAILURES) await dbFailures.upsertOne({ _id: c.category_id } as any, { $set: { record: c, body: c.why_it_matters } });
      const embedded = await embedLexicon(SEED_LEXICON).catch(() => 0);
      return { failures: SEED_FAILURES.length, lexiconEmbedded: embedded };
    },
    reset: async () => {
      for (const s of [dbRules, dbRuns, dbAudit, dbCostar]) await s.deleteMany({});
      return { ok: true };
    },
  },
});
