import type { CaptureResult } from '../../shared/telemetry';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
export type ChatInput = { sessionId: string; messages: ChatMessage[] };
export type ChatReceipt = { id: string; sessionId: string; turnSequence: number; acknowledged: true };
export type ChatKnowledge = { title: string; explanation: string; term: string; whyNow: string; source: string };
export type ChatReply = {
  message: ChatMessage;
  model: string;
  responseId: string;
  sessionId: string;
  telemetry?: CaptureResult;
  memory: {
    mode: 'hosted';
    userId: string;
    saved: boolean;
    userReceipt: ChatReceipt;
    assistantReceipt: ChatReceipt | null;
    error: string | null;
    recallLimited: boolean;
    recallReason: string | null;
    policy: { id: string; version: number; hash: string; decision: 'recalled' | 'rate_limited' | 'cooldown'; eventId: string } | null;
    contextTruncated: boolean;
    recalled: { id: string; content: string; source: string; timestamp?: string }[];
    sourceCounts: Record<string, number>;
  };
  knowledge: ChatKnowledge[];
};
export type ChatStatus = { configured: boolean; memoryMode: string | null; memoryUser: string; model: string; missing: string[] };
