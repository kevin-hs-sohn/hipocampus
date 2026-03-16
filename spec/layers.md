# Hipocampus Memory Layers

## Overview

Hipocampus organizes agent memory into three tiers optimized for cost and retrieval speed. Layer 1 is always loaded (hot), Layer 2 is read on demand (warm), Layer 3 is accessed via search or tree traversal (cold).

## Layer 1: System Prompt (Hot Memory)

Injected into every API call. Must stay small (~500 lines total across all files).

| File | Purpose | Target Size | Platform |
|------|---------|-------------|----------|
| MEMORY.md | Long-term memory (Core frozen + Adaptive dynamic) | ~50 lines | OpenClaw only |
| USER.md | User profile, preferences, communication style | ~50 lines | OpenClaw only |
| SCRATCHPAD.md | Current work state, pending decisions | ~150 lines | All |
| WORKING.md | In-progress task list | ~100 lines | All |
| TASK-QUEUE.md | Queued tasks | ~50 lines | All |
| memory/ROOT.md | Full memory topic index — "what I know I know" | ~100 lines (~3K tokens) | All |

**Properties:**
- Loaded every API call — keep lean
- Stable content maximizes prompt cache hit rate (up to 90% token savings)
- Agent-curated — the agent reads AND writes these files
- MEMORY.md has frozen Core section + compactable Adaptive section
- memory/ROOT.md is auto-loaded by the platform (not manually read by the agent)

### Platform Memory Integration

On Claude Code, MEMORY.md and USER.md are not created. The platform's built-in auto memory handles long-term fact and user profile storage. Hipocampus focuses on the compaction tree (ROOT.md), session logs, and operational state files (SCRATCHPAD, WORKING, TASK-QUEUE).

On OpenClaw, MEMORY.md and USER.md are created at project root as the platform's native memory files. ROOT.md content is embedded as a "Compaction Root" section in MEMORY.md since the platform can't auto-load separate files.

### ROOT.md Rationale

Search (qmd) only works when you know what to search for. Without a root node:
- The agent may have a reference document in memory but resorts to external search or guessing because it doesn't know the reference exists.
- Determining "do I know about this?" requires loading memory, but loading itself costs tokens.
- ROOT.md provides a ~100-line topic index — "what I know I know" — enabling the agent to decide whether to search memory, search externally, or answer directly.

**Key properties of ROOT.md:**

| Property | Value |
|----------|-------|
| File | `memory/ROOT.md` |
| Layer | Layer 1 (auto-loaded at every session start by platform) |
| Size cap | ~100 lines (~3K tokens), configurable via `compaction.rootMaxTokens` |
| Format | Functional sections: Active Context, Recent Patterns, Historical Summary, Topics Index |
| Update | Every compaction cycle (whenever tentative nodes change) |
| Structure | Active Context (current week) + Topics Index (O(1) lookup) + Historical Summary (chronology) |

ROOT.md is the top node of the 5-level compaction tree (see Layer 3). The platform injects it automatically — Claude Code via `@memory/ROOT.md` import in CLAUDE.md, OpenClaw via embedded "Compaction Root" section in MEMORY.md (synced by hipocampus-compaction after each root compaction).

**MEMORY.md vs ROOT.md:**

| | MEMORY.md | ROOT.md |
|---|---|---|
| Content | Specific facts, rules, lessons | Functional index: Active Context, Patterns, History, Topics |
| Example | "DB uses Supabase" | "db-migration: Supabase, schema changes → knowledge/db.md" |
| Purpose | Immediately applicable knowledge (what I know) | "Do I know about this?" judgment (what I know I know) |
| Size | Core ~50 lines + Adaptive ~50 lines | ~100 lines (~3K tokens) |

## Layer 2: On-Demand (Warm Memory)

Read by the agent when needed, not injected into system prompt.

| Path | Purpose | Lifecycle |
|------|---------|-----------|
| `memory/YYYY-MM-DD.md` | Daily session logs — raw detail | Permanent (never deleted) |
| `knowledge/*.md` | Detailed knowledge base | Agent-managed |
| `plans/*.md` | Task plans and execution records | Agent-managed |

**Properties:**
- Agent reads specific files via file tools or qmd search
- Daily logs are the source of truth — detailed raw records
- Knowledge files are curated by the agent for search discoverability
- No size limit per file, but agent should keep them focused
- Daily logs feed the Layer 3 compaction tree as leaf nodes (Raw level)

## Layer 3: Search (Cold Memory)

Accessed via qmd search engine or compaction tree traversal. Holds all four levels of compaction index nodes below ROOT.md.

| Path | Purpose | Fixed/Tentative |
|------|---------|----------------|
| `memory/daily/YYYY-MM-DD.md` | Daily compaction — compressed view of one day's raw logs | Tentative until date changes; then fixed |
| `memory/weekly/YYYY-WNN.md` | Weekly summary — keyword-dense index over daily nodes | Tentative until week ends + 7 days; then fixed |
| `memory/monthly/YYYY-MM.md` | Monthly summary — high-level overview over weekly nodes | Tentative until month ends + 7 days; then fixed |

**Search methods:**
- `qmd query "..."` — hybrid BM25 + vector + rerank (when vector enabled)
- `qmd search "..."` — BM25 keyword search (always available)
- Compaction tree traversal: ROOT.md → monthly → weekly → daily → raw (fallback when search misses)

**Properties:**
- Daily/weekly/monthly files are BM25-optimized index nodes (keyword-dense)
- Original raw daily files are never deleted — indexes are supplements, not replacements
- Tree traversal: start broad (ROOT.md), drill down (monthly → weekly → daily → raw)
- Vector search requires GGUF models (~2GB, auto-downloaded by qmd)
- Every compaction node carries a `status: tentative|fixed` field in its frontmatter

### Fixed vs Tentative Nodes

Every node in the compaction tree (daily/weekly/monthly) has one of two states:

- **tentative** — The period is still ongoing. The node is regenerated whenever new data arrives for that period.
- **fixed** — The period has ended. The node is never updated again.

```yaml
---
type: weekly
status: tentative   # or: fixed
period: 2026-W11
---
```

| Level | Becomes fixed when |
|-------|--------------------|
| Daily | Date changes (next calendar day begins) |
| Weekly | ISO week has ended AND 7 days have elapsed |
| Monthly | Calendar month has ended AND 7 days have elapsed |
| Root | Never — accumulates forever, self-compresses when over size cap |

## Directory Structure

```
project/
├── MEMORY.md                    # Layer 1 — long-term memory (OpenClaw only)
├── USER.md                      # Layer 1 — user profile (OpenClaw only)
├── SCRATCHPAD.md                # Layer 1 — active work state
├── WORKING.md                   # Layer 1 — current tasks
├── TASK-QUEUE.md                # Layer 1 — task queue
├── memory/                      # Layer 1 root + Layer 2 raw + Layer 3 compaction
│   ├── ROOT.md                  # Layer 1 — full memory topic index (auto-loaded)
│   ├── 2026-03-15.md            # Layer 2 — raw daily log (permanent)
│   ├── 2026-03-14.md
│   ├── daily/
│   │   └── 2026-03-15.md        # Layer 3 — daily compaction node
│   ├── weekly/
│   │   └── 2026-W11.md          # Layer 3 — weekly index node
│   └── monthly/
│       └── 2026-03.md           # Layer 3 — monthly index node
├── knowledge/                   # Layer 2
│   └── *.md
├── plans/                       # Layer 2
│   └── *.md
└── hipocampus.config.json           # Configuration
```

### 5-Level Compaction Tree

```
Raw logs (memory/YYYY-MM-DD.md)          — Layer 2, permanent
    ↓ compact
Daily nodes (memory/daily/YYYY-MM-DD.md) — Layer 3
    ↓ compact
Weekly nodes (memory/weekly/YYYY-WNN.md) — Layer 3
    ↓ compact
Monthly nodes (memory/monthly/YYYY-MM.md)— Layer 3
    ↓ compact
ROOT.md (memory/ROOT.md)                 — Layer 1, auto-loaded
```

**Compaction chain:** Raw → Daily → Weekly → Monthly → Root
