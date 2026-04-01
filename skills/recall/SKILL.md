---
name: hipocampus-recall
description: "Memory recall guide. Structured retrieval from hipocampus memory — ROOT.md triage, manifest-based LLM selection, qmd search fallback."
---

# Memory Recall Protocol

Use this when the user's question may relate to past memory. Three-step fallback: ROOT.md O(1) lookup → manifest LLM selection → qmd search.

## Step 1: ROOT.md Triage (O(1) — always try first)

Check ROOT.md Topics Index for the query topic.

- **Direct match found** → read the referenced file (knowledge/, daily log date, etc.). Done.
- **Partial match / related topic found** → read referenced file, check if it answers the query. Done if yes.
- **No match at all** → proceed to Step 2.

**Decision rule:** If Topics Index contains a keyword within 1 semantic hop of the query, it's a match. "배포" matches "deployment". "CI/CD" matches "github-actions".

## Step 2: Manifest-Based LLM Selection (when ROOT.md is insufficient)

Use this ONLY when ROOT.md Topics Index has no relevant match but you suspect memory may exist (e.g., the user references something that sounds familiar, or the topic is cross-domain).

1. **Build manifest** from compaction node frontmatter (NOT full content):
   - Read `memory/weekly/*.md` frontmatter only (type, period, topics)
   - Read `memory/monthly/*.md` frontmatter only (type, period, topics)
   - Read `knowledge/*.md` first 3 lines only
   - Skip `memory/daily/` (already rolled up into weekly)

2. **Self-evaluate:** Given the manifest and the user's query, select up to 5 most relevant files.

3. **Load selected files** in full and extract the answer.

**Token budget:** Manifest should be <500 tokens. If too large, use monthly nodes only.

## Step 3: qmd Search (fallback)

If Step 1-2 don't find the answer and qmd is installed:

```bash
qmd query "keyword1 keyword2"      # hybrid (BM25 + vector)
qmd search "keyword1 keyword2"     # BM25 only
qmd vsearch "semantic query"       # vector only
```

Use 2-4 specific keywords. Try variations if first query misses.

## Freshness Warnings

When recalling memory, check the source age:

- `project` type + >30 days old: append warning — "이 정보는 {N}일 전 기록입니다. 현재 상태를 확인하세요."
- `reference` type + `[?]` marker: append warning — "이 참조는 검증되지 않았습니다. 접근 가능 여부를 확인하세요."
- `user`/`feedback` type: no age warning (these are durable).

## When NOT to Use Recall

- If the answer is clearly in ROOT.md Active Context → just use it directly
- If the question is about code/files → read the code, don't search memory
- If the question is about git history → use git log, not memory

## Key Principles

- ROOT.md O(1) triage is the primary path — Step 2/3 are fallbacks
- Never load full content in Step 2 manifest phase — frontmatter only
- Manifest LLM selection leverages semantic understanding (solves keyword mismatch)
- Minimize token usage: most recalls should resolve at Step 1
