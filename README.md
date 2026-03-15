# engram

Drop-in memory harness for AI agents. Zero infrastructure — just files.

3-tier memory architecture with a 5-level compaction tree, auto-loaded ROOT.md topic index, and hybrid search via [qmd](https://github.com/tobi/qmd). One command to set up, works immediately with [Claude Code](https://claude.ai/code) and [OpenClaw](https://github.com/openclaw) bots.

## Quick Start

```bash
npx engram init
```

This creates the full memory structure in your project:

```
MEMORY.md              # Long-term memory (Core frozen + Adaptive dynamic)
USER.md                # User profile built over conversations
SCRATCHPAD.md          # Active working state
WORKING.md             # Current tasks
TASK-QUEUE.md          # Task backlog
memory/                # ROOT.md + daily logs + 5-level compaction tree
knowledge/             # Searchable knowledge base
plans/                 # Task plans
engram.config.json     # Configuration
.claude/skills/        # Agent skills (engram-core, engram-compaction, engram-search)
```

It also installs [qmd](https://github.com/tobi/qmd) if missing, registers search collections, and generates vector embeddings for hybrid search.

### Options

```bash
# Split SCRATCHPAD/WORKING by domain (for multi-area projects)
npx engram init --domains web,backend,infra

# Disable vector search (BM25 only, saves ~2GB disk)
npx engram init --no-vector
```

## The Problem

AI agents forget everything between sessions. The standard solutions each solve part of the problem, but none solve it completely:

### MEMORY.md alone is not enough

Claude Code's auto-memory and OpenClaw's MEMORY.md are injected into every API call — the agent "remembers" whatever is written there. But system prompt space is finite. A 50-line MEMORY.md works for the first week. After a month of daily use, you have hundreds of decisions, lessons, and context that simply cannot fit. You're forced to choose what to keep and what to lose.

Worse, the agent doesn't know what it has forgotten. It can't search what isn't there.

### RAG and vector search are not enough

RAG (qmd, embeddings, vector search) solves the storage problem — you can index thousands of files and search them. But search requires **knowing what to search for**. When a user asks "what was that paper about compaction trees?", the agent can search for it. But when the user asks "how should we handle session timeouts?" — the agent doesn't know whether it has relevant past context or not. It might have discussed this exact problem three weeks ago, but without awareness that the knowledge exists, it defaults to external search or guessing.

The fundamental gap: **you can't search for something you don't know you know.**

### The missing piece: awareness without loading

The real problem is the cost of awareness. Loading all past context into every API call would give the agent perfect memory, but at 100K+ tokens per month, this is prohibitively expensive. Not loading it means the agent is unaware of its own knowledge.

Engram solves this with a **3-tier architecture** and a **compaction tree with a root index**:

- **Layer 1 (Hot):** ~500 lines always loaded — includes ROOT.md, a ~100-line topic index that tells the agent "what I know I know" at ~3K tokens per call
- **Layer 2 (Warm):** detailed records read on demand — daily logs, knowledge files, plans
- **Layer 3 (Cold):** searchable via qmd — the compaction tree (daily → weekly → monthly summaries) provides hierarchical drill-down when search misses

ROOT.md is the key innovation. It's a functional index with four sections: Active Context (what's happening now), Recent Patterns (cross-cutting insights), Historical Summary (compressed timeline), and Topics Index (O(1) keyword lookup). The agent checks the Topics Index to decide in one glance: search memory, search externally, or answer from general knowledge. No loading required.

### How engram compares

| | MEMORY.md only | RAG only | **Engram** |
|---|---|---|---|
| Remembers past sessions | Until it overflows | If you search for it | **Always — tiered storage** |
| Knows what it knows | Only what fits in ~50 lines | Only if you ask the right query | **ROOT.md topic index (~3K tokens)** |
| Cost per API call | Low (small context) | Low (no injection) | **Low (~3K extra tokens for ROOT.md)** |
| Setup | None | Server + embeddings + config | **`npx engram init`** |
| Infrastructure | None | Vector DB or embedding service | **None — just files** |
| Scales over months | No — overflows | Yes — but blind to own knowledge | **Yes — compaction tree self-compresses** |

## Architecture

```
Layer 1 — System Prompt (every API call, ~500 lines total)
  MEMORY.md              long-term memory (Core frozen + Adaptive dynamic)
  USER.md                user profile
  SCRATCHPAD.md          active work state
  WORKING.md             current tasks
  TASK-QUEUE.md          task backlog
  memory/ROOT.md         full memory topic index (auto-loaded, ~100 lines)

Layer 2 — On-Demand (read when needed)
  memory/YYYY-MM-DD.md   raw daily logs (permanent)
  knowledge/*.md         searchable knowledge
  plans/*.md             task plans

Layer 3 — Search (via qmd + compaction tree)
  qmd query "..."        hybrid BM25 + vector + rerank
  qmd search "..."       BM25 keyword search
  Compaction tree        ROOT.md → monthly → weekly → daily → raw
```

**Layer 1** stays small and stable, maximizing prompt cache hits (up to 90% token savings). ROOT.md is auto-loaded at every session start — the agent can decide whether to search memory, search externally, or answer directly without reading any other files first.

**Layer 2** stores detailed records. Daily logs are permanent and never deleted.

**Layer 3** makes everything searchable. The 5-level compaction tree (daily/weekly/monthly summaries + root index) provides a hierarchical fallback when keyword search misses.

### 5-Level Compaction Tree

```
memory/
├── ROOT.md                         # Root node — topic index, Layer 1, auto-loaded
├── 2026-03-15.md                   # Raw daily log — permanent, Layer 2
├── daily/
│   └── 2026-03-15.md               # Daily compaction node — Layer 3
├── weekly/
│   └── 2026-W11.md                 # Weekly index node — Layer 3
└── monthly/
    └── 2026-03.md                  # Monthly index node — Layer 3
```

**Compaction chain:** Raw → Daily → Weekly → Monthly → Root

Each node carries `status: tentative|fixed`. Tentative nodes are regenerated when new data arrives; fixed nodes are never updated again. ROOT.md is always tentative — it accumulates forever and self-compresses when it exceeds the size cap.

Smart thresholds prevent information loss: below threshold, source files are copied/concatenated verbatim instead of summarized.

### ROOT.md — "What I Know I Know"

Without a root index, the agent cannot answer "do I already know about this?" without loading memory — which costs tokens. ROOT.md solves this: a ~100-line functional index loaded automatically at every session start. It has four sections — Active Context (current work), Recent Patterns (cross-cutting insights), Historical Summary (chronology), and Topics Index (O(1) keyword lookup). The agent uses the Topics Index to decide in one glance whether to search internal memory, search externally, or answer from general knowledge.

## File Layout After Init

```
project/
├── MEMORY.md
├── USER.md
├── SCRATCHPAD.md                    (or per-domain SCRATCHPAD-*.md)
├── WORKING.md                       (or per-domain WORKING-*.md)
├── TASK-QUEUE.md
├── memory/
│   ├── ROOT.md                      # Full memory topic index (Layer 1, auto-loaded)
│   ├── (raw logs: YYYY-MM-DD.md)    # Permanent raw session records
│   ├── daily/                       # Daily compaction nodes
│   ├── weekly/                      # Weekly index nodes
│   └── monthly/                     # Monthly index nodes
├── knowledge/
├── plans/
├── .claude/skills/
│   ├── engram-core/SKILL.md
│   ├── engram-compaction/SKILL.md
│   └── engram-search/SKILL.md
└── engram.config.json
```

## Configuration

`engram.config.json`:

```json
{
  "domains": {
    "default": {
      "scratchpad": "SCRATCHPAD.md",
      "working": "WORKING.md"
    }
  },
  "search": {
    "vector": true,
    "embedModel": "auto"
  },
  "compaction": {
    "rootMaxTokens": 3000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `domains` | object | `{ "default": {...} }` | Domain-to-file mapping for SCRATCHPAD/WORKING |
| `search.vector` | boolean | `true` | Enable vector embeddings (~2GB disk) |
| `search.embedModel` | string | `"auto"` | `"auto"` for embeddinggemma-300M, `"qwen3"` for CJK-optimized |
| `compaction.rootMaxTokens` | number | `3000` | Max token budget for ROOT.md (~100 lines) |

### Domain Partitioning

For projects with distinct areas, split work-state files by domain:

```json
{
  "domains": {
    "web": {
      "scratchpad": "SCRATCHPAD-WEB.md",
      "working": "WORKING-WEB.md"
    },
    "backend": {
      "scratchpad": "SCRATCHPAD-BACKEND.md",
      "working": "WORKING-BACKEND.md"
    }
  }
}
```

MEMORY.md and USER.md are always global — they represent the user, not the task domain.

### Search

| Setting | Default | Description |
|---------|---------|-------------|
| `vector` | `true` | Vector search via local GGUF models (~2GB). Set `false` for BM25-only |
| `embedModel` | `"auto"` | `"auto"` for embeddinggemma-300M, `"qwen3"` for CJK-optimized |

## Skills

Engram installs three agent skills into `.claude/skills/`:

- **engram-core** — 7-step session start protocol + 6-step end-of-task checkpoint. Handles domain selection, ROOT.md-guided judgment, and compaction trigger check on each session start.
- **engram-compaction** — Builds the 5-level compaction tree (daily/weekly/monthly/root). Smart thresholds: copy/concat below threshold, LLM keyword-dense summary above threshold. Fixed/tentative lifecycle management.
- **engram-search** — Search guide: ROOT.md-based judgment ("do I know about this?"), hybrid vs BM25 selection, query construction, compaction tree fallback traversal.

## How It Runs

Engram has three execution mechanisms — all set up automatically by `npx engram init`. Nothing requires manual intervention after install.

### 1. Session Protocol (agent-driven)

The engram-core skill instructs the agent what to do at session start and after every task. This is injected into CLAUDE.md (Claude Code) or AGENTS.md (OpenClaw) during init, so the agent follows it automatically.

```
Session Start (7 steps):
  1. Read config → load domain-matched SCRATCHPAD/WORKING
  2. Read MEMORY.md, USER.md, TASK-QUEUE.md
  3. ROOT.md is auto-loaded (full memory topic index)
  4. Read most recent daily compaction node
  5. Check compaction triggers

End-of-Task Checkpoint (6 steps):
  1. Update SCRATCHPAD, MEMORY.md, USER.md
  2. Append structured log to memory/YYYY-MM-DD.md
  3. Update WORKING, TASK-QUEUE
```

The daily log is the critical piece — the agent writes a **structured session dump** for each topic: what was requested, what was done, decisions made, user feedback, data points, files created, and references. This is the compaction tree's source material.

**Proactive flush:** The agent doesn't wait for task completion. During long conversations, it dumps to the daily log every ~20 messages or whenever a significant decision is made. This protects against context compression — if the platform compresses the conversation, undumped details are lost forever.

### 2. Pre-Compaction Hook (platform-driven, automatic)

Both Claude Code and OpenClaw compress conversation context when it gets too long. Engram hooks into this event to run `engram compact` automatically **before** compression happens.

```
Context fills up
  → Platform fires pre-compaction event
  → engram compact runs automatically:
      1. Back up session transcript to memory/.session-transcript-YYYY-MM-DD.bak
      2. Raw → Daily: copy verbatim if ≤200 lines, mark for LLM summary if larger
      3. Daily → Weekly: concat if ≤300 lines combined, mark if larger
      4. Weekly → Monthly: concat if ≤500 lines combined, mark if larger
      5. Update ROOT.md timestamp, re-index qmd
  → Platform compresses context
  → Agent continues with fresh context, memory preserved on disk
```

This runs as a shell command — no LLM calls, no tokens spent. Files that exceed thresholds are marked `needs-summarization` for the agent to handle with the engram-compaction skill at next session start.

| Platform | Hook | Registered by init |
|----------|------|--------------------|
| Claude Code | `PreCompact` in `.claude/settings.json` | Automatic |
| OpenClaw | `preCompact` in `openclaw.json` | Automatic |

### 3. ROOT.md Auto-Loading (platform-driven, automatic)

ROOT.md must be in the agent's context at every session start — it's the "what I know I know" index that enables search-or-not decisions. Each platform has its own mechanism:

| Platform | Mechanism | Registered by init |
|----------|-----------|-------------------|
| Claude Code | `@memory/ROOT.md` import in CLAUDE.md | Automatic |
| OpenClaw | `memory/ROOT.md` in `bootstrapFiles` array | Automatic |

### Summary

| Mechanism | What it does | When it runs | Cost |
|-----------|-------------|--------------|------|
| Session protocol | Agent reads/writes memory files | Every session start + task completion | Agent follows skill instructions |
| Pre-compaction hook | Mechanical compaction (copy/concat) | Before context compression | Zero LLM cost (shell script) |
| ROOT.md auto-load | Topic index in system prompt | Every session start | ~3K tokens |
| Proactive flush | Agent dumps context to daily log | Every ~20 messages in long sessions | Agent writes to file |

Everything is set up by `npx engram init`. The user never has to think about memory management.

## Spec

The memory system is formally specified in [`spec/`](./spec/):

- [layers.md](./spec/layers.md) — 3-tier architecture, ROOT.md rationale, fixed/tentative node concept
- [file-formats.md](./spec/file-formats.md) — exact format of each file including ROOT.md and daily compaction nodes
- [compaction.md](./spec/compaction.md) — 5-level compaction tree algorithm, smart thresholds, lifecycle
- [checkpoint.md](./spec/checkpoint.md) — 7-step session start + 6-step end-of-task checkpoint protocol

## Multi-Developer Projects

`npx engram init` auto-appends memory files to `.gitignore` — personal memory (MEMORY.md, USER.md, SCRATCHPAD, WORKING, TASK-QUEUE, memory/, knowledge/, plans/) should not be committed.

**What to commit:** `engram.config.json` and `.claude/skills/` — these define the shared project memory structure. All team members get the same domain partitioning and skill documents.

**What not to commit:** Everything else is personal context. Each developer runs `npx engram init` to set up their own memory.

## Built at clawy.pro

Engram is extracted from the memory system powering 80+ production AI bots at [clawy.pro](https://clawy.pro). It's been running in production since early 2026, handling thousands of conversations across diverse use cases.

## License

MIT
