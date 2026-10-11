from vibeguard.costar import Dimension, score_prompt, side_conversation
from vibeguard.costar.check import missing


def test_vague_prompt_is_missing_context_and_audience():
    m = missing(score_prompt("make it take payments"))
    assert Dimension.context in m and Dimension.audience in m
    assert Dimension.objective not in m


def test_rich_prompt_is_mostly_complete():
    p = ("I'm using Next.js on Vercel. Add Stripe checkout so that my customers can pay. "
         "Keep it simple and follow the existing style, friendly tone, for non-technical end users. "
         "Give me the diff only.")
    assert missing(score_prompt(p)) == []


def test_side_conversation_asks_at_most_two_and_most_expensive_first():
    qs = side_conversation(list(Dimension))
    assert len(qs) == 2
    assert qs[0].startswith("What should be true")
