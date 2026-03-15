# engram

Drop-in memory harness for AI agents. Zero infrastructure — just files.

3-tier memory architecture with a 5-level compaction tree, auto-loaded ROOT.md topic index, and optional hybrid search via [qmd](https://github.com/tobi/qmd). One command to set up, works immediately with [Claude Code](https://claude.ai/code) and [OpenClaw](https://github.com/openclaw) bots.

## Quick Start

```bash
npx engram init
```

This creates the full memory structure in your project:

```
MEMORY.md              # Long-term memory (Core frozen + Adaptive dynamic)
USER.md                # User profile built over conversations
SCRATCHPAD.md          # Active working state
WORKING.md             # Current tasks in progress
TASK-QUEUE.md          # Task backlog (queued items only)
memory/                # ROOT.md + daily logs + 5-level compaction tree
knowledge/             # Searchable knowledge base
plans/                 # Task plans
engram.config.json     # Configuration
.claude/skills/        # Agent skills (engram-core, engram-compaction, engram-search)
```

It also:
- Installs [qmd](https://github.com/tobi/qmd) for hybrid search (skip with `--no-search`)
- Injects the memory protocol into CLAUDE.md (Claude Code) or AGENTS.md (OpenClaw)
- Registers a pre-compaction hook for automatic memory preservation
- Auto-loads ROOT.md into the agent's system prompt
- Adds memory files to `.gitignore`

### Options

```bash
# Split SCRATCHPAD/WORKING by domain (for multi-area projects)
npx engram init --domains web,backend,infra

# Disable vector search (BM25 only, saves ~2GB disk)
npx engram init --no-vector

# Skip qmd entirely (compaction tree + manual file reads only)
npx engram init --no-search
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
  WORKING.md             current tasks in progress
  TASK-QUEUE.md          task backlog (queued items only, no completed)
  memory/ROOT.md         full memory topic index (auto-loaded, ~100 lines)

Layer 2 — On-Demand (read when needed)
  memory/YYYY-MM-DD.md   raw daily logs (permanent, structured session records)
  knowledge/*.md         searchable knowledge
  plans/*.md             task plans

Layer 3 — Search (via qmd + compaction tree)
  qmd query "..."        hybrid BM25 + vector + rerank
  qmd search "..."       BM25 keyword search
  Compaction tree        ROOT → monthly → weekly → daily → raw
```

**Layer 1** stays small and stable, maximizing prompt cache hits (up to 90% token savings). ROOT.md is auto-loaded at every session start — the agent can decide whether to search memory, search externally, or answer directly without reading any other files first.

**Layer 2** stores detailed records. Daily logs are permanent and never deleted. Each log entry is a **structured session dump** — not a raw transcript, but curated records organized by topic with decisions, rationale, user feedback, data points, and file references.

**Layer 3** makes everything searchable. The 5-level compaction tree provides a hierarchical fallback when keyword search misses. qmd is optional — the compaction tree works independently via direct file reads.

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

Smart thresholds prevent information loss: below threshold, source files are copied/concatenated verbatim instead of summarized by an LLM.

| Level | Threshold | Below | Above |
|-------|-----------|-------|-------|
| Raw → Daily | ~200 lines | Copy verbatim | LLM keyword-dense summary |
| Daily → Weekly | ~300 lines combined | Concat dailies | LLM keyword-dense summary |
| Weekly → Monthly | ~500 lines combined | Concat weeklies | LLM keyword-dense summary |
| Monthly → Root | Always | Recursive recompaction | — |

### ROOT.md — "What I Know I Know"

Without a root index, the agent cannot answer "do I already know about this?" without loading memory — which costs tokens. ROOT.md solves this: a ~100-line functional index loaded automatically at every session start.

```markdown
## Active Context (recent ~7 days)
- engram open-source: finalizing spec, ROOT.md format refactor in progress
- legal research: Civil Act §750 brief, 2 precedents → knowledge/legal-750.md

## Recent Patterns
- compaction design: functional sections outperform chronological for O(1) lookup
- knowledge files: always cross-reference from Topics Index for discoverability

## Historical Summary
- 2026-01~02: initial 3-tier design, clawy.pro K8s launch
- 2026-03: engram open-source, qmd integration

## Topics Index
- engram: compaction tree, ROOT.md, skills → spec/
- legal: Civil Act §750, tort liability → knowledge/legal-750.md
- clawy.pro: K8s infra, provisioning, 80-bot deployment
- qmd: BM25, vector hybrid, embeddinggemma-300M
```

The agent uses the **Topics Index** to decide in one glance: search memory, search externally, or answer from general knowledge. O(1) lookup — no file reads needed.

## How It Runs

Engram has four execution mechanisms — all set up automatically by `npx engram init`. Nothing requires manual intervention after install.

### 1. Session Protocol (agent-driven)

The engram-core skill instructs the agent what to do at session start and after every task. This is injected into CLAUDE.md (Claude Code) or AGENTS.md (OpenClaw) during init, so the agent follows it automatically.

**Session Start (7 steps):**

```
1. Read engram.config.json → load domain-matched SCRATCHPAD/WORKING
2. Read MEMORY.md (long-term memory)
3. Read USER.md (user profile)
4. Read current domain's SCRATCHPAD and WORKING
5. Read TASK-QUEUE.md (backlog)
6. Read most recent memory/daily/*.md (prior session context)
7. Check compaction triggers → run engram-compaction if needed
```

ROOT.md is auto-loaded by the platform — no manual read needed.

**End-of-Task Checkpoint (6 steps):**

```
1. Update SCRATCHPAD — findings, decisions, lessons
2. Append to MEMORY.md — APPEND ONLY, never modify Core section
3. Update USER.md — newly learned user info
4. Append structured log to memory/YYYY-MM-DD.md (see below)
5. Update WORKING — remove completed tasks
6. Update TASK-QUEUE — remove completed tasks, add follow-ups
```

Completed tasks are removed from WORKING and TASK-QUEUE — the daily log is the permanent completion record.

### 2. Structured Daily Log (the compaction tree's source material)

Step 4 of the checkpoint is the most important. The agent writes a **structured session dump** — not a raw transcript, but a curated record for each topic discussed:

```markdown
## Investment Portfolio Construction
- request: user asked for mid/long-term portfolio suggestion
- analysis: researched 16 stocks, Attention Economy theme
- decision: 50% Core (AAPL, MSFT, ...) + 25% Growth + 20% Korea + 5% Cash
- user feedback: wants higher Korea allocation → adjust next session
- references: knowledge/investment-research.md created
- tool calls: alpha-vantage 16 calls, fmp 4 calls

## Auth Middleware Refactor
- request: review session token storage for compliance
- work done: audited current middleware, identified 3 non-compliant patterns
- decision: migrate to httpOnly cookies with SameSite=Strict
- pending: migration script needed, blocked on DB schema change
```

This format includes enough detail for the daily compaction node to extract keywords, decisions, and patterns — the raw material that feeds the entire compaction tree.

### 3. Proactive Flush (agent-driven, prevents context loss)

Both Claude Code and OpenClaw automatically compress conversation context when it gets too long. If the agent hasn't written to the daily log before compression, those details are **lost forever**.

The engram-core skill instructs the agent to flush proactively:

- Every ~20 messages without a checkpoint
- When the conversation is getting long
- When a significant decision or analysis was just completed
- When switching between topics within the same task

```
Session in progress
  → Task A completed → checkpoint → daily log append
  → Task B completed → checkpoint → daily log append
  → Task C in progress, long conversation...
    → ~20 messages → proactive flush → daily log append
    → significant decision → proactive flush → daily log append
  → Context window fills up → pre-compaction hook fires (see below)
```

The daily log is append-only, so multiple flushes in the same session are safe.

### 4. Pre-Compaction Hook (platform-driven, automatic)

When context compression is about to happen, engram hooks into the platform event to run `engram compact` — a zero-LLM-cost shell command that mechanically updates the compaction tree.

```
Context fills up
  → Platform fires pre-compaction event
  → engram compact runs automatically:
      1. Back up session transcript to memory/.session-transcript-YYYY-MM-DD.bak
      2. Raw → Daily: copy verbatim if ≤200 lines, mark for LLM summary if larger
      3. Daily → Weekly: concat if ≤300 lines combined, mark if larger
      4. Weekly → Monthly: concat if ≤500 lines combined, mark if larger
      5. Update ROOT.md timestamp + sync to MEMORY.md (OpenClaw)
      6. Re-index qmd (if installed)
  → Platform compresses context
  → Agent continues with fresh context, memory preserved on disk
```

Files that exceed thresholds are marked `needs-summarization` — the agent handles those with the engram-compaction skill at next session start, using LLM to generate keyword-dense summaries.

| Platform | Hook | Registered by init |
|----------|------|--------------------|
| Claude Code | `PreCompact` in `.claude/settings.json` | Automatic |
| OpenClaw | `preCompact` in `openclaw.json` | Automatic |

### ROOT.md Auto-Loading

ROOT.md must be in the agent's context at every session start. Each platform has its own mechanism:

| Platform | Mechanism | Registered by init |
|----------|-----------|-------------------|
| Claude Code | `@memory/ROOT.md` import in CLAUDE.md | Automatic |
| OpenClaw | Embedded as `## Compaction Root` section in MEMORY.md (auto-synced by `engram compact`) | Automatic |

OpenClaw bootstraps a fixed set of files (AGENTS.md, MEMORY.md, etc.) — ROOT.md can't be added to that list. Instead, engram embeds the ROOT content as a section inside MEMORY.md, which is always bootstrapped. The `engram compact` command keeps this section in sync with `memory/ROOT.md`.

### Execution Summary

| Mechanism | What it does | When | Cost |
|-----------|-------------|------|------|
| Session protocol | Agent reads/writes memory files | Every session start + task completion | Skill instructions (no extra LLM cost) |
| Structured daily log | Detailed per-topic session record | Every checkpoint + proactive flush | Agent writes to file |
| Proactive flush | Agent dumps context before it's lost | Every ~20 messages in long sessions | Agent writes to file |
| Pre-compaction hook | Mechanical tree update (copy/concat) | Before context compression | Zero LLM cost (shell script) |
| ROOT.md auto-load | Topic index in system prompt | Every session start | ~3K tokens |

Everything is set up by `npx engram init`. The user never has to think about memory management.

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
│   ├── (raw logs: YYYY-MM-DD.md)    # Permanent structured session records
│   ├── daily/                       # Daily compaction nodes
│   ├── weekly/                      # Weekly index nodes
│   └── monthly/                     # Monthly index nodes
├── knowledge/
├── plans/
├── .claude/
│   ├── skills/
│   │   ├── engram-core/SKILL.md
│   │   ├── engram-compaction/SKILL.md
│   │   └── engram-search/SKILL.md
│   └── settings.json                # PreCompact hook (Claude Code)
└── engram.config.json
```

## Configuration

`engram.config.json` (generated by `npx engram init`):

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

MEMORY.md, USER.md, and TASK-QUEUE.md are always global — they represent the user, not the task domain. The compaction tree is also global.

### Search

qmd is optional. Use `--no-search` during init to skip it entirely. Without qmd, the compaction tree still works via direct file reads (ROOT.md → monthly/ → weekly/ → daily/ → raw).

| Setting | Default | Description |
|---------|---------|-------------|
| `vector` | `true` | Vector search via local GGUF models (~2GB). Set `false` for BM25-only |
| `embedModel` | `"auto"` | `"auto"` for embeddinggemma-300M, `"qwen3"` for CJK-optimized |

## Skills

Engram installs three agent skills into `.claude/skills/`:

- **engram-core** — 7-step session start protocol + 6-step end-of-task checkpoint. Defines the structured daily log format, proactive flush rules, domain selection, and compaction trigger check. The core discipline that makes memory work.
- **engram-compaction** — Builds the 5-level compaction tree (daily/weekly/monthly/root). Smart thresholds: copy/concat below threshold, LLM keyword-dense summary above threshold. Fixed/tentative lifecycle management. Handles `needs-summarization` nodes left by mechanical compaction.
- **engram-search** — Search guide: ROOT.md Topics Index for "do I know about this?" judgment, hybrid vs BM25 selection, query construction rules, compaction tree fallback traversal, and guidance for working without qmd.

## Task Lifecycle

```
TASK-QUEUE (backlog)          → pick up task
  ↓
WORKING (in progress)         → actively working
  ↓
Task completed                → checkpoint fires:
  ├── daily log (permanent)   ← detailed structured record
  ├── WORKING                 ← task removed
  ├── TASK-QUEUE              ← task removed, follow-ups added
  ├── SCRATCHPAD              ← lessons, decisions updated
  └── MEMORY.md               ← key facts appended
```

TASK-QUEUE is a backlog only — completed tasks are removed, not archived. The daily log (`memory/YYYY-MM-DD.md`) is the permanent record of all completed work. This keeps TASK-QUEUE small and focused on what's ahead.

## Spec

The memory system is formally specified in [`spec/`](./spec/):

- [layers.md](./spec/layers.md) — 3-tier architecture, ROOT.md rationale, fixed/tentative node concept
- [file-formats.md](./spec/file-formats.md) — exact format of each file including ROOT.md and compaction nodes
- [compaction.md](./spec/compaction.md) — 5-level compaction tree algorithm, smart thresholds, lifecycle
- [checkpoint.md](./spec/checkpoint.md) — 7-step session start + 6-step end-of-task checkpoint protocol

## Multi-Developer Projects

`npx engram init` auto-appends memory files to `.gitignore` — personal memory should not be committed.

**What to commit:** `engram.config.json` and `.claude/skills/` — these define the shared project memory structure. All team members get the same domain partitioning and skill documents.

**What not to commit:** Everything else (MEMORY.md, USER.md, SCRATCHPAD, WORKING, TASK-QUEUE, memory/, knowledge/, plans/) is personal context. Each developer runs `npx engram init` to set up their own memory.

## Built at clawy.pro

Engram is extracted from the memory system powering 80+ production AI bots at [clawy.pro](https://clawy.pro). It's been running in production since early 2026, handling thousands of conversations across diverse use cases.

## License

MIT
