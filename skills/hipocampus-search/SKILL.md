---
name: hipocampus-search
description: "Search memory using qmd (BM25 + optional vector) and compaction tree traversal. Use ROOT.md to decide whether to search memory or look externally. Always check memory before external lookups."
---

# Hipocampus Search

## Quick Reference

| Action | Command |
|--------|---------|
| Hybrid search (best quality) | `qmd query "keyword1 keyword2"` |
| Keyword search (fast) | `qmd search "keyword1 keyword2"` |
| Vector search only | `qmd vsearch "semantic query"` |
| Find files | `qmd search "query" --files` |
| Read file | `qmd get "path/to/file.md"` |
| Re-index | `qmd update` |

## Which Search to Use

Check `hipocampus.config.json`:
- `search.vector: true` (default) → `qmd query` for best results (BM25 + vector + rerank)
- `search.vector: false` → `qmd search` for BM25 keyword search

## ROOT.md — "Do I Know About This?"

`memory/ROOT.md` is a functional index of everything in memory, auto-loaded every session. It has four sections:

- **Active Context** — current week's work and priorities (immediate situational awareness)
- **Recent Patterns** — cross-cutting insights not tied to a specific time period
- **Historical Summary** — high-level chronology of past periods
- **Topics Index** — keyword lookup table for O(1) "do I know about X?" judgment

**Before any lookup, check ROOT.md first:**

- Topic found in Topics Index → search memory (qmd or tree traversal)
- Topic NOT in Topics Index → use external search or answer from general knowledge
- This eliminates "loading to decide whether to load" — ROOT.md is always in context

**This is the core value of the compaction tree.** Search only works when you know what to search for. The Topics Index tells you what you know at a glance.

## BM25 Query Construction

When using `qmd search` (BM25 mode), queries must be **keywords**, not natural language.

### Rules
1. Use **2-4 specific keywords** — more precise = better results
2. **No natural language** — strip filler words
3. **Try variations** — if first query misses, use synonyms or related terms

### Examples

| Bad (natural language) | Good (keywords) |
|------------------------|-----------------|
| "How do I configure the database?" | "database config" |
| "What did we decide about caching?" | "caching decision" |

## Tree Traversal

When qmd search returns insufficient results, traverse the compaction tree:

```
1. ROOT.md Topics Index → confirm topic exists, note any file references
2. ROOT.md Historical Summary → identify relevant time period
3. memory/monthly/YYYY-MM.md → identify relevant week
4. memory/weekly/YYYY-WNN.md → identify relevant day
5. memory/daily/YYYY-MM-DD.md → detailed view
6. memory/YYYY-MM-DD.md → full raw original
```

Always try qmd search first. Tree traversal is the fallback.

## When to Search

- **Before any external lookup** — check ROOT.md, then search memory
- **Resuming prior work** — search for task context, past progress
- **Past decisions** — search daily logs and knowledge files
- **Credentials/configs** — search before asking user

## Without qmd

If qmd is not installed (e.g., `--no-search` was used during init, or the user has a different RAG tool), the memory system still works:

- **ROOT.md** is always available — use the Topics Index for "do I know about this?" judgment
- **Tree traversal** works without qmd — just read the files directly: ROOT → monthly/ → weekly/ → daily/ → raw
- **Manual file reads** — use `ls memory/daily/` to find files, then read them
- Skip `qmd update` / `qmd search` commands — they will fail silently

The compaction tree and checkpoint protocol are fully independent of qmd. Search is a convenience layer, not a requirement.

## After Modifying Files

If qmd is installed, re-index after changing memory or knowledge files:

```bash
qmd update
```
