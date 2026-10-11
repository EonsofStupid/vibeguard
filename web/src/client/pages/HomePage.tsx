/**
 * VibeGuard judges' view: the harness loop, live from Atlas.
 * run → judge → propose rule → human gate → next run loads it.
 */
import { useCallback, useEffect, useMemo, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { modelenceMutation, modelenceQuery } from '@modelence/react-query';
import { toast } from 'react-hot-toast';
import Page from '@/client/components/Page';
import LiveImprovement from '@/client/components/improvement/LiveImprovement';
import { KnowledgeDrop } from '@/client/components/improvement/KnowledgeDrop';
import ChatPanel from '@/client/components/chat/ChatPanel';
import { cn } from '@/client/lib/utils';

// ---- wire types (mirror src/server/harness/schemas.ts) ----
type Metrics = { passed: number; total: number; pass_rate: number; ci95: [number, number] };
type Run = {
  run_id: string; at: string; rules_active: string[]; train: Metrics; heldout: Metrics;
  paid_attempts: number; blocks: number; false_blocks: number; proposed: string[];
};
type Rule = {
  rule_id: string; version: number; status: 'proposed' | 'approved' | 'reverted'; direction: 'tighten' | 'loosen';
  category: string; trigger: { type: string; pattern: string }; action: string; user_message: string;
  origin: { run_id: string; task_id: string; failure_category: string }; proposed_by: string;
  approved_by?: string | null; created_at: string; updated_at: string;
};
type Audit = { at: string; event: string; rule_id?: string; experiment_id?: string; run_id?: string; version?: number; status?: string; actor?: string; reason?: string };
type Summary = { runs: Run[]; rules: Rule[]; audit: Audit[] };
type MemoryTypes = { procedural: number; episodic: number; semantic: number; taxonomic: number; receipts: number };
type UiCard = { id: string; question: string; options: { label: string; text: string }[]; freeText: boolean };
type Costar = {
  scores: { dimension: string; p_present: number; evidence: string[] }[];
  missing: string[]; ask: string[];
  ui: { type: 'form'; version: number; cards: UiCard[]; done: boolean };
  lexicon: { entry_id: string; phrase: string; canonical_label: string; stack?: string | null; teach: string; score: number }[];
  resolver: string;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const STATUS_CLASS: Record<Rule['status'], string> = {
  proposed: 'bg-signal/15 text-signal border-signal/40',
  approved: 'bg-verdant/15 text-verdant border-verdant/40',
  reverted: 'bg-ember/15 text-ember border-ember/40',
};

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{children}</div>;
}
function Card({ className, children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) {
  return <section style={style} className={cn('animate-fade-up rounded-xl border border-line bg-surface p-4 md:p-5', className)}>{children}</section>;
}
function Btn({ className, tone = 'neutral', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'neutral' | 'go' | 'stop' | 'accent' }) {
  const tones = {
    neutral: 'border-line bg-raised text-text hover:border-muted',
    go: 'border-verdant/50 bg-verdant/15 text-verdant hover:bg-verdant/25',
    stop: 'border-ember/50 bg-ember/10 text-ember hover:bg-ember/20',
    accent: 'border-cobalt/60 bg-cobalt/20 text-text hover:bg-cobalt/30',
  };
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
        tones[tone], className,
      )}
    />
  );
}

export default function HomePage() {
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('harness.') }), [qc]);

  const summary = useQuery({ ...modelenceQuery<Summary>('harness.summary'), refetchInterval: 6000 });
  const memory = useQuery({ ...modelenceQuery<MemoryTypes>('harness.memoryTypes'), refetchInterval: 6000 });

  const runEval = useMutation({ ...modelenceMutation<Run>('harness.runEvaluation'), onSuccess: (r) => { toast.success(`${r.run_id}: held-out ${r.heldout.passed}/${r.heldout.total}`); refresh(); } });
  const seed = useMutation({ ...modelenceMutation<{ failures: number; lexiconEmbedded: number }>('harness.seed'), onSuccess: (r) => { toast.success(`seeded ${r.failures} failure categories, embedded ${r.lexiconEmbedded} lexicon entries`); refresh(); } });

  const runs = summary.data?.runs ?? [];
  const rules = summary.data?.rules ?? [];
  const audit = summary.data?.audit ?? [];
  const latest = runs[runs.length - 1];
  const first = runs[0];
  const proposedCount = rules.filter((r) => r.status === 'proposed').length;

  return (
    <Page seo={{ title: 'Build, learn, improve' }}>
      <LiveImprovement />
      <ChatPanel />

      {/* headline */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold md:text-2xl">Recorded examples</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Replay saved answers to see how a failure becomes a proposed boundary. These examples demonstrate the workflow;
            their simulated attempts do not measure a live model improving.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn tone="accent" onClick={() => runEval.mutate({})} disabled={runEval.isPending}>
            {runEval.isPending ? <span className="animate-pulse-soft">Replaying examples…</span> : 'Replay recorded examples'}
          </Btn>
          <Btn onClick={() => seed.mutate({})} disabled={seed.isPending}>Add example terminology</Btn>
        </div>
      </div>

      {runEval.isPending && <KnowledgeDrop title="A replay lets you inspect the steps." explanation="These answers were recorded in advance. Replaying them helps explain a rule and its effects without making a new model request." term="Deterministic replay" whyNow="The recorded examples are running. Their attempt count is simulated." source="Recorded example runner · scripted candidate list" />}
      {(summary.isError || memory.isError || runEval.isError || seed.isError) && <p role="alert" className="rounded-lg border border-ember/40 bg-ember/10 p-3 text-sm">{[summary.error, memory.error, runEval.error, seed.error].filter(Boolean).map(error => error instanceof Error ? error.message : 'The example request failed.').join(' ')}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Replay pass rate" value={latest ? pct(latest.heldout.pass_rate) : '—'} sub={latest ? `${latest.heldout.passed}/${latest.heldout.total} · CI ${pct(latest.heldout.ci95[0])}–${pct(latest.heldout.ci95[1])}` : 'no recorded runs yet'} tone="cobalt" />
        <Kpi label="Replay score change" value={latest && first && runs.length > 1 ? `${latest.heldout.pass_rate >= first.heldout.pass_rate ? '+' : ''}${Math.round((latest.heldout.pass_rate - first.heldout.pass_rate) * 100)} pts` : '—'} sub={runs.length > 1 ? `${first.run_id} → ${latest.run_id}` : 'needs ≥2 recorded runs'} tone="cobalt" />
        <Kpi label="Useful answers blocked" value={latest ? String(latest.false_blocks) : '—'} sub={latest ? `${latest.blocks} blocks · ${latest.paid_attempts} simulated attempts` : ''} tone={latest && latest.false_blocks > 0 ? 'ember' : 'verdant'} />
        <Kpi label="Recorded rules" value={`${rules.filter((r) => r.status === 'approved').length} approved`} sub={`${proposedCount} proposed · ${rules.filter((r) => r.status === 'reverted').length} reverted`} tone="signal" />
      </div>

      {/* chart + memory */}
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card>
          <div className="flex items-baseline justify-between">
            <Label>Recorded example scores · Wilson 95% CI</Label>
            <div className="flex gap-3 text-xs text-muted">
              <span><i className="mr-1 inline-block h-2 w-3 bg-cobalt align-middle" />held-out</span>
              <span><i className="mr-1 inline-block h-2 w-3 bg-muted align-middle" />train</span>
              <span><i className="mr-1 inline-block size-2 rotate-45 bg-signal align-middle" />rule approved</span>
            </div>
          </div>
          <PassRateChart runs={runs} />
        </Card>
        <Card>
          <Label>What the workbench remembers</Label>
          <MemoryStrip m={memory.data} />
          <p className="mt-3 text-xs leading-relaxed text-muted">These counts describe application records in Atlas. A saved record alone does not prove that the agent recalled it or improved.</p>
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer text-cobalt">Learn the memory types</summary><p className="mt-2">Procedural: how to act. Episodic: what happened. Semantic: facts and meanings. Taxonomic: how failures are grouped. Receipts preserve the decision trail.</p></details>
        </Card>
      </div>

      {/* rule queue */}
      <Card>
        <div className="flex items-center justify-between">
          <Label>Recorded boundaries · review history</Label>
          <span className="text-xs text-muted">Read-only history · real decisions go through RRFlow</span>
        </div>
        {rules.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No rules yet. Run an evaluation — failures on the train split propose the first one.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {[...rules].sort((a, b) => (a.status === 'proposed' ? -1 : 1) - (b.status === 'proposed' ? -1 : 1) || a.rule_id.localeCompare(b.rule_id)).map((r) => (
              <li key={r.rule_id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{r.rule_id}</span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_CLASS[r.status])}>{r.status}</span>
                    <span className="font-mono text-xs text-muted">v{r.version}</span>
                  </div>
                  <p className="mt-1 text-sm">{r.user_message}</p>
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer text-cobalt focus-visible:ring-2 focus-visible:ring-cobalt">Technical details</summary>
                    <p className="mt-2 font-mono">{r.category} · {r.direction} · {r.action}</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-ink p-3 font-mono text-[11px]">{r.trigger.type}: {r.trigger.pattern}</pre>
                    <p className="mt-2 break-words">Origin {r.origin.run_id} / {r.origin.task_id} · proposed by <span className="font-mono">{r.proposed_by}</span>
                      {r.approved_by ? <> · approved by <span className="font-mono text-verdant">{r.approved_by}</span></> : null}
                    </p>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* costar + audit */}
      <div className="grid gap-3 lg:grid-cols-2">
        <CostarPanel />
        <Card>
          <Label>Receipts · append-only audit</Label>
          {audit.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Every propose / approve / revert writes a receipt here. Nothing is ever deleted.</p>
          ) : (
            <ul className="mt-3 max-h-80 space-y-1 overflow-auto font-mono text-xs">
              {[...audit].reverse().map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex flex-wrap gap-x-2 border-b border-line/60 py-1">
                  <span className="text-muted">{a.at.replace('T', ' ').slice(0, 19)}</span>
                  <span className={cn(a.event === 'approve' ? 'text-verdant' : a.event === 'revert' ? 'text-ember' : 'text-signal')}>{a.event}</span>
                  {a.rule_id && <span>{a.rule_id}</span>}
                  {a.experiment_id && <span className="break-all">{a.experiment_id}</span>}
                  {a.run_id && a.run_id !== a.experiment_id && <span className="break-all">{a.run_id}</span>}
                  {typeof a.version === 'number' && <span className="text-muted">v{a.version}{a.status ? ` → ${a.status}` : ''}</span>}
                  {a.status && typeof a.version !== 'number' && <span className="text-muted">{a.status}</span>}
                  {a.actor && <span className="text-muted">{a.actor}</span>}
                  {a.reason ? <span className="text-muted">“{a.reason}”</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* runs table */}
      <Card>
        <Label>Recorded run history</Label>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No runs recorded.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="text-muted">
                <tr>{['run', 'at', 'rules active', 'train', 'held-out', 'CI (held-out)', 'blocks', 'false', 'proposed'].map((h) => <th key={h} className="pb-2 pr-3 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.run_id} className="border-t border-line/60">
                    <td className="py-1.5 pr-3">{r.run_id}</td>
                    <td className="py-1.5 pr-3 text-muted">{r.at.replace('T', ' ').slice(0, 19)}</td>
                    <td className="py-1.5 pr-3">{r.rules_active.join(', ') || '—'}</td>
                    <td className="py-1.5 pr-3">{r.train.passed}/{r.train.total}</td>
                    <td className="py-1.5 pr-3 text-cobalt">{r.heldout.passed}/{r.heldout.total}</td>
                    <td className="py-1.5 pr-3 text-muted">{pct(r.heldout.ci95[0])}–{pct(r.heldout.ci95[1])}</td>
                    <td className="py-1.5 pr-3">{r.blocks}</td>
                    <td className={cn('py-1.5 pr-3', r.false_blocks > 0 ? 'text-ember' : 'text-verdant')}>{r.false_blocks}</td>
                    <td className="py-1.5 pr-3 text-signal">{r.proposed.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="pb-6 text-xs text-muted">
        About the recorded examples: the judge and rule writer share regex detectors, and answers are scripted.
        Replay scores explain the harness mechanics; they do not establish live model improvement. Small samples carry a Wilson interval.
        The review pattern applies RRFlow ADR-0002: a durable change needs a decision, a check and a receipt.
      </p>
    </Page>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'cobalt' | 'verdant' | 'ember' | 'signal' }) {
  const color = { cobalt: 'text-cobalt', verdant: 'text-verdant', ember: 'text-ember', signal: 'text-signal' }[tone];
  return (
    <Card className="p-3 md:p-4">
      <Label>{label}</Label>
      <div className={cn('mt-1 font-display text-2xl font-bold tracking-tight md:text-3xl', color)}>{value}</div>
      {sub ? <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{sub}</div> : null}
    </Card>
  );
}

function MemoryStrip({ m }: { m?: MemoryTypes }) {
  const rows: [keyof MemoryTypes, string][] = [
    ['procedural', 'Boundaries'], ['episodic', 'Past attempts'], ['semantic', 'Facts and terminology'], ['taxonomic', 'Failure types'], ['receipts', 'Decision trail'],
  ];
  return (
    <ul className="mt-3 space-y-1.5">
      {rows.map(([k, coll]) => (
        <li key={k} className="flex items-center justify-between rounded-md bg-raised px-3 py-1.5 text-sm">
          <span>{coll} <span className="font-mono text-[10px] text-muted">· {k}</span></span>
          <span className="font-mono">{m ? m[k] : '…'}</span>
        </li>
      ))}
    </ul>
  );
}

function PassRateChart({ runs }: { runs: Run[] }) {
  const W = 640, H = 236, L = 36, R = 12, T = 40, B = 28;
  const n = runs.length;
  const x = (i: number) => (n <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (p: number) => T + (1 - p) * (H - T - B);
  const path = (sel: (r: Run) => Metrics) => runs.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(sel(r).pass_rate).toFixed(1)}`).join(' ');
  const approvals = useMemo(() => runs.map((r, i) => {
    const prev = i ? new Set(runs[i - 1].rules_active) : new Set<string>();
    return r.rules_active.filter((id) => !prev.has(id));
  }), [runs]);

  if (!n) {
    return <div className="mt-3 flex h-48 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted">Run an evaluation to start the curve.</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Pass rate per run with 95% confidence intervals">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={L - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="var(--color-muted)" fontFamily="var(--font-mono)">{pct(g)}</text>
        </g>
      ))}
      <path d={path((r) => r.train)} fill="none" stroke="var(--color-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={path((r) => r.heldout)} fill="none" stroke="var(--color-cobalt)" strokeWidth={2.5} strokeLinejoin="round" />
      {runs.map((r, i) => (
        <g key={r.run_id}>
          <line x1={x(i)} x2={x(i)} y1={y(r.heldout.ci95[0])} y2={y(r.heldout.ci95[1])} stroke="var(--color-cobalt)" strokeOpacity={0.55} strokeWidth={1.5} />
          <line x1={x(i) - 4} x2={x(i) + 4} y1={y(r.heldout.ci95[0])} y2={y(r.heldout.ci95[0])} stroke="var(--color-cobalt)" strokeOpacity={0.55} />
          <line x1={x(i) - 4} x2={x(i) + 4} y1={y(r.heldout.ci95[1])} y2={y(r.heldout.ci95[1])} stroke="var(--color-cobalt)" strokeOpacity={0.55} />
          <circle cx={x(i)} cy={y(r.heldout.pass_rate)} r={4} fill="var(--color-ink)" stroke="var(--color-cobalt)" strokeWidth={2} />
          <circle cx={x(i)} cy={y(r.train.pass_rate)} r={2.5} fill="var(--color-muted)" />
          <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontFamily="var(--font-mono)">{r.run_id.replace('run_', 'r')}</text>
          {approvals[i].length > 0 && (
            <g>
              <rect x={x(i) - 4} y={T - 14} width={8} height={8} transform={`rotate(45 ${x(i)} ${T - 10})`} fill="var(--color-signal)" />
              <text x={x(i)} y={T - 18} textAnchor="middle" fontSize={9} fill="var(--color-signal)" fontFamily="var(--font-mono)">{approvals[i].join(' ')}</text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

function CostarPanel() {
  const [draft, setDraft] = useState('add stripe checkout to my next.js app');
  const [prompt, setPrompt] = useState('');
  const [trail, setTrail] = useState<{ prompt: string; present: number }[]>([]);
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const q = useQuery({ ...modelenceQuery<Costar>('harness.costar', { prompt }), enabled: prompt.length > 0, staleTime: Infinity });
  const d = q.data;
  const present = d ? d.scores.filter((s) => s.p_present >= 0.5).length : 0;
  // record each scored prompt once (completeness trail: before -> after each answer)
  useEffect(() => {
    if (d && prompt) setTrail((t) => (t.length && t[t.length - 1].prompt === prompt ? t : [...t, { prompt, present }]));
  }, [d, prompt, present]);
  const submit = (text: string) => { const next = text.trim(); setDraft(next); setPrompt(next); };
  const answer = (text: string) => submit(`${prompt} ${text}`);
  return (
    <Card>
      <Label>Give the agent a clearer starting point</Label>
      <p className="mt-2 text-sm text-muted">Describe what you want to build. We will suggest up to two useful details and explain relevant terminology.</p>
      <textarea
        aria-label="What you want to build"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        className="mt-3 w-full resize-y rounded-md border border-line bg-raised p-2.5 font-mono text-sm text-text placeholder:text-muted focus:border-cobalt focus:outline-none"
        placeholder="What would you like to make?"
      />
      <div className="mt-2 flex items-center gap-2">
        <Btn tone="accent" onClick={() => setPrompt(draft.trim())} disabled={!draft.trim() || q.isFetching}>{q.isFetching ? 'scoring…' : 'Check prompt'}</Btn>
        {d ? <details className="text-xs text-muted"><summary className="cursor-pointer">Recall source</summary><p className="mt-1 break-words">{d.resolver}</p></details> : null}
      </div>
      {q.isError && <p role="alert" className="mt-3 text-sm text-ember">{q.error instanceof Error ? q.error.message : 'The prompt check could not be completed.'}</p>}
      {d && (
        <div className="mt-3 space-y-3">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
            {d.scores.map((s) => (
              <li key={s.dimension} className="text-xs">
                <div className="flex justify-between"><span className="capitalize">{s.dimension}</span><span className={cn('font-mono', s.p_present < 0.5 ? 'text-signal' : 'text-verdant')}>{s.p_present.toFixed(2)}</span></div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-raised"><div className={cn('h-full transition-all', s.p_present < 0.5 ? 'bg-signal' : 'bg-verdant')} style={{ width: pct(s.p_present) }} /></div>
              </li>
            ))}
          </ul>
          {d.ui.done ? (
            <p className="text-sm text-verdant">Complete enough to start. No side-conversation needed — the agent gets to work.</p>
          ) : (
            <div>
              <Label>A couple of details that would help</Label>
              <ul className="mt-1 space-y-1 text-sm">{d.ask.map((a) => <li key={a} className="rounded-md border border-line bg-raised px-2.5 py-1.5">{a}</li>)}</ul>
            </div>
          )}
          {d.lexicon.length > 0 && (
            <div>
              <Label>Words for what you are building</Label>
              <ul className="mt-1 space-y-1 text-xs">
                {d.lexicon.map((l) => (
                  <li key={l.entry_id} className="flex flex-wrap items-center gap-x-2 rounded-md bg-raised px-2.5 py-1.5">
                    <span className="text-muted">“{l.phrase}”</span><span>→</span>
                    <span className="font-mono text-cobalt">{l.canonical_label}</span>
                    {l.stack ? <span className="font-mono text-muted">[{l.stack}]</span> : null}
                    {l.teach ? <span className="basis-full text-muted">{l.teach}</span> : null}
                    <details className="basis-full text-[11px] text-muted"><summary className="cursor-pointer">Why this appeared</summary><p className="mt-1">Retrieved for your prompt · terminology entry {l.entry_id} · match score {l.score.toFixed(3)}. This is a reference explanation, not a newly verified project fact.</p></details>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <KnowledgeDrop title="A useful prompt tells the agent what success looks like." explanation="A few details about the goal, audience and desired result can prevent a confident answer to the wrong question." term="COSTAR" whyNow={d.ask.length > 0 ? 'The prompt check found gaps and selected up to two follow-up questions.' : 'The prompt check found enough information to begin.'} source="Curated prompt guide · Context, Objective, Style, Tone, Audience, Response format" />
        </div>
      )}
    </Card>
  );
}
