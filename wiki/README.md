# VibeGuard wiki

Flat-file memory. One record per Markdown file, YAML frontmatter holds the typed fields, body holds human notes.

| Folder | Agent Engine memory type | Record |
| --- | --- | --- |
| rules/ | procedural | GuardrailRule |
| runs/ | episodic | Run trace + metrics |
| lexicon/ | semantic | LexiconEntry |
| failures/ | taxonomic | FailureCategory |
| costar/ | short-term | CostarCapture |
| audit/ | — | append-only gate log |
