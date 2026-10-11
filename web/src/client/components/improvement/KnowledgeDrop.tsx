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
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt">Learn the term · {term}</summary>
        <p className="mt-2 leading-relaxed"><span className="font-medium">Why this is here:</span> {whyNow}</p>
        <p className="mt-2 break-words leading-relaxed text-muted">Curated explanation · {source}</p>
      </details>
    </aside>
  );
}
