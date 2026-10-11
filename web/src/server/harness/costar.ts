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
