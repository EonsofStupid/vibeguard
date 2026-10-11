import { useMutation } from '@tanstack/react-query';
import { modelenceMutation } from '@modelence/react-query';
import type { CaptureResult } from '@/shared/telemetry';

export default function CaptureFeedback({ capture, sessionId }: { capture: CaptureResult; sessionId: string }) {
  const feedback = useMutation({ ...modelenceMutation<CaptureResult>('chat.feedback'), retry: false });
  const accepted = capture.status === 'acknowledged';
  return <aside className="rounded-lg border border-cobalt/30 bg-cobalt/5 p-3 text-sm">
    <p className="font-medium">{accepted ? 'Raindrop accepted this chat event.' : capture.status === 'not_configured' ? 'Raindrop capture is not configured.' : 'Raindrop did not confirm this chat event.'}</p>
    <p className="mt-1 text-xs text-muted">Your feedback helps identify the next improvement. A signal does not activate a policy.</p>
    <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer text-cobalt">Capture receipt</summary><p className="mt-2 break-all font-mono">{capture.eventId}</p><p>HTTP {capture.httpStatus ?? 'unavailable'} · {capture.acknowledgedAt ?? capture.message ?? 'No acknowledgement'}</p></details>
    {accepted && <div className="mt-3 flex flex-wrap gap-2">{(['helpful', 'missed_goal'] as const).map(rating => <button key={rating} type="button" disabled={feedback.isPending || feedback.data?.status === 'acknowledged'} onClick={() => feedback.mutate({ sessionId, eventId: capture.eventId, rating })} className="rounded-md border border-line bg-raised px-3 py-1.5 text-xs disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cobalt">{rating === 'helpful' ? 'Helpful' : 'Missed my goal'}</button>)}</div>}
    {feedback.isPending && <p role="status" className="mt-2 text-xs">Sending your feedback…</p>}
    {feedback.data && <p role="status" className="mt-2 text-xs">{feedback.data.status === 'acknowledged' ? 'Raindrop accepted your feedback.' : 'Feedback delivery was not confirmed.'}</p>}
    {feedback.isError && <p role="alert" className="mt-2 text-xs text-ember">Feedback delivery failed. You can try again.</p>}
  </aside>;
}
