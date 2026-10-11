from vibeguard.failures import SEED_CATEGORIES, FailureCategory
from vibeguard.lexicon import resolve_label
from vibeguard.storage import FlatFileStore


def test_lexicon_resolves_vibecoder_phrasing():
    top = resolve_label("my site keeps charging me money", k=3)
    assert top[0][0].canonical_label.startswith("unbounded API usage")


def test_flatfile_roundtrip(tmp_path):
    s = FlatFileStore(tmp_path)
    c = SEED_CATEGORIES[0]
    s.write("failures", c.category_id, c, body="# note")
    assert s.read("failures", c.category_id, FailureCategory) == c
    assert list(s.list("failures", FailureCategory)) == [c]
