/** An ingest acknowledgement confirms delivery, not evaluation or policy activation. */
export type CaptureResult = {
  provider: 'raindrop';
  status: 'acknowledged' | 'not_configured' | 'failed';
  eventId: string;
  httpStatus?: number;
  acknowledgedAt?: string;
  acknowledgement?: 'http_204' | 'matching_event_id';
  message?: string;
};
