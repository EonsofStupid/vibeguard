/**
 * Self-improvement · RRFlow on Raindrop.
 * The harness's own improvement, run by run: what changed the leash, what the agent diagnosed, how it graded itself,
 * and where Raindrop recorded each step (interaction, self-diagnosis, feedback/edit/agent signals, eval run, comparison).
 * Data comes from one Atlas aggregation ($setWindowFields + $lookup) — see server/harness/rrflow.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { modelenceMutation, modelenceQuery } from '@modelence/react-query';
import { toast } from 'react-hot-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/client/components/ui/Tooltip';
import { cn } from '@/client/lib/utils';

export type RaindropStatus = { tracing: boolean; evals: boolean; sent: number; failed: number; skipped: number; last_at: string | null; dashboard: string };
export type Emission = { at: string; kind: string; name: string; event_id: string; status: string; sentiment?: string; detail?: string; url?: string; error?: string; ref?: Record<string, unknown> };
type Change = { at: string; event: string; rule_id: string; version: number; status: string; actor: string; reason?: string };
type Step = {
  run_id: string; at: string; rules_active: string[]; heldout: { passed: number; total: number; pass_rate: number; ci95: [number, number] };
  train: { passed: number; total: number }; false_blocks: number; blocks: number; paid_attempts: number; proposed: string[];
  prev_run: string | null; delta: number | null; rules_delta: number | null;
  changes: Change[]; proposals: { rule_id: string; category: string; status: string; action: string; derived_from?: string }[];
  diagnoses: { category: string; count: number }[]; grade: string | null; emissions: Emission[];
  raindrop: { interaction_id?: string; eval_status: string; eval_run_id?: string; eval_url?: string; compare_url?: string; compare_with?: string; verdicts?: { passed: number; failed: number; total: number }; error?: string };
};
type Totals = { runs: number; first: { run_id: string; passed: number; total: number } | null; last: { run_id: string; passed: number; total: number } | null; improvement: number; decisions: number; approved: number; reverted: number; narrowed: number; diagnoses: number; false_blocks: number; eval_runs: number; comparisons: number };
export type SelfImprovement = { status: RaindropStatus; totals: Totals; steps: Step[]; feed: Emission[]; glosses: Record<string, { title: string; why: string; severity: string }>; kinds: { kind: string; status: string; n: number }[] };

/** Hover / focus tooltip in the house style. Base UI positions it in a portal, so it never clips inside scrolling lists. */
export function Tip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className={cn('cursor-help underline decoration-dotted decoration-muted/70 underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-cobalt rounded-sm', className)} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs border border-line bg-surface px-3 py-2 text-xs leading-snug text-text shadow-[0_12px_32px_rgba(0,0,0,0.45)] transition-[opacity,transform] duration-150 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 [&_[data-slot=arrow]]:text-surface">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Numbers count up to their value (300 ms, ease-out) so a change is seen, not just read. */
function useCountUp(value: number, ms = 420) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value;
    if (a === b) return;
    let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - k, 3); setShown(Math.round(a + (b - a) * e)); if (k < 1) raf = requestAnimationFrame(tick); else from.current = b; };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

const GRADE: Record<string, { label: string; cls: string; dot: string }> = {
  heldout_improved: { label: 'improved', cls: 'text-verdant border-verdant/40 bg-verdant/10', dot: 'bg-verdant shadow-[0_0_10px_var(--color-verdant)]' },
  heldout_flat: { label: 'flat', cls: 'text-muted border-line bg-raised', dot: 'bg-muted' },
  heldout_regressed: { label: 'regressed', cls: 'text-ember border-ember/40 bg-ember/10', dot: 'bg-ember shadow-[0_0_10px_var(--color-ember)]' },
  false_block: { label: 'false block', cls: 'text-ember border-ember/40 bg-ember/10', dot: 'bg-ember' },
};
const KIND: Record<string, string> = { interaction: 'bg-cobalt/20 text-cobalt', event: 'bg-signal/15 text-signal', signal: 'bg-verdant/15 text-verdant', self_diagnosis: 'bg-ember/15 text-ember', eval: 'bg-cobalt/20 text-cobalt' };
const KIND_TIP: Record<string, string> = {
  interaction: 'One Raindrop interaction per harness run: a tool span per task (attempt → guard → judge) and the held-out metric as the output.',
  event: 'An AI event: a proposal (input = the failing evidence, output = the rule the agent wrote) or a COSTAR check.',
  signal: 'A typed Raindrop signal: feedback (human approve/revert), edit (the narrowed re-proposal) or agent (the harness grading its own run).',
  self_diagnosis: 'The agent diagnosing its own training failure — a Raindrop Self Diagnostics signal, category = failure category.',
  eval: 'Raindrop evals: the run replayed over the frozen task dataset, graded by the deterministic judge as a local evaluator, compared with the previous run.',
};

function Delta({ d }: { d: number | null }) {
  if (d === null) return <span className="font-mono text-[11px] text-muted">first run</span>;
  const tone = d > 0 ? 'text-verdant border-verdant/40 bg-verdant/10' : d < 0 ? 'text-ember border-ember/40 bg-ember/10' : 'text-muted border-line bg-raised';
  return <span className={cn('animate-fade-up rounded-full border px-2 py-0.5 font-mono text-[11px]', tone)}>{d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}{d}</span>;
}

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]', className)}>{children}</span>;
}

export default function SelfImprovementPanel() {
  const qc = useQueryClient();
  const q = useQuery({ ...modelenceQuery<SelfImprovement>('harness.selfImprovement'), refetchInterval: 5000 });
  const backfill = useMutation({ ...modelenceMutation<{ replayed: string[] }>('harness.raindropBackfill'), onSuccess: (r) => { toast.success(`replayed ${r.replayed.length} run${r.replayed.length === 1 ? '' : 's'} through Raindrop evals`); qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('harness.') }); }, onError: (e: Error) => toast.error(e.message) });
  const d = q.data;
  const t = d?.totals;
  const improvement = useCountUp(t?.improvement ?? 0);
  const decisions = useCountUp(t?.decisions ?? 0);
  const diagnoses = useCountUp(t?.diagnoses ?? 0);
  const sent = useCountUp(d?.status.sent ?? 0);
  const s = d?.status;

  return (
    <section className="animate-fade-up rounded-xl border border-line bg-surface/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
          Self-improvement · <Tip tip="RRFlow: Reason-Ready-Object flow — every proposal carries its evidence, every human verdict is a signal, every signal shapes the next proposal. Raindrop is where that loop is observed and replayed.">RRFlow</Tip> on <Tip tip="Raindrop (raindrop.ai) — Sentry for AI agents: events, traces, typed signals, self-diagnostics and evals. The harness instruments itself with their SDK (raindrop-ai).">Raindrop</Tip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className={s?.tracing ? 'border-verdant/40 bg-verdant/10 text-verdant' : 'border-ember/40 bg-ember/10 text-ember'}>
            <span className={cn('size-1.5 rounded-full', s?.tracing ? 'animate-pulse-soft bg-verdant' : 'bg-ember')} />
            <Tip tip="Write key present: interactions, tool spans, self-diagnoses and signals are being sent to Raindrop and mirrored to Atlas (raindrop_log).">tracing {s ? (s.tracing ? 'on' : 'off') : '…'}</Tip>
          </Chip>
          <Chip className={s?.evals ? 'border-verdant/40 bg-verdant/10 text-verdant' : 'border-signal/40 bg-signal/10 text-signal'}>
            <span className={cn('size-1.5 rounded-full', s?.evals ? 'animate-pulse-soft bg-verdant' : 'bg-signal')} />
            <Tip tip={s?.evals ? 'Query SDK key present: every run is replayed as a Raindrop eval run over the frozen task dataset and compared with the previous run.' : 'Raindrop evals, datasets and before/after comparisons need a separate Query SDK API key. Create one in the Raindrop dashboard (API keys → Query SDK) and set RAINDROP_QUERY_KEY; tracing works without it.'}>evals {s ? (s.evals ? 'on' : 'needs Query SDK key') : '…'}</Tip>
          </Chip>
          <Chip className="border-line bg-raised text-muted"><Tip tip="Emissions mirrored to Atlas: sent / failed. Raindrop has no read API for events, so the mirror is how this page shows the stream.">{sent} sent{s && s.failed > 0 ? <span className="text-ember"> · {s.failed} failed</span> : null}</Tip></Chip>
          <a href={s?.dashboard ?? 'https://app.raindrop.ai'} target="_blank" rel="noreferrer" className="rounded-full border border-cobalt/50 bg-cobalt/15 px-2 py-0.5 font-mono text-[11px] text-text transition-colors hover:bg-cobalt/30">open Raindrop ↗</a>
          {s?.evals && <button type="button" onClick={() => backfill.mutate({})} disabled={backfill.isPending} className="rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-muted hover:text-text disabled:opacity-50">{backfill.isPending ? 'replaying…' : 'replay runs as evals'}</button>}
        </div>
      </div>

      {/* hero: the improvement, the decisions that caused it, the diagnoses that fed it */}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-ink/60 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted"><Tip tip="Held-out tasks are never used to write rules; they only get measured. The first run has no rules; the latest run loads every approved rule.">held-out, first → latest</Tip></div>
          <div className="mt-1 flex items-baseline gap-2 font-display text-2xl font-bold tracking-tight">
            <span className="text-muted">{t?.first ? `${t.first.passed}/${t.first.total}` : '—'}</span><span className="text-line">→</span>
            <span className="text-cobalt">{t?.last ? `${t.last.passed}/${t.last.total}` : '—'}</span>
            <span className={cn('font-mono text-base', improvement > 0 ? 'text-verdant' : improvement < 0 ? 'text-ember' : 'text-muted')}>{improvement > 0 ? '+' : ''}{improvement}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-muted">{t?.runs ?? 0} runs · {t?.false_blocks ?? 0} false blocks</div>
        </div>
        <div className="rounded-lg border border-line bg-ink/60 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted"><Tip tip="Only a human can approve or revert. Each decision is a receipt in Atlas and a feedback signal in Raindrop.">human decisions</Tip></div>
          <div className="mt-1 flex items-baseline gap-2 font-display text-2xl font-bold tracking-tight text-verdant">{decisions}<span className="font-mono text-xs text-muted">{t?.approved ?? 0} approved · {t?.reverted ?? 0} reverted</span></div>
          <div className="truncate font-mono text-[11px] text-muted"><Tip tip="After a revert, the agent does not re-propose the same broad detector; it proposes a literal pattern built from the exact evidence that failed — sent to Raindrop as an edit signal.">{t?.narrowed ?? 0} narrowed after a revert</Tip></div>
        </div>
        <div className="rounded-lg border border-line bg-ink/60 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted"><Tip tip="One self-diagnosis per (task, failure category) on the training split — the Self Diagnostics tab in Raindrop. These are what proposals are written from.">self-diagnoses</Tip></div>
          <div className="mt-1 flex items-baseline gap-2 font-display text-2xl font-bold tracking-tight text-ember">{diagnoses}<span className="font-mono text-xs text-muted">→ {d?.steps.reduce((a, x) => a + x.proposals.length, 0) ?? 0} proposals</span></div>
          <div className="truncate font-mono text-[11px] text-muted">{t?.eval_runs ?? 0} eval runs · {t?.comparisons ?? 0} comparisons</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* timeline */}
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">run by run · what changed, what it did, where Raindrop has it</div>
          {!d ? <p className="mt-3 text-sm text-muted">loading…</p> : d.steps.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No runs yet. Run an evaluation: the first run has no rules, its failures become self-diagnoses, and the first proposal appears in the queue.</p>
          ) : (
            <ol className="relative mt-3 space-y-3 border-l border-line pl-5">
              {d.steps.map((st, i) => {
                const g = st.grade ? GRADE[st.grade] : null;
                return (
                  <li key={st.run_id} className="relative animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <span className={cn('absolute -left-[26px] top-1.5 size-3 rounded-full border-2 border-ink', g ? g.dot : i === 0 ? 'bg-cobalt' : 'bg-muted')} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{st.run_id}</span>
                      <Tip tip={`Wilson 95% interval ${Math.round(st.heldout.ci95[0] * 100)}–${Math.round(st.heldout.ci95[1] * 100)}%. N is small; the interval travels with the number.`}><span className="font-mono text-sm text-cobalt">{st.heldout.passed}/{st.heldout.total} held-out</span></Tip>
                      <Delta d={st.delta} />
                      {g && <Tip tip="The harness grades its own run against the previous one and sends the verdict to Raindrop as an agent signal."><Chip className={g.cls}>self-grade: {g.label}</Chip></Tip>}
                      <span className="ml-auto font-mono text-[11px] text-muted">{st.at.replace('T', ' ').slice(5, 16)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-muted">leash:</span>
                      {st.changes.length === 0 ? <span className="font-mono text-muted">{i === 0 ? 'no rules' : 'unchanged'}</span> : st.changes.map((c, k) => (
                        <Tip key={k} tip={`${c.actor} ${c.event}d ${c.rule_id} (v${c.version})${c.reason ? ` — “${c.reason}”` : ''}. Receipt in Atlas; feedback signal (${c.event === 'approve' ? 'POSITIVE' : 'NEGATIVE'}) in Raindrop.`}>
                          <Chip className={c.event === 'approve' ? 'border-verdant/40 bg-verdant/10 text-verdant' : 'border-ember/40 bg-ember/10 text-ember'}>{c.event === 'approve' ? '✓' : '↶'} {c.rule_id}</Chip>
                        </Tip>
                      ))}
                      <span className="font-mono text-muted">· {st.rules_active.length} live{st.rules_delta ? ` (${st.rules_delta > 0 ? '+' : ''}${st.rules_delta})` : ''}</span>
                    </div>
                    {(st.diagnoses.length > 0 || st.proposals.length > 0) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-muted">learned:</span>
                        {st.diagnoses.map((x) => (
                          <Tip key={x.category} tip={<span><b>{d.glosses[x.category]?.title ?? x.category}</b> — {d.glosses[x.category]?.why ?? 'failure category'} <span className="text-muted">({x.count} self-diagnos{x.count === 1 ? 'is' : 'es'} sent to Raindrop)</span></span>}>
                            <Chip className="border-ember/40 bg-ember/10 text-ember">⚠ {x.category} ×{x.count}</Chip>
                          </Tip>
                        ))}
                        {st.proposals.map((p) => (
                          <Tip key={p.rule_id} tip={`${p.rule_id} proposed from this run's failures (${p.category}, ${p.action}) — now ${p.status}.${p.derived_from ? ` Narrowed after ${p.derived_from.replace('reverted:', '')} was reverted: edit signal in Raindrop.` : ' Sent to Raindrop as an AI event with the evidence attached.'}`}>
                            <Chip className={p.status === 'approved' ? 'border-verdant/40 bg-verdant/10 text-verdant' : p.status === 'reverted' ? 'border-ember/40 bg-ember/10 text-ember' : 'border-signal/40 bg-signal/10 text-signal'}>→ {p.rule_id}{p.derived_from ? ' ·narrowed' : ''}</Chip>
                          </Tip>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-muted">raindrop:</span>
                      <Tip tip={KIND_TIP.interaction + ' Search this id in the Raindrop dashboard.'}><Chip className="border-cobalt/40 bg-cobalt/10 text-cobalt">interaction {st.run_id}</Chip></Tip>
                      {st.emissions.filter((e) => e.kind === 'self_diagnosis').length > 0 && <Chip className="border-line bg-raised text-muted">{st.emissions.filter((e) => e.kind === 'self_diagnosis' && e.status === 'sent').length} diagnoses</Chip>}
                      {st.raindrop.eval_status === 'complete' && st.raindrop.eval_url ? (
                        <a href={st.raindrop.eval_url} target="_blank" rel="noreferrer" className="rounded-full border border-cobalt/50 bg-cobalt/15 px-2 py-0.5 font-mono text-[11px] text-text transition-colors hover:bg-cobalt/30">eval run {st.raindrop.verdicts ? `${st.raindrop.verdicts.passed}/${st.raindrop.verdicts.total}` : ''} ↗</a>
                      ) : st.raindrop.eval_status === 'pending' ? <Chip className="border-signal/40 bg-signal/10 text-signal"><span className="size-1.5 animate-pulse-soft rounded-full bg-signal" />eval run pending</Chip>
                      : st.raindrop.eval_status === 'failed' ? <Tip tip={st.raindrop.error ?? 'eval failed'}><Chip className="border-ember/40 bg-ember/10 text-ember">eval failed</Chip></Tip>
                      : <Tip tip="Replay this run as a Raindrop eval run: needs the Query SDK key (RAINDROP_QUERY_KEY)."><Chip className="border-line bg-raised text-muted">eval: off</Chip></Tip>}
                      {st.raindrop.compare_url && <a href={st.raindrop.compare_url} target="_blank" rel="noreferrer" className="rounded-full border border-verdant/50 bg-verdant/10 px-2 py-0.5 font-mono text-[11px] text-verdant transition-colors hover:bg-verdant/25">compare {st.raindrop.compare_with} → {st.run_id} ↗</a>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* live stream */}
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">raindrop stream · newest first</div>
            <span className="font-mono text-[10px] text-muted">{d?.kinds.filter((k) => k.status === 'sent').map((k) => `${k.kind} ${k.n}`).join(' · ')}</span>
          </div>
          <ul className="mt-2 max-h-[26rem] space-y-1 overflow-auto pr-1">
            {(d?.feed ?? []).map((e) => (
              <li key={`${e.at}-${e.event_id}-${e.name}`} className="animate-fade-up flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-line/60 bg-ink/50 px-2 py-1 font-mono text-[11px]">
                <span className={cn('size-1.5 shrink-0 rounded-full', e.status === 'sent' ? 'bg-verdant' : e.status === 'failed' ? 'bg-ember' : 'bg-muted')} title={e.status} />
                <span className="text-muted">{e.at.replace('T', ' ').slice(11, 19)}</span>
                <Tip tip={KIND_TIP[e.kind] ?? e.kind} className="no-underline"><span className={cn('rounded px-1.5 py-0.5 text-[10px]', KIND[e.kind] ?? 'bg-raised text-muted')}>{e.kind.replace('_', ' ')}</span></Tip>
                <span className={cn(e.sentiment === 'POSITIVE' ? 'text-verdant' : e.sentiment === 'NEGATIVE' ? 'text-ember' : 'text-text')}>{e.name}</span>
                <span className="text-muted">{e.event_id}</span>
                {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-cobalt hover:underline">↗</a>}
                {e.error ? <span className="basis-full truncate text-ember" title={e.error}>{e.error}</span> : e.detail ? <span className="basis-full truncate text-muted" title={e.detail}>{e.detail}</span> : null}
              </li>
            ))}
            {d && d.feed.length === 0 && <li className="text-xs text-muted">Nothing sent yet. Run an evaluation — the interaction, its tool spans and self-diagnoses appear here as they are sent.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
