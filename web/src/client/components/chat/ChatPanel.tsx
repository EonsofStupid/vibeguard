import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { modelenceMutation, modelenceQuery } from '@modelence/react-query';
import { KnowledgeDrop } from '@/client/components/improvement/KnowledgeDrop';
import { cn } from '@/client/lib/utils';
import type { ChatInput, ChatMessage, ChatReply, ChatStatus } from '@/server/chat/contracts';

const STORAGE_KEY = 'vibeguard-modelence-conversation-v1';
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const newSession = () => 'chat-' + crypto.randomUUID();
const isMessage = (value: unknown): value is ChatMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === 'string' && SESSION_PATTERN.test(message.id) && ['user', 'assistant'].includes(String(message.role)) && typeof message.content === 'string' && message.content.length <= 48000;
};

function boundedMessages(messages: ChatMessage[]): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let characters = 0;
  for (const message of [...messages].reverse()) {
    if (selected.length >= 20 || characters + message.content.length > 42000 || message.content.length > 12000) break;
    selected.unshift(message);
    characters += message.content.length;
  }
  return selected;
}

export default function ChatPanel() {
  const status = useQuery({ ...modelenceQuery<ChatStatus>('chat.status'), retry: false, staleTime: 30_000 });
  const send = useMutation({ ...modelenceMutation<ChatReply>('chat.send'), retry: false });
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedRequest, setFailedRequest] = useState<ChatInput | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const busy = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.sessionId === 'string' && SESSION_PATTERN.test(saved.sessionId) && Array.isArray(saved.messages) && saved.messages.every(isMessage)) {
        setSessionId(saved.sessionId); setMessages(saved.messages.slice(-100)); return;
      }
    } catch { setStorageWarning(true); }
    setSessionId(newSession());
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, messages: messages.slice(-100) })); }
    catch { setStorageWarning(true); }
  }, [sessionId, messages]);

  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [messages, send.isPending]);

  async function sendRequest(input: ChatInput) {
    if (busy.current) return;
    busy.current = true; setError(null); setFailedRequest(null);
    try {
      const result = await send.mutateAsync(input);
      setReply(result);
      setMessages(previous => previous.some(message => message.id === result.message.id) ? previous : [...previous, result.message]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The request failed. No completed reply was confirmed.');
      setFailedRequest(input);
    } finally { busy.current = false; }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !sessionId || busy.current || !status.data?.configured) return;
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content };
    const next = [...messages, user];
    setMessages(next); setDraft('');
    await sendRequest({ sessionId, messages: boundedMessages(next) });
  }

  function startNewSession() {
    if (busy.current) return;
    setSessionId(newSession()); setMessages([]); setReply(null); setError(null); setFailedRequest(null); setDraft(''); send.reset();
  }

  return (
    <section aria-labelledby="chat-title" className="rounded-xl border border-line bg-surface p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[11px] uppercase tracking-[0.14em] text-cobalt">Your working conversation</p><h2 id="chat-title" className="mt-1 font-display text-xl font-semibold">Build with context that can come back.</h2><p className="mt-2 max-w-2xl text-sm text-muted">Talk through a real task. See which memories were recalled, what was saved, and what still needs your decision.</p></div>
        <button type="button" onClick={startNewSession} disabled={send.isPending || !sessionId} className="rounded-md border border-line bg-raised px-3 py-1.5 text-xs hover:border-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cobalt">New conversation</button>
      </div>

      {status.isPending && <p role="status" className="mt-4 text-sm text-muted">Checking chat configuration…</p>}
      {status.isError && <p role="alert" className="mt-4 text-sm text-ember">Chat configuration could not be loaded. <button type="button" onClick={() => status.refetch()} className="underline">Try again</button></p>}
      {status.data && !status.data.configured && <div role="alert" className="mt-4 rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm"><p>Chat needs its server configuration before you can send a message.</p><details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Setup details</summary><p className="mt-2 break-words">Missing: {status.data.missing.join(', ')}</p><button type="button" className="mt-2 underline" onClick={() => status.refetch()}>Check again</button></details></div>}

      <div ref={transcript} role="log" aria-label="Conversation" aria-live="polite" className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto rounded-xl border border-line bg-ink/40 p-3 md:p-4">
        {messages.length === 0 && <div className="py-5"><p className="font-medium">Start with something you want to build.</p><p className="mt-2 text-sm text-muted">For example: “Help me call a paid API with at most three attempts.” Or start a new conversation and ask what goal you were working toward.</p></div>}
        {messages.map(message => <article key={message.id} className={cn('rounded-lg border p-3', message.role === 'user' ? 'ml-3 border-cobalt/25 bg-cobalt/5 md:ml-10' : 'mr-3 border-line bg-surface md:mr-10')}><p className="mb-2 text-xs font-medium text-muted">{message.role === 'user' ? 'You' : 'VibeGuard'}</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p></article>)}
        {send.isPending && <p role="status" className="animate-pulse-soft py-2 text-sm text-muted">Saving your turn, gathering context and asking the model…</p>}
      </div>

      {error && <div role="alert" className="mt-3 rounded-lg border border-ember/40 bg-ember/10 p-3 text-sm"><p>{error}</p><p className="mt-1 text-xs text-muted">Your turn may already be saved. No request is automatically retried.</p>{failedRequest && <button type="button" disabled={send.isPending} onClick={() => sendRequest(failedRequest)} className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-50">Retry this request</button>}</div>}

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="chat-message" className="text-sm font-medium">What are we building?</label>
        <textarea id="chat-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={6000} rows={3} disabled={send.isPending} placeholder="Describe the goal, a constraint, or what went wrong…" className="mt-2 w-full resize-y rounded-lg border border-line bg-raised p-3 text-sm placeholder:text-muted focus:border-cobalt focus:outline-none disabled:opacity-60" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted">A reply is a suggestion. Human review controls durable changes.</p><button type="submit" disabled={!draft.trim() || send.isPending || !sessionId || !status.data?.configured} className="rounded-md border border-cobalt/50 bg-cobalt/15 px-4 py-2 text-sm text-cobalt disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-cobalt">{send.isPending ? 'Working…' : 'Send message'}</button></div>
      </form>

      {reply && <div className="mt-4 space-y-3">
        <div className={cn('rounded-lg border p-3 text-sm', reply.memory.saved ? 'border-verdant/35 bg-verdant/5' : 'border-signal/40 bg-signal/10')}>
          <p>{reply.memory.saved ? 'Both conversation turns received Atlas memory receipts.' : 'The reply arrived, but its memory write was not confirmed.'}</p>
          {reply.memory.error && <p className="mt-1 text-xs text-signal">{reply.memory.error}</p>}
          {reply.memory.recallLimited && <p className="mt-1 text-xs text-signal">Long-term recall was unavailable for this reply. {reply.memory.recallReason}</p>}
          {reply.memory.policy && <p className="mt-2 text-xs">Approved context policy v{reply.memory.policy.version}: {reply.memory.policy.decision === 'cooldown' ? 'paused another recall request' : reply.memory.policy.decision === 'rate_limited' ? 'recorded a recall rate limit' : 'requested relevant memory'}.</p>}
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer text-cobalt">View the receipts</summary><dl className="mt-2 grid gap-1 break-all"><div><dt className="inline">Session: </dt><dd className="inline font-mono">{reply.sessionId}</dd></div><div><dt className="inline">Memory user: </dt><dd className="inline font-mono">{reply.memory.userId}</dd></div><div><dt className="inline">User turn: </dt><dd className="inline font-mono">{reply.memory.userReceipt.id}</dd></div><div><dt className="inline">Assistant turn: </dt><dd className="inline font-mono">{reply.memory.assistantReceipt?.id || 'Unconfirmed'}</dd></div><div><dt className="inline">Model response: </dt><dd className="inline font-mono">{reply.responseId} · {reply.model}</dd></div>{reply.memory.policy && <><div><dt className="inline">Policy: </dt><dd className="inline font-mono">{reply.memory.policy.id} v{reply.memory.policy.version} · {reply.memory.policy.hash}</dd></div><div><dt className="inline">Policy event: </dt><dd className="inline font-mono">{reply.memory.policy.eventId}</dd></div></>}</dl></details>
        </div>
        {reply.memory.recalled.length > 0 && <section aria-labelledby="recalled-notes-title"><h3 id="recalled-notes-title" className="text-sm font-medium">Notes recalled for this reply</h3><div className="mt-2 grid gap-3 md:grid-cols-2">{reply.memory.recalled.map(note => <aside key={note.id} className="rounded-lg border border-line bg-raised/40 p-3"><p className="whitespace-pre-wrap break-words text-sm">{note.content}</p><details className="mt-2 text-xs text-muted"><summary className="cursor-pointer text-cobalt">Memory provenance</summary><p className="mt-2 break-all">{note.source} · {note.id}{note.timestamp ? ` · ${note.timestamp}` : ''}</p><p className="mt-1">Recalled context can be incomplete. It does not authorize a rule change.</p></details></aside>)}</div></section>}
        <section aria-labelledby="chat-learning-title"><h3 id="chat-learning-title" className="text-sm font-medium">A little context for what just happened</h3><div className="mt-2 grid gap-3 md:grid-cols-3">{reply.knowledge.map(note => <KnowledgeDrop key={note.term} {...note} />)}</div></section>
      </div>}
      <p className="mt-4 text-xs text-muted">{storageWarning ? 'Browser history could not be saved on this device. ' : 'This device keeps the recent conversation. '}Acknowledged turns also live in Atlas memory. A new conversation keeps the server’s memory identity and gets a fresh session.</p>
    </section>
  );
}
