"""Phase 1 COSTAR completeness check: cheap CPU features + a hand-set decision boundary (TAU).

Phase 2 replaces `_FEATURES`/`_squash` with the trained LFG intent classifier
(weights · features -> logits -> calibrated probabilities) behind the same `score_prompt` signature.
"""
from __future__ import annotations

import math
import re

from .schema import Dimension, DimensionScore

TAU = 0.5  # decision boundary per dimension; below = "missing"

# Each feature: (regex, weight). Hand-set from experience; these become the training seed for Phase 2.
_FEATURES: dict[Dimension, list[tuple[str, float]]] = {
    Dimension.context: [
        (r"\b(i have|i'm using|we use|my (app|site|project|repo|code)|currently|existing|built with|stack)\b", 1.2),
        (r"\b(next\.?js|react|python|rust|go|typescript|postgres|supabase|stripe|vercel|mongodb|django|flask)\b", 1.0),
        (r"```|\bfile\b|\berror\b", 0.6),
    ],
    Dimension.objective: [
        (r"\b(add|build|make|create|fix|implement|change|update|remove|refactor|write|set up|deploy)\b", 1.2),
        (r"\b(so that|in order to|goal|need it to|should)\b", 0.8),
    ],
    Dimension.style: [
        (r"\b(style|pattern|convention|clean|simple|minimal|idiomatic|typed|functional|follow|like the existing)\b", 1.2),
        (r"\b(no (new )?dependencies|keep it small|best practice)\b", 1.0),
    ],
    Dimension.tone: [
        (r"\b(tone|friendly|formal|casual|professional|playful|plain english|explain)\b", 1.3),
    ],
    Dimension.audience: [
        (r"\b(for (my )?(users|customers|team|clients|beginners|kids|admins)|audience|who will use|non-technical|end users)\b", 1.3),
    ],
    Dimension.response: [
        (r"\b(return|output|give me|as a|in the form|format|json|markdown|table|diff|single file|step[- ]by[- ]step|code only)\b", 1.2),
    ],
}

_BIAS = -0.6  # intercept: absent evidence -> below TAU

# Natural, inviting nudges. One sentence each, framed as a benefit, never as an error.
_ASK: dict[Dimension, str] = {
    Dimension.context: "What are you building on right now? Even \"Next.js app on Vercel\" saves a round of guessing.",
    Dimension.objective: "What should be true when this is done? One line is plenty.",
    Dimension.style: "Want it to match how your code already looks, or is anything fine?",
    Dimension.tone: "Should any words users see sound friendly, formal, or plain?",
    Dimension.audience: "Who's going to use this? That changes what \"done\" looks like.",
    Dimension.response: "Want the whole file, just the changes, or step-by-step?",
}

# Which gaps cost the most money when missing (asked first).
_PRIORITY = [Dimension.objective, Dimension.context, Dimension.audience, Dimension.response, Dimension.style, Dimension.tone]


def _squash(x: float) -> float:
    return 1 / (1 + math.exp(-4 * x))


def score_prompt(prompt: str) -> list[DimensionScore]:
    out = []
    for dim, feats in _FEATURES.items():
        z, ev = _BIAS, []
        for pat, w in feats:
            m = re.search(pat, prompt, re.IGNORECASE)
            if m:
                z += w
                ev.append(m.group(0))
        out.append(DimensionScore(dimension=dim, p_present=round(_squash(z), 3), evidence=ev))
    return out


def missing(scores: list[DimensionScore], tau: float = TAU) -> list[Dimension]:
    return [s.dimension for s in scores if s.p_present < tau]


def side_conversation(missing_dims: list[Dimension], max_questions: int = 2) -> list[str]:
    """Ask at most two things, most expensive gaps first. No question floods."""
    ordered = [d for d in _PRIORITY if d in missing_dims][:max_questions]
    return [_ASK[d] for d in ordered]
