import { useQuery } from '@tanstack/react-query';
import { modelenceQuery } from '@modelence/react-query';
import { KnowledgeDrop, type Knowledge } from './KnowledgeDrop';
import { cn } from '@/client/lib/utils';

type Score = { passed: number; total: number };
type Comparison = { before: Score; after?: Score | null };
export type LiveImprovementState = {
  experiment: null | {
    experiment_id: string;
    at: string;
    model: string;
    evidence_kind: string;
    metrics: { train: Comparison; heldout: Comparison };
    effect?: { before: number; after: number; turnsBefore: number; turnsAfter: number } | null;
    promotion?: { eligible: boolean; before: number; after: number; total: number; regressions: string[]; false_blocks: number; reason: string } | null;
  };
  proposal: null | { _id: string; version: number; status: string; policy_hash: string; policy: unknown; evidence_summary: unknown };
  review: { url: string | null; ready: boolean };
  rerun?: { id: string; passed: boolean; policy_hash: string; evidence_type: string } | null;
};

function reviewLink(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.href : null;
  } catch { return null; }
}

const displayJson = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function ScoreCard({ title, detail, comparison }: { title: string; detail: string; comparison: Comparison }) {
  return (
    <div className="rounded-xl border border-line bg-raised/40 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div><p className="text-xs text-muted">Before</p><p className="mt-1 font-display text-2xl font-bold">{comparison.before.passed}<span className="text-sm font-normal text-muted"> / {comparison.before.total}</span></p></div>
        <span aria-label="compared with" className="text-muted">→</span>
        <div><p className="text-xs text-muted">With proposed change</p>{comparison.after ? <p className="mt-1 font-display text-2xl font-bold text-cobalt">{comparison.after.passed}<span className="text-sm font-normal text-muted"> / {comparison.after.total}</span></p> : <p className="mt-1 text-sm text-muted">Not run</p>}</div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{detail}</p>
    </div>
  );
}

export default function LiveImprovement() {
  const state = useQuery({ ...modelenceQuery<LiveImprovementState>('harness.liveImprovement'), refetchInterval: 6000, retry: false });
  const experiment = state.data?.experiment;
  const proposal = state.data?.proposal;
  const approved = proposal?.status === 'approved';
  const cooldown = !!proposal && (proposal.policy as { kind?: string })?.kind === 'memory_recall_cooldown';
  const promotion = experiment?.promotion;
  const eligible = !!promotion?.eligible;
  const baselinePassed = !!experiment && [experiment.metrics.train.before, experiment.metrics.heldout.before].every(score => score.total > 0 && score.passed === score.total);
  const noChangeNeeded = !!experiment && !proposal && baselinePassed;
  const statusLabel = approved ? 'Approved · rerun evidence needed' : !proposal ? noChangeNeeded ? 'Baseline passed · no change proposed' : 'Results recorded · no change proposed' : ['reverted', 'denied', 'rejected'].includes(proposal.status) ? 'Change not active' : eligible ? 'Trial complete · awaiting human review' : 'Keep proposed · checks need attention';
  const href = state.data?.review.ready ? reviewLink(state.data.review.url) : null;
  const provenance = experiment ? `Experiment ${experiment.experiment_id}${proposal ? ` · proposal ${proposal._id}, v${proposal.version}` : ''}` : 'VibeGuard example guide · no measured result yet';
  const lessons: Knowledge[] = [
    cooldown ? {
      title: 'Give recall a short break, keep the conversation going.',
      explanation: 'A cooldown avoids repeating a memory request while it is rate limited. Conversation recording stays enabled and recall resumes after the pause.',
      term: 'Recall cooldown', whyNow: 'This proposed context policy responds to a recorded embedding rate limit.', source: provenance,
    } : {
      title: 'Three attempts means three chances in total.',
      explanation: 'A retry budget of three includes the first call and two retries. A smaller limit you choose should still win.',
      term: 'Retry budget',
      whyNow: experiment ? 'This experiment checks whether the agent respects a stopping point.' : 'The first working example is about keeping repeated API calls within your limit.',
      source: provenance,
    },
    experiment && proposal ? {
      title: approved ? 'An approval needs a record you can check.' : 'Trying a change does not turn it on.',
      explanation: approved ? 'A receipt connects the human decision to the exact version reviewed. A later run must show what that version actually changed.' : 'A shadow trial measures a proposed change separately. It still needs a human decision before it becomes an active boundary.',
      term: approved ? 'Approval receipt' : 'Shadow evaluation',
      whyNow: approved ? 'The proposal is marked approved; the record and a measured rerun are the next evidence to inspect.' : 'The scores compare a baseline with a proposal. They do not grant permission to activate it.',
      source: provenance,
    } : {
      title: 'Remembering and improving are different steps.',
      explanation: 'Memory helps bring back a goal or decision. Improvement means using evidence to change behavior, then checking the result.',
      term: 'Recall and learning',
      whyNow: 'The next checkpoint builds on working memory with a measured change to the agent’s behavior.',
      source: 'VibeGuard focus · coherent memory and measured improvement',
    },
    ...(experiment ? [{
      title: proposal && !eligible ? 'A change can fix one thing and break another.' : 'Keep a few examples out of the lesson.',
      explanation: proposal && !eligible ? 'We check for new failures and useful answers blocked by mistake. A better score alone is not enough to make a proposal eligible.' : 'Held-out cases are kept out of proposal writing. They help check whether behavior holds beyond the examples used for development.',
      term: proposal && !eligible ? 'Regression and false block' : 'Held-out evaluation',
      whyNow: proposal && !eligible ? 'This proposal has not passed the promotion check. The recorded reason appears beside the results.' : 'The second scorecard reports cases reserved for evaluation.',
      source: provenance,
    }] : []),
  ];

  return (
    <section aria-labelledby="live-improvement-title" className="animate-fade-up rounded-xl border border-cobalt/40 bg-surface p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-cobalt">Real improvement · one example at a time</p>
          <h1 id="live-improvement-title" className="mt-1 font-display text-2xl font-semibold md:text-3xl">Make the next attempt better.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Try a task, see what went wrong, review one change, then measure it again. You stay in charge of what becomes active.</p>
        </div>
        <button type="button" onClick={() => state.refetch()} disabled={state.isFetching} className="rounded-md border border-line bg-raised px-3 py-1.5 text-xs transition-colors hover:border-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cobalt">{state.isFetching ? 'Checking evidence…' : 'Refresh evidence'}</button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
        <span className="rounded-full border border-line px-3 py-1">1 · Adapt the harness</span>
        <span className="rounded-full border border-line px-3 py-1">2 · Remember the goal and results</span>
      </div>

      {state.isPending && <p role="status" className="mt-5 text-sm text-muted">Loading saved experiment evidence…</p>}
      {state.isError && <div role="alert" className="mt-5 rounded-md border border-ember/40 bg-ember/10 p-3 text-sm"><p>Experiment evidence could not be loaded.</p><p className="mt-1 text-xs text-muted">{state.error instanceof Error ? state.error.message : 'Refresh to try again.'}</p></div>}
      {!state.isPending && !state.isError && !experiment && <div className="mt-5 rounded-xl border border-dashed border-line p-5"><h2 className="font-medium">Waiting for the first live comparison.</h2><p className="mt-2 text-sm text-muted">This panel fills from saved model responses and scored results. The recorded examples below can explain the workflow while the real experiment is prepared.</p></div>}

      {experiment && <section aria-labelledby="experiment-results-title" className="mt-5 space-y-4">
        <h2 id="experiment-results-title" className="font-display text-lg font-semibold">What this experiment measured</h2>
        {cooldown && <p className="text-sm text-muted">A live model proposed this policy. These scores replay a recorded incident with simulated follow-up timings; they do not measure live provider throughput.</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full border px-2.5 py-1', approved ? 'border-verdant/40 bg-verdant/10 text-verdant' : proposal ? 'border-signal/40 bg-signal/10 text-signal' : 'border-cobalt/40 bg-cobalt/10 text-cobalt')}>{statusLabel}</span>
          <span className="text-muted">Model: {experiment.model} · {new Date(experiment.at).toLocaleString()}</span>
        </div>
        {experiment.effect && <div className="rounded-lg border border-cobalt/30 bg-cobalt/5 p-4"><h3 className="text-sm font-medium">Fewer repeated requests during a known rate limit</h3><p className="mt-2 font-display text-2xl">{experiment.effect.before} → {experiment.effect.after} <span className="text-sm text-muted">avoidable recall attempts in replay</span></p><p className="mt-1 text-xs text-muted">Simulated turns recorded: {experiment.effect.turnsBefore} → {experiment.effect.turnsAfter}. Chat recording remains enabled.</p></div>}
        <div className="grid gap-3 md:grid-cols-2">
          <ScoreCard title="Cases used to develop the change" detail="Passing cases in the recorded training comparison." comparison={experiment.metrics.train} />
          <ScoreCard title="Fresh cases reserved for evaluation" detail="Held-out results. These cases must not be used to write the proposal." comparison={experiment.metrics.heldout} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <h3 className="text-sm font-medium">{noChangeNeeded ? 'The baseline already meets these checks.' : proposal ? 'Can this move to human review?' : 'What the evidence says'}</h3>
          <p className="mt-2 text-sm text-muted">{noChangeNeeded ? 'All measured training and held-out cases passed before a change. There is no failed case here to justify a new boundary, and nothing is waiting for approval.' : promotion?.reason || 'No proposed change has been recorded for this experiment.'}</p>
          {promotion && proposal && <p className="mt-2 text-xs text-muted">New failures: {promotion.regressions.length} · Useful answers blocked: {promotion.false_blocks}</p>}
          {!!promotion?.regressions.length && <p className="mt-1 break-words font-mono text-xs text-ember">{promotion.regressions.join(', ')}</p>}
        </div>

        {proposal && <div className="rounded-lg border border-signal/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-medium">The exact change to review</h3><p className="mt-1 break-words font-mono text-xs text-muted">{proposal._id} · version {proposal.version} · {proposal.status}</p></div>
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-md border border-cobalt/50 bg-cobalt/15 px-3 py-2 text-sm text-cobalt focus-visible:ring-2 focus-visible:ring-cobalt">{approved ? 'Open review record' : 'Review with RRFlow'} ↗</a>}
          </div>
          {!href && <p className="mt-3 text-sm text-muted">The RRFlow review panel below opens the exact proposed version. Once approved, this policy applies automatically to later chats within its scope.</p>}
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-cobalt focus-visible:ring-2 focus-visible:ring-cobalt">See proposed behavior and evidence</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-ink p-3 text-muted">{displayJson(proposal.policy)}</pre><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-ink p-3 text-muted">{displayJson(proposal.evidence_summary)}</pre><p className="mt-2 break-all font-mono text-muted">Policy fingerprint: {proposal.policy_hash}</p></details>
        </div>}
        {state.data?.rerun?.passed && <p className="rounded-lg border border-verdant/40 bg-verdant/10 p-3 text-sm text-verdant">Approved policy verified against the frozen replay. Receipt: {state.data.rerun.id}</p>}
        <p className="text-xs leading-relaxed text-muted">{proposal ? 'This comparison is evidence for a proposed harness change. The full improvement cycle still needs the human decision, its receipt, and a measured rerun with the approved version.' : 'A passing baseline is useful evidence, not a claim of improvement. No policy was proposed or activated. The next improvement cycle needs an observed failure to address.'}</p>
        <details className="text-xs text-muted"><summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-cobalt">Where these numbers came from</summary><p className="mt-2 break-words font-mono">{experiment.experiment_id} · {experiment.evidence_kind}</p><p className="mt-1">Results come from the saved experiment; the explanations below are curated learning notes.</p></details>
      </section>}

      <section aria-labelledby="learning-notes-title" className="mt-5">
        <h2 id="learning-notes-title" className="font-display text-lg font-semibold">Learn as you build</h2>
        <div className={cn('mt-3 grid gap-3', lessons.length > 2 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          {lessons.map(lesson => <KnowledgeDrop key={lesson.term} {...lesson} />)}
        </div>
      </section>
    </section>
  );
}
