import type { CaptureResult } from '../../shared/telemetry';

type Properties = Record<string, unknown>;
export type CaptureEvent = {
  eventId: string; userId: string; event: string; properties?: Properties;
  ai?: { model: string; input: string; output?: string; convoId: string };
};

// Official protocol: https://www.raindrop.ai/docs/sdk/http-api/
// One bounded attempt. Telemetry failure must never grant authority or fail chat.
async function send(endpoint: 'events/track' | 'signals/track', eventId: string, payload: unknown): Promise<CaptureResult> {
  const key = process.env.RAINDROP_WRITE_KEY?.trim();
  if (!key) return { provider: 'raindrop', status: 'not_configured', eventId, message: 'Raindrop capture is not configured.' };
  const project = process.env.RAINDROP_PROJECT_ID?.trim();
  try {
    const response = await fetch(`https://api.raindrop.ai/v1/${endpoint}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(project ? { 'X-Raindrop-Project-Id': project } : {}) },
      body: JSON.stringify([payload]), signal: AbortSignal.timeout(3000),
    });
    // The live event API also returns 200 {events:[{event_id}]} (verified 2026-10-11).
    // A bare 200 or mismatched ID is not an acknowledgement.
    const body: unknown = response.status === 200 && endpoint === 'events/track' ? await response.json().catch(() => null) : null;
    const matchingEvent = body !== null && typeof body === 'object' && 'events' in body && Array.isArray(body.events)
      && body.events.some((entry: unknown) => entry !== null && typeof entry === 'object' && 'event_id' in entry && entry.event_id === eventId);
    await response.body?.cancel().catch(() => undefined);
    return response.status === 204 || matchingEvent
      ? { provider: 'raindrop', status: 'acknowledged', eventId, httpStatus: response.status, acknowledgedAt: new Date().toISOString(), acknowledgement: response.status === 204 ? 'http_204' : 'matching_event_id' }
      : { provider: 'raindrop', status: 'failed', eventId, httpStatus: response.status, message: `Raindrop did not acknowledge capture (HTTP ${response.status}).` };
  } catch {
    return { provider: 'raindrop', status: 'failed', eventId, message: 'Raindrop capture failed or timed out; delivery is unconfirmed.' };
  }
}

const events = new Map<string, Promise<CaptureResult>>();
export async function captureEvent(event: CaptureEvent): Promise<CaptureResult> {
  const existing = events.get(event.eventId);
  if (existing) return existing;
  const pending = send('events/track', event.eventId, {
    event_id: event.eventId, user_id: event.userId, event: event.event,
    properties: { app: 'vibeguard', ...event.properties },
    ...(event.ai ? { ai_data: { model: event.ai.model, input: event.ai.input, ...(event.ai.output === undefined ? {} : { output: event.ai.output }), convo_id: event.ai.convoId } } : {}),
  });
  events.set(event.eventId, pending);
  const result = await pending;
  if (result.status !== 'acknowledged') events.delete(event.eventId);
  if (events.size > 256) events.delete(events.keys().next().value!);
  return result;
}

export async function captureSignal(event: CaptureResult, signal: {
  name: string; sentiment: 'POSITIVE' | 'NEGATIVE'; type: 'feedback' | 'standard'; properties?: Properties;
}): Promise<CaptureResult> {
  if (event.status !== 'acknowledged') return { ...event, message: 'Signal not sent because its corresponding event was not acknowledged.' };
  return send('signals/track', event.eventId, {
    event_id: event.eventId, signal_name: signal.name, signal_type: signal.type,
    sentiment: signal.sentiment, timestamp: new Date().toISOString(), properties: signal.properties ?? {},
  });
}
