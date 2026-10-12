import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { modelenceMutation, modelenceQuery } from '@modelence/react-query';
import { Button } from '@/client/components/ui/Button';
import { Input } from '@/client/components/ui/Input';
import { Textarea } from '@/client/components/ui/Textarea';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/client/components/ui/Dialog';
import type { ImprovementStatus } from '@/shared/improvement';

type PendingReview = {
  execution_id: string; session_id: string; interrupt_id: string;
  proposal_id: string; proposal_version: number; policy_hash: string; experiment_id: string;
  policy: Record<string, unknown>; replaces_active_policy_version: number;
  evidence: { before: number; after: number; total: number; regressions: string[]; false_blocks: number; reason: string };
};
type DecisionResult = { completed: boolean; message?: string; receipt?: { id: string; status: string; actor: string; at: string; policy_hash: string; version: number; active_policy_version: number } };
const fieldClass = 'border-line bg-raised text-text placeholder:text-muted focus-visible:ring-cobalt focus-visible:ring-offset-0';

function PendingCard({ review, onResolved }: { review: PendingReview; onResolved: (result: DecisionResult) => void }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<'approved' | 'denied' | ''>('');
  const [checked, setChecked] = useState(false);
  const submit = useMutation({ ...modelenceMutation<DecisionResult>('review.decide'), onSuccess: onResolved });
  const cooldown = review.policy.kind === 'memory_recall_cooldown';
  return <article className="rounded-xl border border-signal/40 bg-raised/30 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><p className="text-[11px] uppercase tracking-[0.14em] text-signal">Your decision is needed</p>
        <h3 className="mt-1 font-display text-lg">{cooldown ? 'Give memory recall time to recover.' : 'Set a clear stopping point.'}</h3></div>
      <span className="rounded-full border border-signal/40 px-2 py-1 text-xs text-signal">Proposed · v{review.proposal_version}</span>
    </div>
    <p className="mt-3 text-sm leading-relaxed text-muted">{cooldown
        ? `For future chats in this project, pause long-term recall for ${String(review.policy.cooldown_seconds)} seconds after an embedding rate limit. Each user, session and provider has its own cooldown. Keep recording turns, use only the current conversation, and tell the user recall is unavailable.`
      : `Allow at most ${String(review.policy.max_total_attempts)} attempts, respect a smaller user limit, and stop on success or a non-retryable failure.`}</p>
    <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-line bg-surface p-3 text-sm">
      <div><dt className="text-xs text-muted">Before → trial</dt><dd className="mt-1 font-mono">{review.evidence.before}/{review.evidence.total} → {review.evidence.after}/{review.evidence.total}</dd></div>
      <div><dt className="text-xs text-muted">New failures</dt><dd className="mt-1 font-mono">{review.evidence.regressions.length}</dd></div>
      <div><dt className="text-xs text-muted">False blocks</dt><dd className="mt-1 font-mono">{review.evidence.false_blocks}</dd></div>
    </dl>
    <p className="mt-2 text-xs text-muted">{review.evidence.reason}</p>
    <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer text-cobalt">Exact policy and evidence</summary>
      <dl className="mt-2 space-y-1 break-all"><div>Proposal: {review.proposal_id}, v{review.proposal_version}</div><div>Experiment: {review.experiment_id}</div><div>Policy hash: {review.policy_hash}</div><div>Replaces active version: {review.replaces_active_policy_version}</div></dl>
      <pre className="mt-2 overflow-x-auto rounded-md bg-ink p-3">{JSON.stringify(review.policy, null, 2)}</pre>
    </details>
    <form className="mt-4 space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (!decision || !name.trim() || !checked || submit.isPending) return;
      submit.mutate({ execution_id: review.execution_id, session_id: review.session_id, interrupt_id: review.interrupt_id, proposal_id: review.proposal_id, version: review.proposal_version, policy_hash: review.policy_hash, decision, reviewer_name: name.trim(), reviewer_notes: notes });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Your name</span><Input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="The person making this decision" /></label>
        <label className="space-y-1 text-sm"><span>Decision</span><select required value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)} className="h-9 w-full rounded-md border border-line bg-raised px-3 text-text focus-visible:ring-2 focus-visible:ring-cobalt"><option value="">Choose a decision</option><option value="approved">Approve this policy for future chats</option><option value="denied">Deny this change</option></select></label>
      </div>
      <label className="block space-y-1 text-sm"><span>Your preference or review notes <span className="text-muted">(optional)</span></span><Textarea maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="What should future improvements respect?" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="mt-1 accent-verdant" /><span>I reviewed this policy and its measured evidence.</span></label>
      <p className="text-xs text-muted">Approve once: future chats apply this version automatically. A change to the approved boundary needs a new review. Your decision and notes stay in the receipt; notes alone do not change the policy. Your name labels this prototype receipt, alongside the service-account identity.</p>
      <Button type="submit" variant="outline" loading={submit.isPending} disabled={!decision || !name.trim() || !checked || submit.isSuccess} className="border-verdant/50 bg-verdant/10 text-verdant hover:bg-verdant/20">{submit.isPending ? 'RRFlow is recording your decision…' : 'Submit my decision'}</Button>
      {submit.error && <p role="alert" className="text-sm text-ember">{submit.error.message}</p>}
      {submit.data && <div role="status" className="rounded-lg border border-line bg-surface p-3 text-sm">{submit.data.completed ? <><p>Decision committed: <strong>{submit.data.receipt?.status}</strong>.</p><p className="mt-1 break-all font-mono text-xs text-muted">Receipt {submit.data.receipt?.id}</p></> : submit.data.message}</div>}
    </form>
  </article>;
}

export default function ReviewPanel() {
  const [latestDecision, setLatestDecision] = useState<DecisionResult | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const surfaced = useRef(new Set<string>());
  const reviewButtons = useRef(new Map<string, HTMLButtonElement>());
  const panelTitle = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const pending = useQuery({ ...modelenceQuery<{ reviews: PendingReview[] }>('review.pending'), refetchInterval: 10000, retry: false });
  const evidence = useQuery({ ...modelenceQuery<ImprovementStatus>('improvement.status'), refetchInterval: 10000 });
  const refresh = () => {
    void pending.refetch();
    void queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('harness.') || query.queryKey[0] === 'improvement.status' });
  };
  const request = useMutation({ ...modelenceMutation('review.request'), onSuccess: refresh });
  const reviews = pending.data?.reviews ?? [];
  const proposal = evidence.data?.proposal;
  const eligible = evidence.data?.experiment?.promotion?.eligible === true;
  const alreadyPending = !!proposal && reviews.some((item) => item.proposal_id === proposal._id);
  const selectedReview = reviews.find((review) => review.execution_id === selectedExecution);
  const openReview = (review: PendingReview) => {
    surfaced.current.add(review.execution_id);
    try { sessionStorage.setItem(`vibeguard:review-surfaced:${review.execution_id}`, 'true'); } catch { /* In-memory tracking still prevents repeated prompts. */ }
    setSelectedExecution(review.execution_id);
    setReviewOpen(true);
  };
  useEffect(() => {
    if (reviewOpen) return;
    const next = reviews.find((review) => {
      if (surfaced.current.has(review.execution_id)) return false;
      try { if (sessionStorage.getItem(`vibeguard:review-surfaced:${review.execution_id}`)) return false; } catch { /* Storage may be unavailable. */ }
      return true;
    });
    if (next) openReview(next);
  }, [reviews, reviewOpen]);
  return <section id="human-review" aria-labelledby="human-review-title" className="animate-fade-up rounded-xl border border-line bg-surface p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] uppercase tracking-[0.14em] text-muted">RRFlow · human review</p><h2 ref={panelTitle} tabIndex={-1} id="human-review-title" className="mt-1 font-display text-xl">You choose what becomes active.</h2><p className="mt-2 text-sm text-muted">A measured proposal waits here until you review and submit your decision.</p></div><Button size="sm" variant="outline" className="border-line bg-raised text-text" onClick={() => pending.refetch()} loading={pending.isFetching}>Refresh reviews</Button></div>
    {pending.isPending && <p role="status" className="mt-4 text-sm text-muted">Loading the RRFlow review queue…</p>}
    {pending.error && <p role="alert" className="mt-4 rounded-lg border border-ember/40 p-3 text-sm">{pending.error.message}</p>}
    {!pending.isPending && !pending.error && reviews.length === 0 && <p className="mt-4 text-sm text-muted">No change is waiting for a decision.</p>}
    {proposal?.status === 'proposed' && eligible && !alreadyPending && <div className="mt-4 space-y-2"><Button variant="outline" className="border-signal/50 bg-signal/10 text-signal" loading={request.isPending} onClick={() => request.mutate({ proposal_id: proposal._id, version: proposal.version, policy_hash: proposal.policy_hash })}>{request.isPending ? 'Opening the review in RRFlow…' : 'Review proposed improvement'}</Button><p className="text-xs text-muted">Opening a review does not approve it.</p></div>}
    {request.error && <p role="alert" className="mt-3 text-sm text-ember">{request.error.message}</p>}
    {latestDecision && <div role="status" className="mt-4 rounded-lg border border-verdant/40 bg-verdant/10 p-3 text-sm">{latestDecision.completed ? <><p>Decision saved: <strong>{latestDecision.receipt?.status}</strong>. {latestDecision.receipt?.status === 'approved' ? 'Future chats will use this approved policy.' : 'The active policy is unchanged.'}</p><p className="mt-1 break-all font-mono text-xs">Receipt {latestDecision.receipt?.id} · active version {latestDecision.receipt?.active_policy_version}</p></> : latestDecision.message}</div>}
    <div className="mt-4 space-y-3">{reviews.map((review) => <article key={`${review.execution_id}:${review.interrupt_id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/5 p-4">
      <div><p className="text-sm font-medium text-signal">Ready for your review</p><p className="mt-1 text-sm">{review.policy.kind === 'memory_recall_cooldown' ? 'Pause memory recall briefly after a rate limit' : 'Set an explicit retry budget'} · version {review.proposal_version}</p><p className="mt-1 text-xs text-muted">Nothing changes until you submit a decision.</p></div>
      <Button ref={(element) => { if (element) reviewButtons.current.set(review.execution_id, element); else reviewButtons.current.delete(review.execution_id); }} variant="outline" className="border-signal/50 bg-signal/10 text-signal" onClick={() => openReview(review)}>Review now</Button>
    </article>)}</div>
    <Dialog open={reviewOpen && !!selectedReview} onOpenChange={setReviewOpen}>
      <DialogContent showClose={false} finalFocus={() => reviewButtons.current.get(selectedExecution ?? '') ?? panelTitle.current} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto border-line bg-surface text-text">
        <div className="flex items-start justify-between gap-4"><div><DialogTitle className="font-display text-xl">Review this improvement</DialogTitle><DialogDescription className="mt-2 text-muted">Check the proposed change, then choose whether it should apply to future chats.</DialogDescription></div><DialogClose render={<Button size="sm" variant="outline" className="shrink-0 border-line bg-raised text-text" />}>Review later</DialogClose></div>
        {selectedReview && <PendingCard key={`${selectedReview.execution_id}:${selectedReview.interrupt_id}`} review={selectedReview} onResolved={(result) => { setLatestDecision(result); if (result.completed) setReviewOpen(false); refresh(); }} />}
      </DialogContent>
    </Dialog>
  </section>;
}
