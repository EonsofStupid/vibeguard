/** COSTAR completeness: cheap features + a hand-set decision boundary (Phase 1). Phase 2 = trained classifier, same signature. */
export const DIMENSIONS = ['context', 'objective', 'style', 'tone', 'audience', 'response'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const TAU = 0.5;
const BIAS = -0.6;

const FEATURES: Record<Dimension, [RegExp, number][]> = {
  context: [[/\b(i have|i'm using|we use|my (app|site|project|repo|code)|currently|existing|built with|stack)\b/i, 1.2],
            [/\b(next\.?js|react|python|rust|go|typescript|postgres|supabase|stripe|vercel|mongodb|django|flask)\b/i, 1.0],
            [/```|\bfile\b|\berror\b/i, 0.6]],
  objective: [[/\b(add|build|make|create|fix|implement|change|update|remove|refactor|write|set up|deploy)\b/i, 1.2],
              [/\b(so that|in order to|goal|need it to|should)\b/i, 0.8]],
  style: [[/\b(style|pattern|convention|clean|simple|minimal|idiomatic|typed|functional|follow|like the existing)\b/i, 1.2],
          [/\b(no (new )?dependencies|keep it small|best practice)\b/i, 1.0]],
  tone: [[/\b(tone|friendly|formal|casual|professional|playful|plain english|explain)\b/i, 1.3]],
  audience: [[/\b(for (my )?(users|customers|team|clients|beginners|kids|admins)|audience|who will use|non-technical|end users)\b/i, 1.3]],
  response: [[/\b(return|output|give me|as a|in the form|format|json|markdown|table|diff|single file|step[- ]by[- ]step|code only)\b/i, 1.2]],
};

const ASK: Record<Dimension, string> = {
  context: 'What are you building on right now? Even "Next.js app on Vercel" saves a round of guessing.',
  objective: 'What should be true when this is done? One line is plenty.',
  style: 'Want it to match how your code already looks, or is anything fine?',
  tone: 'Should any words users see sound friendly, formal, or plain?',
  audience: "Who's going to use this? That changes what \"done\" looks like.",
  response: 'Want the whole file, just the changes, or step-by-step?',
};
const PRIORITY: Dimension[] = ['objective', 'context', 'audience', 'response', 'style', 'tone'];

/** Quick-pick answers per dimension. The server decides which cards exist and in what order; the client only renders. */
const QUICK_PICKS: Record<Dimension, { label: string; text: string }[]> = {
  context: [
    { label: 'Next.js on Vercel', text: "I'm using Next.js on Vercel." },
    { label: 'React + Supabase', text: 'My app is React with Supabase.' },
    { label: 'Python / Flask', text: 'My app is Python with Flask.' },
    { label: 'No code yet', text: 'I have no existing code yet.' },
  ],
  objective: [
    { label: 'Customers can pay', text: 'so that a customer can pay and I see the order.' },
    { label: 'Fix a bug', text: 'I need to fix a bug so that the feature works again.' },
    { label: 'Ship a prototype', text: 'I want to build a prototype I can show people.' },
  ],
  audience: [
    { label: 'My customers', text: 'This is for my customers, non-technical end users.' },
    { label: 'Just me', text: 'This is just for me.' },
    { label: 'My team', text: 'This is for my team.' },
  ],
  response: [
    { label: 'Whole file', text: 'Give me the whole file.' },
    { label: 'Just the changes', text: 'Give me just the changes as a diff.' },
    { label: 'Step-by-step', text: 'Walk me through it step by step.' },
  ],
  style: [
    { label: 'Match my code', text: 'Follow the existing style and patterns in my code.' },
    { label: 'Keep it simple', text: 'Keep it simple, no new dependencies.' },
  ],
  tone: [
    { label: 'Friendly', text: 'Any words users see should sound friendly.' },
    { label: 'Formal', text: 'Any words users see should sound formal.' },
    { label: 'Plain', text: 'Keep user-facing text in plain English.' },
  ],
};

export interface UiCard { id: Dimension; question: string; options: { label: string; text: string }[]; freeText: boolean }
export interface UiSpec { type: 'form'; version: 1; cards: UiCard[]; done: boolean }

/** Agent-generated UI: a declarative form spec for the gaps, most expensive gap first, at most two cards per turn. */
export function uiSpec(gaps: Dimension[], max = 2): UiSpec {
  const cards = PRIORITY.filter((d) => gaps.includes(d)).slice(0, max)
    .map((d) => ({ id: d, question: ASK[d], options: QUICK_PICKS[d], freeText: true }));
  return { type: 'form', version: 1, cards, done: cards.length === 0 };
}
const squash = (x: number) => 1 / (1 + Math.exp(-4 * x));

export function scorePrompt(prompt: string) {
  return DIMENSIONS.map((dimension) => {
    let z = BIAS; const evidence: string[] = [];
    for (const [re, w] of FEATURES[dimension]) { const m = prompt.match(re); if (m) { z += w; evidence.push(m[0]); } }
    return { dimension, p_present: +squash(z).toFixed(3), evidence };
  });
}
export function missing(scores: ReturnType<typeof scorePrompt>, tau = TAU): Dimension[] {
  return scores.filter((s) => s.p_present < tau).map((s) => s.dimension);
}
export function sideConversation(gaps: Dimension[], max = 2): string[] {
  return PRIORITY.filter((d) => gaps.includes(d)).slice(0, max).map((d) => ASK[d]);
}
