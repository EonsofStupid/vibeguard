---
category_id: cost.unbounded_api_calls
title: Unbounded paid API calls
signal: Does the code call a paid API inside a loop or retry with no limit?
why_it_matters: A loop like this can quietly bill you for thousands of calls.
severity: critical
---

# Unbounded paid API calls

A loop like this can quietly bill you for thousands of calls.
