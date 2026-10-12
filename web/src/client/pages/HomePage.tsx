/**
 * VibeGuard — the inspection ledger. The harness loop, live from Atlas:
 * attempt → judge → propose → human decides → next run loads the rules.
 */
import { useCallback, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { modelenceMutation, modelenceQuery } from '@modelence/react-query';
import { useSession } from 'modelence/client';
import { toast } from 'react-hot-toast';
import Page from '@/client/components/Page';
import { cn } from '@/client/lib/utils';

// ---- wire types (mirror src/server/harness/schemas.ts) ----
type Metrics = { passed: number; total: number; pass_rate: number; ci95: [number, number] };
type Run = {
  run_id: string; at: string; rules_active: string[]; train: Metrics; heldout: Metrics;
  paid_attempts: number; blocks: number; false_blocks: number; proposed: string[];
};
type Evidence = { prompt: string; matched: string; snippet: string; detector: string };
type Rule = {
  rule_id: string; version: number; status: 'proposed' | 'approved' | 'reverted'; direction: 'tighten' | 'loosen';
  category: string; trigger: { type: string; pattern: string }; action: string; user_message: string;
  origin: { run_id: string; task_id: string; failure_category: string; evidence?: Evidence; derived_from?: string }; proposed_by: string;
  approved_by?: string | null; created_at: string; updated_at: string;
};
type Audit = { at: string; event: string; rule_id: string; version: number; status: string; actor: string; reason?: string };
type Summary = { runs: Run[]; rules: Rule[]; audit: Audit[] };
type Trace = { task_id: string; split: 'train' | 'heldout'; attempts: number; blocked_by: string[]; false_blocks: number; verdict: { passed: boolean; failures: string[] } };
type RunDetail = Run & { traces: Trace[] };
type MemoryTypes = { procedural: number; episodic: number; semantic: number; taxonomic: number; receipts: number; knowledge?: number; raindrop?: string };
type Explanation = { id: string; kind: string; title: string; text: string; path?: string; swebok: string; layman?: string; score: number };
type UiCard = { id: string; question: string; options: { label: string; text: string }[]; freeText: boolean };
type Costar = {
  scores: { dimension: string; p_present: number; evidence: string[] }[];
  missing: string[]; ask: string[];
  ui: { type: 'form'; version: number; cards: UiCard[]; done: boolean };
  lexicon: { entry_id: string; phrase: string; canonical_label: string; stack?: string | null; teach: string; score: number }[];
  resolver: string;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const when = (iso: string) => iso.replace('T', ' ').slice(0, 16);
const STATUS: Record<Rule['status'], { word: string; cls: string }> = {
  proposed: { word: 'Needs a decision', cls: 'text-flag' },
  approved: { word: 'In force', cls: 'text-pass' },
  reverted: { word: 'Reverted', cls: 'text-stop' },
};

function H2({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink pb-2">
      <h2 className="wide text-base font-semibold">{children}</h2>
      {aside && <div className="text-sm text-mute">{aside}</div>}
    </div>
  );
}

function Btn({ className, kind = 'quiet', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'quiet' | 'approve' | 'revert' }) {
  const kinds = {
    primary: 'bg-ink text-paper hover:bg-ink/90',
    quiet: 'border border-ink/40 bg-sheet text-ink hover:border-ink',
    approve: 'bg-pass text-sheet hover:bg-pass/90',
    revert: 'border border-stop/60 bg-sheet text-stop hover:bg-stop/10',
  };
  return <button type="button" {...props} className={cn('inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45', kinds[kind], className)} />;
}

export default function HomePage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const actor = user ? `human:${user.handle}` : 'human:judge';
  const refresh = useCallback(() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('harness.') }), [qc]);

  const summary = useQuery({ ...modelenceQuery<Summary>('harness.summary'), refetchInterval: 6000 });
  const memory = useQuery({ ...modelenceQuery<MemoryTypes>('harness.memoryTypes'), refetchInterval: 6000 });

  const runEval = useMutation({ ...modelenceMutation<Run>('harness.runEvaluation'), onSuccess: (r) => { toast.success(`${r.run_id}: held-out ${r.heldout.passed} of ${r.heldout.total}`); refresh(); } });
  const seed = useMutation({ ...modelenceMutation<{ failures: number; lexiconEmbedded: number }>('harness.seed'), onSuccess: (r) => { toast.success(`Seeded ${r.failures} failure categories, ${r.lexiconEmbedded} lexicon entries`); refresh(); } });
  const reset = useMutation({ ...modelenceMutation('harness.reset'), onSuccess: () => { toast('Rules, runs and receipts cleared'); setArmed(false); refresh(); } });
  const approve = useMutation({ ...modelenceMutation<Rule>('harness.approveRule'), onSuccess: (r) => { toast.success(`${r.rule_id} approved`); refresh(); } });
  const revert = useMutation({ ...modelenceMutation<Rule>('harness.revertRule'), onSuccess: (r) => { toast(`${r.rule_id} reverted`); refresh(); } });
  const [armed, setArmed] = useState(false);
  const [tab, setTab] = useState<'runs' | 'receipts' | 'prompt'>('runs');

  const runs = summary.data?.runs ?? [];
  const rules = summary.data?.rules ?? [];
  const audit = summary.data?.audit ?? [];
  const latest = runs[runs.length - 1];
  const first = runs[0];
  const proposed = rules.filter((r) => r.status === 'proposed');
  const next = !runs.length
    ? 'Seed memory, then run an evaluation. The first run has no rules; its failures are the training signal.'
    : proposed.length ? `${proposed.length} proposed rule${proposed.length > 1 ? 's' : ''} waiting for you. Approve or revert, then run again.`
    : latest.heldout.pass_rate < 1 ? 'Run again. Rules in force load automatically; the held-out line shows whether they generalise.'
    : 'Held-out at 100%. Revert a rule and run again to see the harness propose a narrower one.';

  return (
    <Page seo={{ title: 'Ledger' }}>
      {/* statement */}
      <section className="grid gap-6 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:items-end">
        <div>
          <h1 className="display text-[2.1rem] leading-none md:text-[3.1rem]">
            Guardrails the agent writes<br />from its own failures.<br /><span className="text-mute">Only a human switches one on.</span>
          </h1>
          <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink/85">
            Sixteen frozen coding tasks. A fixed judge grades every attempt. Each failure on a training task becomes a proposed rule with its evidence attached.
            You approve or revert; the next run loads only rules in force. Held-out tasks are measured, never used to write rules.
          </p>
        </div>
        <div className="md:justify-self-end">
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Btn kind="primary" onClick={() => runEval.mutate({})} disabled={runEval.isPending}>{runEval.isPending ? 'Running…' : 'Run evaluation'}</Btn>
            <Btn onClick={() => seed.mutate({})} disabled={seed.isPending}>Seed memory</Btn>
            {armed ? <Btn kind="revert" onClick={() => reset.mutate({})} disabled={reset.isPending}>Confirm reset</Btn> : <Btn onClick={() => setArmed(true)}>Reset</Btn>}
          </div>
          <p className="mt-3 max-w-[48ch] text-sm text-mute md:text-right">{next}</p>
        </div>
      </section>

      {/* hero: the curve */}
      <section className="mt-8 border-y border-ink bg-sheet">
        <div className="grid gap-0 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <div className="p-4 md:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="wide text-base font-semibold">Held-out pass rate by run</h2>
              <span className="text-sm text-mute">95% Wilson interval on every point</span>
            </div>
            <PassRateChart runs={runs} />
          </div>
          <dl className="ledger border-t border-ink/80 md:border-l md:border-t-0">
            <Fact label="Held-out now" value={latest ? pct(latest.heldout.pass_rate) : '—'} note={latest ? `${latest.heldout.passed} of ${latest.heldout.total}, interval ${pct(latest.heldout.ci95[0])} to ${pct(latest.heldout.ci95[1])}` : 'no runs yet'} />
            <Fact label="Change since run 1" value={runs.length > 1 ? `${latest.heldout.pass_rate >= first.heldout.pass_rate ? '+' : ''}${Math.round((latest.heldout.pass_rate - first.heldout.pass_rate) * 100)} pts` : '—'} note={runs.length > 1 ? `${first.run_id} to ${latest.run_id}` : 'needs two runs'} />
            <Fact label="Correct answers blocked" value={latest ? String(latest.false_blocks) : '—'} note={latest ? `${latest.blocks} blocks across ${latest.paid_attempts} paid attempts` : ''} tone={latest && latest.false_blocks > 0 ? 'text-stop' : 'text-pass'} />
            <Fact label="Rules in force" value={String(rules.filter((r) => r.status === 'approved').length)} note={`${proposed.length} proposed, ${rules.filter((r) => r.status === 'reverted').length} reverted`} tone={proposed.length ? 'text-flag' : undefined} />
          </dl>
        </div>
      </section>

      {/* workbench: decisions | memory */}
      <section className="mt-10 grid gap-10 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <H2 aside={<>deciding as <span className="text-ink">{actor}</span></>}>Decisions</H2>
          {rules.length === 0 ? (
            <p className="py-6 text-sm text-mute">No rules yet. Run an evaluation; failures on the training split propose the first one.</p>
          ) : (
            <ol className="ledger">
              {[...rules].sort((a, b) => (a.status === 'proposed' ? -1 : 1) - (b.status === 'proposed' ? -1 : 1) || a.rule_id.localeCompare(b.rule_id)).map((r) => (
                <li key={r.rule_id} className="grid gap-3 py-4 md:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                  <div>
                    <div className={cn('text-sm font-semibold', STATUS[r.status].cls)}>{STATUS[r.status].word}</div>
                    <div className="mt-1 font-mono text-xs text-mute">{r.rule_id} v{r.version}</div>
                    <div className="mt-1 text-xs text-mute">{r.category.replace('.', ' / ').replace(/_/g, ' ')}</div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] leading-snug">{r.user_message}</p>
                    <p className="mt-1.5 text-xs text-mute">
                      Proposed by the agent from {r.origin.run_id}, task {r.origin.task_id}
                      {r.approved_by ? <>; approved by <span className="text-ink">{r.approved_by}</span></> : null}
                      {r.origin.derived_from ? <>; narrowed after <span className="text-ink">{r.origin.derived_from.replace('reverted:', '')}</span> was reverted</> : null}.
                      {' '}Action: {r.action.replace(/_/g, ' ')}.
                    </p>
                    <Evidence rule={r} />
                  </div>
                  <div className="flex gap-2 md:flex-col md:items-stretch">
                    {r.status === 'proposed' && <Btn kind="approve" onClick={() => approve.mutate({ ruleId: r.rule_id, actor })} disabled={approve.isPending}>Approve</Btn>}
                    {r.status !== 'reverted' && <Btn kind="revert" onClick={() => revert.mutate({ ruleId: r.rule_id, actor, reason: 'reverted from the ledger' })} disabled={revert.isPending}>Revert</Btn>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-10">
          <div>
            <H2 aside={memory.data?.raindrop === 'on' ? 'mirrored to Raindrop' : undefined}>What the agent remembers</H2>
            <MemoryTable m={memory.data} />
          </div>
          <LearnPanel />
        </div>
      </section>

      {/* detail tabs */}
      <section className="mt-12">
        <div className="flex gap-6 border-b border-ink">
          {([['runs', 'Runs'], ['receipts', 'Receipts'], ['prompt', 'Prompt check']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn('-mb-px border-b-2 pb-2 text-sm font-medium', tab === k ? 'border-ink text-ink' : 'border-transparent text-mute hover:text-ink')}>{label}</button>
          ))}
        </div>
        {tab === 'runs' && <RunsTable runs={runs} />}
        {tab === 'receipts' && <Receipts audit={audit} />}
        {tab === 'prompt' && <CostarPanel />}
      </section>

      <p className="mt-12 max-w-[72ch] text-xs leading-relaxed text-mute">
        What this does not show: the agent is a scripted replay of recorded attempts, not a live model; the judge and the rule writer share the same detectors, so the loop proves governance and held-out generalisation, not detector discovery; six held-out tasks is a small sample, hence the intervals. State is MongoDB Atlas, mirrored into Atlas Agent Engine memory; the governance pattern follows RRFlow ADR-0002, governed durable effects.
      </p>
    </Page>
  );
}

function Fact({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="px-4 py-3 md:px-5">
      <dt className="text-xs text-mute">{label}</dt>
      <dd className={cn('display mt-0.5 text-2xl', tone)}>{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-mute">{note}</dd>}
    </div>
  );
}

function Evidence({ rule }: { rule: Rule }) {
  const [open, setOpen] = useState(false);
  const e = rule.origin.evidence;
  const i = e ? e.snippet.indexOf(e.matched) : -1;
  return (
    <div className="mt-2 text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">
        {open ? 'Hide evidence' : e ? 'Show the evidence' : 'Show the trigger'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-flag pl-3">
          {e && <p>The builder asked: <span className="text-ink/85">“{e.prompt}”</span></p>}
          {e && (
            <pre className="overflow-x-auto whitespace-pre-wrap bg-wash p-2 font-mono text-[11px] leading-snug text-ink">
              {i >= 0 ? <>{e.snippet.slice(0, i)}<mark>{e.matched}</mark>{e.snippet.slice(i + e.matched.length)}</> : e.snippet}
            </pre>
          )}
          <p className="break-all font-mono text-[11px] text-mute">trigger {rule.trigger.type}: {rule.trigger.pattern}</p>
        </div>
      )}
    </div>
  );
}

function MemoryTable({ m }: { m?: MemoryTypes }) {
  const rows: [keyof MemoryTypes, string, string][] = [
    ['procedural', 'Rules', 'versioned guardrails, the leash'],
    ['episodic', 'Runs', 'every attempt, graded'],
    ['semantic', 'Lexicon', "the builder's words to engineering terms"],
    ['taxonomic', 'Failure categories', 'what can go wrong, one signal each'],
    ['receipts', 'Receipts', 'every decision, never deleted'],
    ['knowledge', 'Knowledge', 'its own code and lessons, vector-indexed'],
  ];
  return (
    <table className="ledger mt-1 w-full text-sm">
      <tbody className="ledger">
        {rows.map(([k, label, note]) => (
          <tr key={k}>
            <td className="py-2 pr-3 align-top"><div className="font-medium">{label}</div><div className="text-xs text-mute">{note}</div></td>
            <td className="py-2 text-right align-top text-base">{m ? (m[k] ?? 0) : '…'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunsTable({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <p className="py-6 text-sm text-mute">No runs recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-mute">{['Run', 'When', 'Rules in force', 'Train', 'Held-out', 'Interval', 'Blocks', 'Wrongly blocked', 'Proposed'].map((h) => <th key={h} className="pb-2 pr-4 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody className="ledger">
          {runs.map((r) => <RunRow key={r.run_id} r={r} open={open === r.run_id} onToggle={() => setOpen(open === r.run_id ? null : r.run_id)} />)}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({ r, open, onToggle }: { r: Run; open: boolean; onToggle: () => void }) {
  const detail = useQuery({ ...modelenceQuery<RunDetail>('harness.run', { runId: r.run_id }), enabled: open, staleTime: Infinity });
  return (
    <>
      <tr className="cursor-pointer hover:bg-sheet" onClick={onToggle}>
        <td className="py-2 pr-4 font-medium">{r.run_id.replace('run_', 'Run ')}</td>
        <td className="py-2 pr-4 text-mute">{when(r.at)}</td>
        <td className="py-2 pr-4">{r.rules_active.join(', ') || 'none'}</td>
        <td className="py-2 pr-4">{r.train.passed}/{r.train.total}</td>
        <td className="py-2 pr-4 font-semibold">{r.heldout.passed}/{r.heldout.total}</td>
        <td className="py-2 pr-4 text-mute">{pct(r.heldout.ci95[0])}–{pct(r.heldout.ci95[1])}</td>
        <td className="py-2 pr-4">{r.blocks}</td>
        <td className={cn('py-2 pr-4', r.false_blocks > 0 ? 'text-stop' : 'text-pass')}>{r.false_blocks}</td>
        <td className="py-2 pr-4 text-flag">{r.proposed.join(', ') || '—'}</td>
      </tr>
      {open && (
        <tr><td colSpan={9} className="bg-sheet px-3 py-3">
          {detail.isLoading ? <span className="text-mute">Loading traces…</span> : (
            <div className="grid gap-x-6 gap-y-1 text-xs md:grid-cols-2">
              {(detail.data?.traces ?? []).map((t) => (
                <div key={t.task_id} className="flex flex-wrap items-baseline gap-x-2 border-b border-rule py-1">
                  <span className="font-medium">{t.task_id}</span>
                  <span className="text-mute">{t.split === 'heldout' ? 'held-out' : 'train'}</span>
                  <span className={t.verdict.passed ? 'text-pass' : 'text-stop'}>{t.verdict.passed ? 'pass' : 'fail'}</span>
                  <span className="text-mute">{t.attempts} attempt{t.attempts === 1 ? '' : 's'}</span>
                  {t.blocked_by.length > 0 && <span className="text-flag">blocked by {t.blocked_by.join(', ')}</span>}
                  {t.false_blocks > 0 && <span className="text-stop">wrongly blocked ×{t.false_blocks}</span>}
                  {t.verdict.failures.length > 0 && <span className="basis-full text-mute">{t.verdict.failures.join(', ')}</span>}
                </div>
              ))}
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}

function Receipts({ audit }: { audit: Audit[] }) {
  if (!audit.length) return <p className="py-6 text-sm text-mute">Every propose, approve and revert writes a receipt here. Nothing is ever deleted.</p>;
  return (
    <ol className="ledger mt-1 text-sm">
      {[...audit].reverse().map((a, i) => (
        <li key={`${a.at}-${i}`} className="grid gap-x-4 py-2 md:grid-cols-[9rem_6rem_minmax(0,1fr)]">
          <span className="text-mute">{when(a.at)}</span>
          <span className={cn('font-medium', a.event === 'approve' ? 'text-pass' : a.event === 'revert' ? 'text-stop' : 'text-flag')}>{a.event === 'approve' ? 'Approved' : a.event === 'revert' ? 'Reverted' : 'Proposed'}</span>
          <span>{a.rule_id} v{a.version} by {a.actor}{a.reason ? <span className="text-mute"> — {a.reason}</span> : null}</span>
        </li>
      ))}
    </ol>
  );
}

function PassRateChart({ runs }: { runs: Run[] }) {
  const W = 720, H = 260, L = 40, R = 16, T = 34, B = 30;
  const n = runs.length;
  const x = (i: number) => (n <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (p: number) => T + (1 - p) * (H - T - B);
  const path = (sel: (r: Run) => Metrics) => runs.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(sel(r).pass_rate).toFixed(1)}`).join(' ');
  const changes = useMemo(() => runs.map((r, i) => {
    const prev = new Set(i ? runs[i - 1].rules_active : []);
    const added = r.rules_active.filter((id) => !prev.has(id));
    const removed = i ? runs[i - 1].rules_active.filter((id) => !new Set(r.rules_active).has(id)) : [];
    return { added, removed };
  }), [runs]);
  if (!n) return <div className="graph mt-3 flex h-56 items-center justify-center border border-rule text-sm text-mute">Run an evaluation to plot the first point.</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Held-out pass rate per run with 95% intervals">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--color-rule)" />
          <text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize={11} fill="var(--color-mute)">{pct(g)}</text>
        </g>
      ))}
      <path d={path((r) => r.train)} fill="none" stroke="var(--color-mute)" strokeWidth={1.25} strokeDasharray="3 4" />
      <path d={path((r) => r.heldout)} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} strokeLinejoin="round" pathLength={1} strokeDasharray={1} className="animate-draw" />
      {runs.map((r, i) => (
        <g key={r.run_id}>
          <line x1={x(i)} x2={x(i)} y1={y(r.heldout.ci95[0])} y2={y(r.heldout.ci95[1])} stroke="var(--color-ink)" strokeOpacity={0.35} />
          <line x1={x(i) - 4} x2={x(i) + 4} y1={y(r.heldout.ci95[0])} y2={y(r.heldout.ci95[0])} stroke="var(--color-ink)" strokeOpacity={0.35} />
          <line x1={x(i) - 4} x2={x(i) + 4} y1={y(r.heldout.ci95[1])} y2={y(r.heldout.ci95[1])} stroke="var(--color-ink)" strokeOpacity={0.35} />
          <circle cx={x(i)} cy={y(r.heldout.pass_rate)} r={4} fill="var(--color-sheet)" stroke="var(--color-ink)" strokeWidth={2} />
          <circle cx={x(i)} cy={y(r.train.pass_rate)} r={2.5} fill="var(--color-mute)" />
          <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--color-mute)">{r.run_id.replace('run_0', 'run ').replace('run_', 'run ')}</text>
          {changes[i].added.length > 0 && <text x={x(i)} y={T - 16} textAnchor="middle" fontSize={11} fill="var(--color-pass)">+ {changes[i].added.join(' ')}</text>}
          {changes[i].removed.length > 0 && <text x={x(i)} y={T - (changes[i].added.length ? 2 : 16)} textAnchor="middle" fontSize={11} fill="var(--color-stop)">− {changes[i].removed.join(' ')}</text>}
        </g>
      ))}
      <text x={W - R} y={T - 16} textAnchor="end" fontSize={11} fill="var(--color-mute)">solid: held-out · dashed: train</text>
    </svg>
  );
}

function LearnPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('why did it block my retry loop?');
  const [query, setQuery] = useState('');
  const q = useQuery({ ...modelenceQuery<{ hits: Explanation[]; resolver: string }>('harness.explain', { query, k: 4 }), enabled: query.length > 0, staleTime: Infinity });
  const index = useMutation({ ...modelenceMutation<{ indexed: number; kinds: Record<string, number> }>('harness.indexKnowledge'), onSuccess: (r) => { toast.success(`Indexed ${r.indexed} units`); qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('harness.') }); } });
  const KIND: Record<string, string> = { module: 'its own code', export: 'its own code', rule: 'a rule it learned', lexicon: 'vocabulary', failure: 'a failure category' };
  return (
    <div>
      <H2 aside={<button type="button" onClick={() => index.mutate({})} disabled={index.isPending} className="underline decoration-rule underline-offset-4 hover:decoration-ink">{index.isPending ? 'Indexing…' : 'Re-index its code'}</button>}>Ask the harness about itself</H2>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) setQuery(draft.trim()); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ask in your own words"
          className="min-w-0 flex-1 rounded-sm border border-ink/40 bg-sheet px-3 py-1.5 text-sm placeholder:text-mute focus:border-ink focus:outline-none" />
        <Btn kind="primary" type="submit" disabled={!draft.trim() || q.isFetching}>{q.isFetching ? 'Searching…' : 'Explain'}</Btn>
      </form>
      <p className="mt-1.5 text-xs text-mute">It answers from its own source code, its vocabulary and every rule it has learned, by vector search over Atlas.</p>
      {q.data && (
        <ol className="ledger mt-3">
          {q.data.hits.length === 0 && <li className="py-3 text-sm text-mute">Nothing indexed yet. Use “Re-index its code”.</li>}
          {q.data.hits.map((h) => (
            <li key={h.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{h.title}</span>
                <span className="shrink-0 text-xs text-mute">{KIND[h.kind] ?? h.kind}</span>
              </div>
              {h.layman && <p className="mt-1 text-sm leading-snug">{h.layman}</p>}
              <p className="mt-1 text-xs text-mute">{h.path ? `${h.path} — ` : ''}{h.swebok}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
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
  useEffect(() => { if (d && prompt) setTrail((t) => (t.length && t[t.length - 1].prompt === prompt ? t : [...t, { prompt, present }])); }, [d, prompt, present]);
  const submit = (text: string) => { const n = text.trim(); setDraft(n); setPrompt(n); };
  const answer = (text: string) => submit(`${prompt} ${text}`);
  return (
    <div className="mt-4 grid gap-8 md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
      <div>
        <p className="max-w-[60ch] text-sm text-ink/85">Before the agent spends anything, the harness scores the request on six dimensions and asks at most two questions, most expensive gap first. Each answer re-scores it.</p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="paste what you would type to the agent"
          className="mt-3 w-full resize-y rounded-sm border border-ink/40 bg-sheet p-2.5 text-sm placeholder:text-mute focus:border-ink focus:outline-none" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Btn kind="primary" onClick={() => submit(draft)} disabled={!draft.trim() || q.isFetching}>{q.isFetching ? 'Scoring…' : 'Check the request'}</Btn>
          {trail.length > 0 && <span className="text-sm text-mute">complete: {trail.map((t, i) => <span key={i}>{i ? ' → ' : ''}<span className={t.present >= 6 ? 'text-pass' : 'text-flag'}>{t.present}/6</span></span>)}</span>}
          {trail.length > 0 && <button type="button" className="text-xs text-mute underline underline-offset-4" onClick={() => { setTrail([]); setPrompt(''); }}>start over</button>}
        </div>
        {d && (
          <ul className="ledger mt-4 text-sm">
            {d.scores.map((s) => (
              <li key={s.dimension} className="flex items-center gap-3 py-1.5">
                <span className="w-24 capitalize">{s.dimension}</span>
                <span className="h-1.5 flex-1 bg-wash"><span className={cn('block h-full', s.p_present < 0.5 ? 'bg-flag' : 'bg-pass')} style={{ width: pct(s.p_present) }} /></span>
                <span className={cn('w-10 text-right text-xs', s.p_present < 0.5 ? 'text-flag' : 'text-pass')}>{s.p_present.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {d && (d.ui.done ? (
          <p className="text-sm text-pass">Complete enough to start. No questions needed.</p>
        ) : (
          <ol className="ledger">
            {d.ui.cards.map((c) => (
              <li key={c.id} className="py-3">
                <p className="text-sm">{c.question}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.options.map((o) => <button key={o.label} type="button" onClick={() => answer(o.text)} disabled={q.isFetching} className="rounded-sm border border-ink/40 bg-sheet px-2.5 py-1 text-xs hover:border-ink disabled:opacity-50">{o.label}</button>)}
                  {c.freeText && (
                    <form className="flex min-w-[10rem] flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); if (freeText[c.id]?.trim()) { answer(freeText[c.id]); setFreeText((f) => ({ ...f, [c.id]: '' })); } }}>
                      <input value={freeText[c.id] ?? ''} onChange={(e) => setFreeText((f) => ({ ...f, [c.id]: e.target.value }))} placeholder="or type it" className="min-w-0 flex-1 rounded-sm border border-ink/40 bg-sheet px-2.5 py-1 text-xs placeholder:text-mute focus:border-ink focus:outline-none" />
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ))}
        {d && d.lexicon.length > 0 && (
          <div className="mt-6">
            <p className="text-xs text-mute">What the words mean, from the lexicon ({d.resolver.startsWith('atlas') ? 'vector search' : 'word overlap'})</p>
            <ol className="ledger mt-1 text-sm">
              {d.lexicon.map((l) => (
                <li key={l.entry_id} className="py-2">
                  <span className="text-mute">“{l.phrase}”</span> means <span className="font-medium">{l.canonical_label}</span>
                  {l.teach && <p className="mt-0.5 text-xs text-mute">{l.teach}</p>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
