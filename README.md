# hipocampus

Drop-in memory harness for AI agents. Zero infrastructure — just files.

3-tier memory architecture with a 5-level compaction tree, auto-loaded ROOT.md topic index, and optional hybrid search via [qmd](https://github.com/tobi/qmd). One command to set up, works immediately with [Claude Code](https://claude.ai/code), [OpenCode](https://opencode.ai/), and [OpenClaw](https://github.com/openclaw) bots.

## Install

### As a Claude Code Plugin

```bash
/plugin marketplace add kevin-hs-sohn/hipocampus
/plugin install hipocampus@kevin-hs-sohn/hipocampus
```

Then run `npx hipocampus init` for full setup (directories, templates, search, hooks).

### Standalone (npm)

```bash
npx hipocampus init
```

This creates the full memory structure in your project:

```
MEMORY.md              # Long-term memory (OpenCode/OpenClaw — Claude Code uses platform auto memory)
USER.md                # User profile (OpenCode/OpenClaw — Claude Code uses platform auto memory)
SCRATCHPAD.md          # Active working state
WORKING.md             # Current tasks in progress
TASK-QUEUE.md          # Task backlog (queued items only)
memory/                # ROOT.md + daily logs + 5-level compaction tree
knowledge/             # Searchable knowledge base
plans/                 # Task plans
hipocampus.config.json     # Configuration
.claude/skills/        # Agent skills — Claude Code
.opencode/skills/      # Agent skills — OpenCode
.opencode/plugins/     # Compaction plugin — OpenCode
```

It also:
- Installs [qmd](https://github.com/tobi/qmd) for hybrid search (skip with `--no-search`)
- Injects the memory protocol into CLAUDE.md (Claude Code) or AGENTS.md (OpenCode/OpenClaw)
- Registers compaction hooks (Claude Code) or installs a native plugin (OpenCode) for automatic memory preservation
- Auto-loads ROOT.md into the agent's system prompt
- Adds memory files to `.gitignore`

### Options

```bash
# Disable vector search (BM25 only, saves ~2GB disk)
npx hipocampus init --no-vector

# Skip qmd entirely (compaction tree + manual file reads only)
npx hipocampus init --no-search

# Override platform detection (auto-detects by default)
npx hipocampus init --platform claude-code
npx hipocampus init --platform opencode
npx hipocampus init --platform openclaw
```

## What You Get

Install hipocampus on a Claude Code, OpenCode, or OpenClaw project, and your agent gains **persistent memory across sessions**. It remembers what you worked on, what decisions were made, what lessons were learned — and it knows what it knows without loading everything into context.

The effect is similar to injecting your entire conversation history into every API call, but at a fraction of the token cost (~3K tokens instead of 100K+).

### Why not just use a large context window?

Modern models support 200K–1M token context windows. You could theoretically dump all past history into context — 500K tokens for conversation, 500K for past memory. But this creates two problems:

1. **Attention degrades.** The more context you load, the worse the model attends to what matters. Important details from three weeks ago get drowned out by noise. The model "sees" everything but focuses on nothing.
2. **Token cost scales linearly.** Every API call pays for the full context. At 500K tokens of history injected per call, costs become prohibitive for daily use — and most of that context is irrelevant to the current task.

Hipocampus gives the agent the same awareness at ~3K tokens: ROOT.md tells it what it knows, and the agent loads specific details on demand.

Without hipocampus, when an agent doesn't know what it knows, it explores. It reads file after file trying to find relevant context — and every file it reads stays in the session context until the session ends. Ten files read and discarded is 30K+ tokens of waste, paid on every subsequent API call for the rest of the session.

Worse, when the agent doesn't know it already has the answer, it researches from scratch. You discussed database migration strategies two weeks ago, reached a decision, documented the rationale — but the agent doesn't know that knowledge exists, so it spends 20 minutes and thousands of tokens re-investigating the same question.

ROOT.md eliminates both problems. At ~3K tokens, the agent knows exactly what it has and what it doesn't — so it either retrieves the specific file it needs, or skips memory and researches only what's genuinely new. **The real savings isn't "hipocampus vs full history dump" — it's targeted retrieval vs blind exploration that pollutes your context, and instant recall vs redundant research on problems you already solved.**

## The Problem

AI agents forget everything between sessions. Existing solutions each solve part of the problem:

**Working state files (SCRATCHPAD.md, WORKING.md)** give the agent awareness of what's currently happening — active tasks, pending decisions, recent context. But they're limited to the present. They can't tell the agent about a decision made three weeks ago or a pattern that emerged over months.

**Long-term memory (MEMORY.md / platform auto memory)** persists facts and lessons across sessions. But system prompt space is finite — a 50-line memory works for the first week. After a month, hundreds of decisions and insights simply can't fit. You're forced to choose what to keep and what to lose. Worse, the agent doesn't know what it has forgotten.

**RAG (vector search, BM25)** solves the storage problem — index thousands of files and search them. But search requires **knowing what to search for**. When a user asks "how should we handle session timeouts?", the agent doesn't know whether it discussed this exact problem three weeks ago. Without awareness that the knowledge exists, it defaults to external search or guessing. **You can't search for something you don't know you know.**

### What each piece can and can't do

| Capability | Working state | Long-term memory | RAG | Compaction tree |
|---|---|---|---|---|
| Current task awareness | Yes | No | No | No |
| Persist facts across sessions | No | Yes (until overflow) | Yes (if indexed) | Yes (ROOT.md) |
| Scale over months | No | No (overflows) | Yes | Yes (self-compresses) |
| Know what you know | Current only | Only what fits | No — requires query | **Yes — ROOT.md index** |
| Retrieve specific past detail | No | No (if pruned) | **Yes — semantic search** | Yes (tree traversal) |
| Find things you didn't know to search for | No | No | No | **Yes — browse tree** |

**No single mechanism is sufficient.** Working state handles the present. Long-term memory handles key facts. RAG handles retrieval when you know what to search for. The compaction tree handles awareness and browsing. Hipocampus combines all four.

### The compaction tree's killer feature: surfacing what you didn't know to search for

RAG is powerful — but it requires a query. The agent has to already suspect that relevant context exists to form a search. The compaction tree flips this: ROOT.md puts the full topic index in the agent's context at zero extra cost, so the agent **notices** relevant past context even when the user's request doesn't hint at it.

**Example 1 — Cross-referencing past decisions:**

> User: "Refactor this API endpoint."

The agent reads ROOT.md at session start (as it always does) and sees in the Topics Index: `api-rate-limiting: discussed throttling strategy, decided on token bucket → knowledge/api-design.md (2026-03-10)`. It connects this to the refactoring task and incorporates the prior decision — even though the user said nothing about rate limiting.

A RAG-based system would never search for "rate limiting" here. The user asked for a refactor, not a rate limiting review. The connection only exists because the agent can **see** its own knowledge map.

**Example 2 — Resuming without a query:**

> User: "Continue from last time."

ROOT.md's Active Context section immediately shows what was in progress. No search needed — the answer is already loaded.

A RAG-based system can't even form a query. "Last time" has no keywords to search for, no embeddings to match against. The system would have to search for... everything? Nothing? It's a structural dead end.

**Example 3 — Discovering unexpected relevance:**

> User: "Set up CI/CD for the new microservice."

ROOT.md shows: `k8s-infra: provisioning scripts, namespace conventions → knowledge/k8s-setup.md (2026-02-15)`. The agent realizes the project already has K8s conventions documented from a month ago and follows them — instead of setting up CI/CD from scratch with potentially conflicting patterns.

RAG might find this if the agent thought to search "kubernetes" or "deployment" — but why would it? The user asked about CI/CD, not infrastructure conventions. The connection is only visible to an agent that already knows the full map of what it knows.

## Architecture — 3-Tier Memory

Hipocampus organizes memory into three tiers, like a CPU cache hierarchy:

### Layer 1 — Hot (always loaded, ~500 lines)

Injected into every API call. The agent's "working memory" — what it needs to know right now.

| File | Purpose | Why it's here |
|------|---------|---------------|
| **SCRATCHPAD.md** | Active work state — current findings, pending decisions, cross-task lessons | Without this, the agent loses track of what it's doing mid-session |
| **WORKING.md** | Tasks in progress — status, blockers, next steps | Without this, the agent doesn't know what tasks are active |
| **TASK-QUEUE.md** | Backlog of pending tasks | Without this, follow-up tasks from prior sessions are lost |
| **memory/ROOT.md** | Compaction tree root — compressed index of ALL accumulated history (~100 lines) | **The key innovation.** This is what gives the agent awareness of its entire past at ~3K tokens. Like injecting all history, but 50x cheaper. |
| **MEMORY.md** | Long-term facts, rules, lessons (OpenCode/OpenClaw — Claude Code uses platform auto memory) | Core facts that apply to every interaction |
| **USER.md** | User profile, preferences (OpenCode/OpenClaw) | Personalization across sessions |

**ROOT.md deserves special attention.** It's a ~100-line functional index that compresses ALL past conversations and work into four sections:

```markdown
## Active Context (recent ~7 days)
- hipocampus open-source: finalizing spec, ROOT.md format refactor
- legal research: Civil Act §750 brief → knowledge/legal-750.md

## Recent Patterns
- compaction design: functional sections outperform chronological for O(1) lookup

## Historical Summary
- 2026-01~02: initial 3-tier design, clawy.pro K8s launch
- 2026-03: hipocampus open-source, qmd integration

## Topics Index
- hipocampus: compaction tree, ROOT.md, skills → spec/
- legal: Civil Act §750, tort liability → knowledge/legal-750.md
- clawy.pro: K8s infra, provisioning, 80-bot deployment
```

The agent checks the **Topics Index** to decide in one glance: search memory, search externally, or answer from general knowledge. O(1) lookup — no file reads needed. This solves the "you can't search for what you don't know you know" problem.

### Layer 2 — Warm (read on demand)

Detailed records the agent reads when it needs specifics. Not loaded by default — accessed when Layer 1 indicates relevant knowledge exists.

| Path | Purpose | Why it's here |
|------|---------|---------------|
| `memory/YYYY-MM-DD.md` | Raw daily logs — structured session records | Permanent source of truth. Every decision, analysis, and outcome is recorded here. The compaction tree is built from these. |
| `knowledge/*.md` | Curated knowledge base | Deep-dive documents too large for Layer 1 but too important to only exist in daily logs |
| `plans/*.md` | Task plans and execution records | Multi-step work that spans sessions |

### Layer 3 — Cold (search + compaction tree)

Two retrieval mechanisms for finding information across months of history:

**RAG (qmd)** — Best for: specific retrieval when you know what you're looking for. "What was the DB migration decision?" → semantic search finds it. RAG excels at precision recall from large corpora.

**Compaction tree** — Best for: browsing and discovery when you're not sure what exists. The tree provides hierarchical drill-down: ROOT.md → monthly → weekly → daily → raw. This works even when RAG misses because you can browse time periods rather than searching by keyword.

```
Compaction chain: Raw → Daily → Weekly → Monthly → Root

memory/
├── ROOT.md                         # Root node — Layer 1, auto-loaded
├── 2026-03-15.md                   # Raw daily log — permanent
├── daily/2026-03-15.md             # Daily compaction node
├── weekly/2026-W11.md              # Weekly index node
└── monthly/2026-03.md              # Monthly index node
```

| What RAG does that the tree can't | What the tree does that RAG can't |
|---|---|
| Semantic similarity search ("find things related to X") | Awareness without query (ROOT.md knows what topics exist) |
| Cross-topic retrieval (find connections between unrelated logs) | Time-based browsing (what happened in January?) |
| Fast lookup in large corpora (thousands of files) | Hierarchical drill-down (month → week → day → raw) |
| | Works offline (no embedding models needed) |

Together: ROOT.md tells the agent what it knows → agent decides to search → RAG finds the specific document → or tree traversal browses the time period.

### Smart Compaction Thresholds

Below threshold, source files are copied/concatenated verbatim — no information loss. Above threshold, LLM generates keyword-dense summaries.

| Level | Threshold | Below | Above |
|-------|-----------|-------|-------|
| Raw → Daily | ~200 lines | Copy verbatim | LLM keyword-dense summary |
| Daily → Weekly | ~300 lines combined | Concat dailies | LLM keyword-dense summary |
| Weekly → Monthly | ~500 lines combined | Concat weeklies | LLM keyword-dense summary |
| Monthly → Root | Always | Recursive recompaction | — |

### How hipocampus compares

| | Ad-hoc MEMORY.md | OpenViking | **Hipocampus** |
|---|---|---|---|
| Setup | Manual | Python server + embedding model + config | **`npx hipocampus init`** |
| Infrastructure | None | Server + DB | **None — just files** |
| Search | None | Vector + directory recursive | **BM25 + vector hybrid (via qmd)** |
| Memory structure | Unstructured | Filesystem paradigm | **3-tier (hot/warm/cold)** |
| Agent integration | DIY | Plugin API | **Drop-in skills** |
| Cost optimization | None | L0/L1/L2 tiered loading | **Prompt cache friendly** |
| Knows what it knows | Only what fits (~50 lines) | No (search required) | **ROOT.md (~3K tokens)** |
| Scales over months | No — overflows | Yes | **Yes — self-compressing tree** |

## How It Runs

Hipocampus has four execution mechanisms — all set up automatically by `npx hipocampus init`. Nothing requires manual intervention after install.

**Key principle: memory writes are dispatched to subagents where possible.** On Claude Code and OpenCode, all memory writes go through subagents to keep the main session clean. On OpenClaw, hot files (WORKING.md, SCRATCHPAD.md) are written directly by the main agent at Task Start and Task End — they're already in context and light enough (~250 lines total) that subagent overhead isn't justified. Layer 2+ files (daily logs, knowledge/) still go through subagents on all platforms.

### 1. Session Protocol (agent-driven)

The hipocampus-core skill instructs the agent what to do at session start and after every task. This is injected into CLAUDE.md (Claude Code) or AGENTS.md (OpenCode/OpenClaw) during init, so the agent follows it automatically.

**Session Start (FIRST RESPONSE RULE — runs before anything else on first user message):**

```
1. Read hipocampus.config.json → determine platform
2. OpenCode/OpenClaw: Read MEMORY.md (long-term memory + Compaction Root)
3. OpenCode/OpenClaw: Read USER.md (user profile)
4. Claude Code legacy: Read MEMORY.md if it exists (migration support)
5. Read SCRATCHPAD.md — current work state
6. Read WORKING.md — active tasks
7. OpenClaw: Stale task recovery — if WORKING.md has in-progress tasks from a prior
   session, assess completion and update to done/failed/abandoned
8. Read TASK-QUEUE.md — pending items
9. Read most recent memory/daily/*.md (prior session context)
10. Compaction maintenance (subagent): dispatch subagent to scan for needs-summarization
    files → LLM summaries → hipocampus compact → qmd reindex
```

ROOT.md is auto-loaded on Claude Code (via @import). On OpenCode/OpenClaw, it's embedded as a Compaction Root section in MEMORY.md.

**End-of-Task Checkpoint:**

The checkpoint process differs by platform:

**OpenClaw — Task Lifecycle (main agent + subagent):**

Every logical work unit follows a mandatory Task Start → Task End cycle:

```
Task Start (main agent writes directly):
  1. Update WORKING.md — add in-progress entry with goal
  2. Update SCRATCHPAD.md — set current focus

Task End (main agent first, then subagent — order matters):
  1. Update WORKING.md — status → done/failed/abandoned + outcome
  2. Update SCRATCHPAD.md — remove completed items, update focus
  3. Dispatch subagent → append structured log to memory/YYYY-MM-DD.md
```

Hot files first, daily log second. This guarantees session-to-session continuity even if the subagent dispatch fails or the session ends abruptly. Quick factual questions that require no file changes skip the lifecycle entirely.

**Claude Code — via subagent:**

After completing any task, the agent dispatches a subagent to:

```
1. Append structured log to memory/YYYY-MM-DD.md
2. Update SCRATCHPAD — findings, decisions, lessons
3. Update WORKING — remove completed tasks
4. Update TASK-QUEUE — remove completed tasks, add follow-ups
```

On Claude Code, `@import` keeps hot files visible every turn, so the agent naturally updates them without explicit enforcement. The subagent handles the daily log write to protect context.

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

Claude Code, OpenCode, and OpenClaw all automatically compress conversation context when it gets too long. If the agent hasn't written to the daily log before compression, those details are **lost forever**.

The hipocampus-core skill instructs the agent to flush proactively by dispatching a subagent with a summary of recent work:

- Every ~20 messages without a checkpoint
- When the conversation is getting long
- When a significant decision or analysis was just completed
- When switching between topics within the same task

```
Session in progress
  → Task A completed → subagent: checkpoint → daily log append
  → Task B completed → subagent: checkpoint → daily log append
  → Task C in progress, long conversation...
    → ~20 messages → subagent: proactive flush → daily log append
    → significant decision → subagent: proactive flush → daily log append
  → Context window fills up → pre-compaction hook fires (see below)
```

The daily log is append-only, so multiple flushes in the same session are safe. All writes go through subagents to keep the main session clean.

### 4. Pre-Compaction + LLM Compaction (platform-specific)

PreCompact hooks only support `type: "command"` (no agent hooks). Mechanical compaction runs automatically; LLM processing is deferred to session start, heartbeat, or manual `/hipocampus-flush`.

**All platforms — mechanical compaction:**

```
Context fills up
  → Claude Code: PreCompact hook fires → hipocampus compact --stdin
  → OpenCode: session.compacted plugin event → hipocampus compact
  → OpenClaw: PreCompact hook fires → hipocampus compact --stdin
      1. Back up session transcript to memory/.session-transcript-YYYY-MM-DD.jsonl
      2. Mechanical compaction (verbatim/concat, needs-summarization marking)
      3. Update ROOT.md timestamp + sync to MEMORY.md (OpenCode/OpenClaw)
      4. qmd update + qmd embed
  → Context compression proceeds
```

**LLM compaction (needs-summarization processing):**

```
Claude Code:
  → Session Start: check needs-summarization → hipocampus-compaction skill
  → Manual: /hipocampus-flush (flush + full compaction + qmd reindex)

OpenCode:
  → Session Start: same check as Claude Code
  → session.idle plugin event: mechanical compaction after each task
  → Manual: /hipocampus-flush

OpenClaw:
  → Every heartbeat (~30 min): HEARTBEAT.md checks needs-summarization
  → Session Start: same check as Claude Code
  → Manual: /hipocampus-flush
```

| Platform | Mechanical Compaction | LLM Compaction | Manual |
|----------|----------------------|----------------|--------|
| Claude Code | PreCompact + TaskCompleted hooks | Session Start + `/hipocampus-flush` | `/hipocampus-flush` |
| OpenCode | Native plugin (session.idle + session.compacted) | Session Start + `/hipocampus-flush` | `/hipocampus-flush` |
| OpenClaw | PreCompact hook | HEARTBEAT.md + Session Start | `/hipocampus-flush` |

### ROOT.md Auto-Loading

ROOT.md must be in the agent's context at every session start. Each platform has its own mechanism:

| Platform | Mechanism | Registered by init |
|----------|-----------|-------------------|
| Claude Code | `@memory/ROOT.md` import in CLAUDE.md | Automatic |
| OpenCode | Embedded as `## Compaction Root` section in MEMORY.md (auto-synced by `hipocampus compact`) | Automatic |
| OpenClaw | Embedded as `## Compaction Root` section in MEMORY.md (auto-synced by `hipocampus compact`) | Automatic |

OpenCode and OpenClaw don't support auto-loading arbitrary files — ROOT.md can't be added to the system prompt directly. Instead, hipocampus embeds the ROOT content as a section inside MEMORY.md, which the agent reads at session start. The `hipocampus compact` command keeps this section in sync with `memory/ROOT.md`.

### Execution Summary

| Mechanism | What it does | When | Subagent | Cost |
|-----------|-------------|------|----------|------|
| Session Start (reads) | Load SCRATCHPAD, WORKING, TASK-QUEUE, recent daily | First user message | No (main session) | Read only |
| Stale task recovery (OC) | Resolve leftover in-progress tasks from prior session | First user message | No (main session) | Read + write |
| Session Start (compaction) | Process needs-summarization files | First user message | **Yes** | LLM (if files exist) |
| Task Start (OC) | Update WORKING.md + SCRATCHPAD.md | Every new logical task | No (main agent) | Write only |
| Task End (OC) | Update hot files + dispatch daily log | Every task completion | **Partial** (daily log only) | LLM |
| End-of-Task Checkpoint (CC) | Update all memory files + daily log | Every task completion | **Yes** | LLM |
| Proactive flush | Dump context to daily log | Every ~20 messages | **Yes** | LLM |
| Pre-compaction hook (CC) | Mechanical compaction + qmd reindex | Before context compression | No (command hook) | Zero LLM |
| TaskCompleted hook (CC) | Mechanical compaction | After each task | No (command hook) | Zero LLM |
| Plugin events (OCode) | Mechanical compaction | session.idle + session.compacted | No (plugin) | Zero LLM |
| Heartbeat (OpenClaw) | Process needs-summarization | Every ~30 min | Isolated session | LLM (if files exist) |
| `/hipocampus-flush` | Manual: session → daily raw + compact | On demand | **Yes** | LLM |
| ROOT.md auto-load | Topic index in system prompt | Every session start | No (platform) | ~3K tokens |

Everything is set up by `npx hipocampus init`. The user never has to think about memory management.

## File Layout After Init

```
project/
├── MEMORY.md                        (OpenCode/OpenClaw only)
├── USER.md                          (OpenCode/OpenClaw only)
├── SCRATCHPAD.md
├── WORKING.md
├── TASK-QUEUE.md
├── HEARTBEAT.md                     (OpenClaw only — heartbeat compaction checklist)
├── memory/
│   ├── ROOT.md                      # Full memory topic index (Layer 1, auto-loaded)
│   ├── (raw logs: YYYY-MM-DD.md)    # Permanent structured session records
│   ├── daily/                       # Daily compaction nodes
│   ├── weekly/                      # Weekly index nodes
│   └── monthly/                     # Monthly index nodes
├── knowledge/
├── plans/
├── .claude/                         (Claude Code)
│   ├── skills/hipocampus-*/SKILL.md
│   └── settings.json                # PreCompact + TaskCompleted hooks
├── .opencode/                       (OpenCode)
│   ├── skills/hipocampus-*/SKILL.md
│   └── plugins/hipocampus.js        # Native plugin (session.idle + session.compacted)
├── opencode.json                    (OpenCode — plugin registration)
└── hipocampus.config.json
```

## Configuration

`hipocampus.config.json` (generated by `npx hipocampus init`):

```json
{
  "platform": "claude-code",
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
| `platform` | string | auto-detected | `"claude-code"`, `"opencode"`, or `"openclaw"` — determines memory file behavior |
| `search.vector` | boolean | `true` | Enable vector embeddings (~2GB disk) |
| `search.embedModel` | string | `"auto"` | `"auto"` for embeddinggemma-300M, `"qwen3"` for CJK-optimized |
| `compaction.rootMaxTokens` | number | `3000` | Max token budget for ROOT.md (~100 lines) |

### Search

qmd is optional. Use `--no-search` during init to skip it entirely. Without qmd, the compaction tree still works via direct file reads (ROOT.md → monthly/ → weekly/ → daily/ → raw).

| Setting | Default | Description |
|---------|---------|-------------|
| `vector` | `true` | Vector search via local GGUF models (~2GB). Set `false` for BM25-only |
| `embedModel` | `"auto"` | `"auto"` for embeddinggemma-300M, `"qwen3"` for CJK-optimized |

## Skills

Hipocampus installs four agent skills (into `.claude/skills/`, `.opencode/skills/`, or `skills/` depending on platform):

- **hipocampus-core** — Session start protocol + end-of-task checkpoint. Platform-conditional: Claude Code uses platform auto memory with subagent writes; OpenCode uses MEMORY.md/USER.md with event-driven plugin compaction; OpenClaw uses MEMORY.md/USER.md with a mandatory Task Lifecycle (Task Start/End) that enforces hot file updates directly from the main agent. Defines the structured daily log format, proactive flush rules, compaction trigger check, and stale task recovery. The core discipline that makes memory work.
- **hipocampus-compaction** — Builds the 5-level compaction tree (daily/weekly/monthly/root). Smart thresholds: copy/concat below threshold, LLM keyword-dense summary above threshold. Fixed/tentative lifecycle management. Handles `needs-summarization` nodes left by mechanical compaction.
- **hipocampus-search** — Search guide: ROOT.md Topics Index for "do I know about this?" judgment, hybrid vs BM25 selection, query construction rules, compaction tree fallback traversal, and guidance for working without qmd.
- **hipocampus-flush** (`/hipocampus-flush`) — Manual memory flush via subagent: dump current session context to daily raw log + mechanical compact. Use when you want to persist session state on demand. For full LLM compaction afterwards, run hipocampus-compaction.

## Task Lifecycle

### OpenClaw (explicit enforcement)

OpenClaw lacks Claude Code's `@import` mechanism that keeps hot files visible every turn. Without explicit enforcement, hot files go stale — the agent reads them once at session start and forgets to update them. The Task Lifecycle protocol solves this:

```
TASK-QUEUE (backlog)          → pick up task
  ↓
Task Start (main agent):      → MANDATORY for every logical work unit
  ├── WORKING.md              ← add in-progress entry with goal
  └── SCRATCHPAD.md           ← set current focus
  ↓
Actively working              → follow-up messages on same task skip Task Start
  ↓
Task End (main agent first, then subagent — order matters):
  1. WORKING.md               ← status → done/failed/abandoned + outcome
  2. SCRATCHPAD.md             ← remove completed items, update focus
  3. Subagent → daily log     ← detailed structured record (permanent)
```

**What counts as a task?** A logical work unit — bug fix, feature, investigation. Quick factual questions (no file changes) skip the lifecycle.

**Stale task recovery:** At session start, if WORKING.md has in-progress tasks from a prior session, the agent assesses completion and updates status before proceeding.

### Claude Code (natural enforcement)

Claude Code's `@import` forces the agent to see SCRATCHPAD.md, WORKING.md, and TASK-QUEUE.md every turn, creating a natural feedback loop. Hot files stay current without explicit lifecycle enforcement. The daily log is written via subagent after task completion.

### Both platforms

TASK-QUEUE is a backlog only — completed tasks are removed, not archived. The daily log (`memory/YYYY-MM-DD.md`) is the permanent record of all completed work. This keeps TASK-QUEUE small and focused on what's ahead.

## Spec

The memory system is formally specified in [`spec/`](./spec/):

- [layers.md](./spec/layers.md) — 3-tier architecture, ROOT.md rationale, fixed/tentative node concept
- [file-formats.md](./spec/file-formats.md) — exact format of each file including ROOT.md and compaction nodes
- [compaction.md](./spec/compaction.md) — 5-level compaction tree algorithm, smart thresholds, lifecycle
- [checkpoint.md](./spec/checkpoint.md) — session start + end-of-task checkpoint protocol (platform-conditional)

## Multi-Developer Projects

`npx hipocampus init` auto-appends memory files to `.gitignore` — personal memory should not be committed.

**What to commit:** `hipocampus.config.json` and skills directories (`.claude/skills/`, `.opencode/skills/`, or `skills/`) — these define the shared project memory structure. All team members get the same skill documents.

**What not to commit:** Everything else (MEMORY.md, USER.md if present, SCRATCHPAD, WORKING, TASK-QUEUE, memory/, knowledge/, plans/) is personal context. Each developer runs `npx hipocampus init` to set up their own memory.

## License

MIT
