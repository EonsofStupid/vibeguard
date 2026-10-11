import { useQuery } from '@tanstack/react-query';
import { modelenceQuery } from '@modelence/react-query';
import { KnowledgeDrop, type Knowledge } from './KnowledgeDrop';
import { cn } from '@/client/lib/utils';

import type { Comparison, ImprovementStatus } from '@/shared/improvement';

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

function ImprovementCycle({ state }: { state: ImprovementStatus }) {
  const { experiment, proposal, activation, rerun } = state;
  const active = !!proposal && proposal.status === 'approved' && !!activation?.receipt_id && activation.policy_hash === proposal.policy_hash;
  const verified = active && !!rerun?.passed && rerun.policy_hash === proposal?.policy_hash;
  const incident = experiment?.evidence_kind.includes('incident');
  const failed = !!experiment && experiment.metrics.train.before.passed < experiment.metrics.train.before.total;
  const steps = [
    { title: 'Observed failure', detail: incident ? 'Recorded recall rate limit' : failed ? 'Baseline failure recorded' : 'No failure recorded', recorded: !!incident || failed },
    { title: 'Proposed change', detail: proposal ? 'Exact policy saved in Atlas' : 'No change proposed', recorded: !!proposal },
    { title: 'Shadow results', detail: experiment?.promotion?.eligible ? 'Measured gain · no regressions' : 'Evidence not yet eligible', recorded: !!experiment?.promotion?.eligible },
    { title: 'Human review', detail: active ? 'Decision and receipt recorded' : proposal?.status === 'rejected' ? 'Change rejected' : proposal ? 'Your decision is needed' : 'Waiting for a proposal', recorded: active, human: !!proposal && proposal.status === 'proposed' && !!experiment?.promotion?.eligible, complete: active },
    { title: 'Active policy', detail: active ? `Approved version ${activation!.version}` : proposal?.status === 'approved' ? 'Activation evidence needed' : 'Proposed change is not active', recorded: active, complete: active },
    { title: 'Measured rerun', detail: verified ? 'Approved version verified in replay' : 'Waiting for approved-version evidence', recorded: verified, complete: verified },
  ];
  return <section aria-labelledby="improvement-cycle-title" className="mt-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="improvement-cycle-title" className="font-display text-lg font-semibold">The improvement cycle</h2><span className="text-xs text-muted">Every step follows saved evidence</span></div>
    <ol className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{steps.map((step, index) => <li key={step.title} aria-current={step.human ? 'step' : undefined} className={cn('relative rounded-lg border p-3', step.complete ? 'border-verdant/40 bg-verdant/5' : step.human ? 'border-signal/60 bg-signal/10' : step.recorded ? 'border-cobalt/35 bg-cobalt/5' : 'border-line bg-ink/30')}>
      <div className="flex items-center justify-between"><span className={cn('font-mono text-xs', step.complete ? 'text-verdant' : step.human ? 'text-signal' : step.recorded ? 'text-cobalt' : 'text-muted')}>0{index + 1}</span><span className="text-[10px] uppercase tracking-wider text-muted">{step.complete ? 'Verified' : step.human ? 'Your turn' : step.recorded ? 'Recorded' : 'Waiting'}</span></div>
      <h3 className="mt-3 text-sm font-medium">{step.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{step.detail}</p>
      {step.human && <a href="#human-review" className="mt-3 inline-block text-xs font-medium text-signal underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-signal">Review this change ↓</a>}
    </li>)}</ol>
  </section>;
}

export default function LiveImprovement() {
  const state = useQuery({ ...modelenceQuery<ImprovementStatus>('improvement.status'), refetchInterval: 6000, retry: false });
  const experiment = state.data?.experiment;
  const proposal = state.data?.proposal;
  const approved = proposal?.status === 'approved';
  const active = approved && !!state.data?.activation?.receipt_id && state.data.activation.policy_hash === proposal?.policy_hash;
  const rerunVerified = active && !!state.data?.rerun?.passed && state.data.rerun.policy_hash === proposal?.policy_hash;
  const cooldown = !!proposal && (proposal.policy as { kind?: string })?.kind === 'memory_recall_cooldown';
  const promotion = experiment?.promotion;
  const eligible = !!promotion?.eligible;
  const baselinePassed = !!experiment && [experiment.metrics.train.before, experiment.metrics.heldout.before].every(score => score.total > 0 && score.passed === score.total);
  const noChangeNeeded = !!experiment && !proposal && baselinePassed;
  const statusLabel = rerunVerified ? 'Approved policy · replay rerun verified' : active ? 'Active policy · rerun evidence needed' : approved ? 'Approval recorded · activation evidence needed' : !proposal ? noChangeNeeded ? 'Baseline passed · no change proposed' : 'Results recorded · no change proposed' : ['reverted', 'denied', 'rejected'].includes(proposal.status) ? 'Change not active' : eligible ? 'Proposed · not active · your review is next' : 'Keep proposed · checks need attention';
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
          <p className="text-[11px] uppercase tracking-[0.14em] text-cobalt">RSI · recursive harness improvement</p>
          <h1 id="live-improvement-title" className="mt-1 font-display text-2xl font-semibold md:text-3xl">From failure to a better next attempt.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">The agent proposes a change to its own harness. Evidence tests it. You decide what becomes active.</p>
        </div>
        <button type="button" onClick={() => state.refetch()} disabled={state.isFetching} className="rounded-md border border-line bg-raised px-3 py-1.5 text-xs transition-colors hover:border-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cobalt">{state.isFetching ? 'Checking evidence…' : 'Refresh evidence'}</button>
      </div>

      {state.data?.experiment && <ImprovementCycle state={state.data} />}

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
        <span className="rounded-full border border-line px-3 py-1">1 · Adapt the harness</span>
        <span className="rounded-full border border-line px-3 py-1">2 · Remember the goal and results</span>
      </div>

      {state.isPending && <p role="status" className="mt-5 text-sm text-muted">Loading saved experiment evidence…</p>}
      {state.isError && <div role="alert" className="mt-5 rounded-md border border-ember/40 bg-ember/10 p-3 text-sm"><p>Experiment evidence could not be loaded.</p><p className="mt-1 text-xs text-muted">{state.error instanceof Error ? state.error.message : 'Refresh to try again.'}</p></div>}
      {!state.isPending && !state.isError && !experiment && <div className="mt-5 rounded-xl border border-dashed border-line p-5"><h2 className="font-medium">Waiting for the first live comparison.</h2><p className="mt-2 text-sm text-muted">This panel fills from saved model responses and scored results. The recorded examples below can explain the workflow while the real experiment is prepared.</p></div>}

      {experiment && <section aria-labelledby="experiment-results-title" className="mt-5 space-y-4">
        <h2 id="experiment-results-title" className="font-display text-lg font-semibold">{cooldown ? 'The proposed change, measured' : 'What this experiment measured'}</h2>
        {cooldown && <p className="text-sm text-muted">A live model proposed this policy. These scores replay a recorded incident with simulated follow-up timings; they do not measure live provider throughput.</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full border px-2.5 py-1', active ? 'border-verdant/40 bg-verdant/10 text-verdant' : proposal ? 'border-signal/40 bg-signal/10 text-signal' : 'border-cobalt/40 bg-cobalt/10 text-cobalt')}>{statusLabel}</span>
          <span className="text-muted">Model: {experiment.model} · {new Date(experiment.at).toLocaleString()}</span>
        </div>
        {experiment.effect && <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl border border-cobalt/40 bg-cobalt/5 p-5"><p className="text-[11px] uppercase tracking-wider text-cobalt">Shadow replay · avoidable recall attempts</p><p className="mt-3 flex items-baseline gap-4 font-display text-5xl font-semibold md:text-6xl"><span>{experiment.effect.before}</span><span aria-label="becomes" className="text-3xl font-normal text-muted">→</span><span className="text-cobalt">{experiment.effect.after}</span></p><p className="mt-3 text-sm text-muted">Fewer repeated requests during a known rate limit.</p></div>
          <div className="rounded-xl border border-line bg-raised/40 p-5"><p className="text-[11px] uppercase tracking-wider text-muted">Conversation preserved in replay</p><p className="mt-3 font-display text-4xl font-semibold">{experiment.effect.turnsAfter}<span className="text-xl font-normal text-muted"> / {experiment.effect.turnsBefore}</span></p><p className="mt-3 text-sm text-muted">Simulated turns retained. Recording stays enabled while recall cools down.</p></div>
        </div>}
        <div className="grid gap-3 md:grid-cols-2">
          <ScoreCard title="Training cases" detail="Used to propose the change." comparison={experiment.metrics.train} />
          <ScoreCard title="Held-out cases" detail="Reserved for evaluation; excluded from proposal writing." comparison={experiment.metrics.heldout} />
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
        {rerunVerified && <p className="rounded-lg border border-verdant/40 bg-verdant/10 p-3 text-sm text-verdant">Approved policy verified against the frozen replay. Rerun: {state.data!.rerun!.id}</p>}
        {active && <p className="break-all font-mono text-xs text-muted">Human decision receipt: {state.data!.activation!.receipt_id} · active version {state.data!.activation!.version}</p>}
        <p className="text-xs leading-relaxed text-muted">{rerunVerified ? 'The human decision, active policy and replay rerun match the same policy fingerprint. Live provider throughput remains unmeasured.' : proposal ? 'The cycle is complete only when the exact approved version has a decision receipt and a measured rerun.' : 'A passing baseline is useful evidence, not a claim of improvement. No policy was proposed or activated.'}</p>
        <details className="text-xs text-muted"><summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-cobalt">Where these numbers came from</summary><p className="mt-2 break-words font-mono">{experiment.experiment_id} · {experiment.evidence_kind}</p><p className="mt-1">Results come from the saved experiment; the explanations below are curated learning notes.</p></details>
      </section>}

      <details className="mt-5 border-t border-line pt-4">
        <summary className="cursor-pointer text-sm text-cobalt">Learn as you build · why these steps matter</summary>
        <div className={cn('mt-3 grid gap-3', lessons.length > 2 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          {lessons.map(lesson => <KnowledgeDrop key={lesson.term} {...lesson} />)}
        </div>
      </details>
    </section>
  );
}
