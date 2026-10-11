export type Knowledge = {
  title: string;
  explanation: string;
  term: string;
  whyNow: string;
  source: string;
};

/** Curated explanations are selected by application state, never presented as recalled user facts. */
export function KnowledgeDrop({ title, explanation, term, whyNow, source }: Knowledge) {
  return (
    <aside className="rounded-xl border border-line bg-raised/60 p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-cobalt">Did you know?</p>
      <h3 className="mt-1 font-display text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{explanation}</p>
      <KnowledgePopup title={title} explanation={explanation} term={term} whyNow={whyNow} source={source} />
    </aside>
  );
}
import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';


function KnowledgePopup({ title, explanation, term, whyNow, source }: Knowledge) {
  return <Popover.Root modal={false}>
    <Popover.Trigger className="mt-3 rounded-md border border-cobalt/30 bg-cobalt/10 px-3 py-2 text-xs text-cobalt focus-visible:ring-2 focus-visible:ring-cobalt">Knowledge drop · {term}</Popover.Trigger>
    <Popover.Portal><Popover.Positioner side="top" sideOffset={10} className="z-40">
      <Popover.Popup className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-cobalt/40 bg-surface p-5 text-text shadow-2xl outline-none">
        <p className="text-[10px] uppercase tracking-widest text-cobalt">In plain language · {term}</p>
        <Popover.Title className="mt-2 font-display text-lg font-semibold">{title}</Popover.Title>
        <Popover.Description className="mt-2 text-sm leading-relaxed">{explanation}</Popover.Description>
        <p className="mt-3 text-sm text-muted"><strong>Why now:</strong> {whyNow}</p>
        <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer text-cobalt">Where this comes from</summary><p className="mt-2 break-words">Curated explanation · {source}</p></details>
        <Popover.Close className="mt-4 rounded-md border border-line px-3 py-1.5 text-xs hover:bg-raised">Got it</Popover.Close>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}

/** A non-blocking, dismissible prompt appears for the current reply's actual context. */
export function KnowledgeNudge(note: Knowledge) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return <aside aria-label="Contextual knowledge drop" className="fixed bottom-4 right-4 z-40 w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-cobalt/40 bg-surface p-4 shadow-2xl animate-fade-up">
    <div className="flex items-center justify-between gap-3"><p className="text-[10px] uppercase tracking-widest text-cobalt">Did you know?</p><button type="button" aria-label="Dismiss knowledge drop" onClick={() => setVisible(false)} className="rounded px-2 py-1 text-xs text-muted hover:text-text">✕</button></div>
    <p className="mt-1 text-sm font-medium">{note.title}</p>
    <KnowledgePopup {...note} />
  </aside>;
}
