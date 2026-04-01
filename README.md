# hipocampus

Drop-in **proactive memory** harness for AI agents. Zero infrastructure — just files.

One command to set up. Works immediately with [Claude Code](https://claude.ai/code), [OpenCode](https://opencode.ai/), and [OpenClaw](https://github.com/openclaw).

## Benchmark

Evaluated on [MemAware](https://github.com/kevin-hs-sohn/memaware) — 900 implicit context questions across 3 months of conversation history. The agent must proactively surface relevant past context that the user never explicitly asks about.

| Method | Easy (n=300) | Medium (n=300) | Hard (n=300) | **Overall** |
|--------|:---:|:---:|:---:|:---:|
| No Memory | 1.0% | 0.7% | 0.7% | 0.8% |
| BM25 Search | 4.7% | 1.7% | 2.0% | 2.8% |
| BM25 + Vector Search | 6.0% | 3.7% | 0.7% | 3.4% |
| **Hipocampus (tree only)** | **14.7%** | **5.7%** | **7.3%** | **9.2%** |
| **Hipocampus + BM25** | **18.7%** | **10.0%** | **5.7%** | **11.4%** |
| **Hipocampus + Vector** | **26.0%** | **18.0%** | **8.0%** | **17.3%** |
| **Hipocampus + Vector (10K ROOT)** | **34.0%** | **21.0%** | **8.0%** | **21.0%** |

Hipocampus + Vector is **21.6x better than no memory** and **5.1x better than search alone**. On hard questions (cross-domain, zero keyword overlap), Hipocampus scores 8.0% vs 0.7% for vector search — **11.4x better**. Search structurally cannot find these connections; the compaction tree can.

Increasing the ROOT.md budget from 3K to 10K tokens (120 topics vs 39) improves Easy from 26% to 34% and overall from 17.3% to 21.0% — more topic coverage means more connections found. Hard tier remains at 8.0%, indicating cross-domain reasoning is bottlenecked by the answer model, not the index size.

## Install

### Claude Code Plugin

```bash
/plugin marketplace add kevin-hs-sohn/hipocampus
/plugin install hipocampus@kevin-hs-sohn/hipocampus
```

Then run `npx hipocampus init` for full setup.

### Standalone (npm)

```bash
npx hipocampus init
```

### Options

```bash
npx hipocampus init --no-vector    # BM25 only (saves ~2GB disk)
npx hipocampus init --no-search    # Compaction tree only, no qmd
npx hipocampus init --platform claude-code  # Override platform detection
```

## The Problem: You Can't Search for What You Don't Know You Know

AI agents forget everything between sessions. The obvious solutions — RAG, long context windows, memory files — each solve part of the problem. But they all miss the hardest part: **knowing that relevant context exists when nobody asked about it.**

### A concrete example

You ask your agent: "Refactor this API endpoint for the new payment flow."

Three weeks ago, you and the agent had a long discussion about API rate limiting and decided on a token bucket strategy. That decision is recorded in the session logs. But the agent doesn't know it exists — so it refactors the endpoint without considering rate limits. The payment flow starts dropping requests under load a week later.

This isn't a retrieval failure. The agent never searched for "rate limiting" because the user asked about "payment flow." **There is no search query that connects these.** The connection only exists if the agent has a holistic view of its own knowledge.

### Why existing approaches fail

**Large context windows (200K–1M tokens):** You could dump all history into context. But attention degrades with length — important details from three weeks ago get drowned by noise. And every API call pays for the full context. At 500K tokens per call, costs become prohibitive.

**RAG (vector search, BM25):** Powerful when you know what to search for. But search requires a query, and a query requires suspecting that relevant context exists. Our [MemAware](https://github.com/kevin-hs-sohn/memaware) benchmark confirms: BM25 search scores just 2.8% on implicit context — barely better than no memory (0.8%), while consuming 5x the tokens. **Search is a precision tool for known unknowns. It cannot help with unknown unknowns.**

**Memory files (MEMORY.md, auto memory):** Good for the first week. After a month, hundreds of decisions and insights can't fit in a system prompt. You're forced to choose what to keep, and the agent doesn't know what it has forgotten.

### What hipocampus does differently

Hipocampus maintains a **~3K token topic index (ROOT.md)** that compresses your entire conversation history into a scannable overview — like a table of contents for everything the agent has ever discussed. This is auto-loaded into every session.

When a request comes in, the agent already sees all past topics at zero search cost. It notices connections that search would miss — "this refactoring task relates to the rate limiting decision from three weeks ago" — and retrieves specific details on demand via search or tree traversal.

The effect is similar to injecting your full history into every API call, at a fraction of the token cost.

## How It Works

### 3-Tier Memory

Like a CPU cache hierarchy:

**Layer 1 — Hot (always loaded, ~3K tokens)**

| File | Purpose |
|------|---------|
| `memory/ROOT.md` | Compressed index of ALL past history — the key innovation |
| `SCRATCHPAD.md` | Active work state |
| `WORKING.md` | Tasks in progress |
| `TASK-QUEUE.md` | Task backlog |

ROOT.md has four sections:

```markdown
## Active Context (recent ~7 days)
- hipocampus open-source: finalizing spec, ROOT.md format refactor

## Recent Patterns
- compaction design: functional sections outperform chronological

## Historical Summary
- 2026-01~02: initial 3-tier design, clawy.pro K8s launch
- 2026-03: hipocampus open-source, qmd integration

## Topics Index
- hipocampus [project, 2d]: compaction tree, ROOT.md, skills → spec/
- legal [reference, 14d]: Civil Act §750, tort liability → knowledge/legal-750.md
- clawy.pro [project, 30d]: K8s infra, provisioning, 80-bot deployment
```

Each topic carries a **type** (`project`, `feedback`, `user`, `reference`) and **age** — so the agent knows not just *what* it knows, but *what kind* of information it is and *how fresh* it is. O(1) lookup — no file reads needed.

**Layer 2 — Warm (read on demand)**

| Path | Purpose |
|------|---------|
| `memory/YYYY-MM-DD.md` | Raw daily logs — structured session records |
| `knowledge/*.md` | Curated knowledge base |
| `plans/*.md` | Task plans |

**Layer 3 — Cold (search + compaction tree)**

Two retrieval mechanisms:

- **RAG (qmd)** — semantic search when you know what you're looking for
- **Compaction tree** — hierarchical drill-down (ROOT → monthly → weekly → daily → raw) for browsing and discovery

```
Compaction chain: Raw → Daily → Weekly → Monthly → Root

memory/
├── ROOT.md                     # Auto-loaded topic index
├── 2026-03-15.md               # Raw daily log (permanent)
├── daily/2026-03-15.md         # Daily compaction node
├── weekly/2026-W11.md          # Weekly index node
└── monthly/2026-03.md          # Monthly index node
```

### Smart Compaction

Below threshold, source files are copied verbatim — no information loss. Above threshold, LLM generates keyword-dense summaries.

| Level | Threshold | Below | Above |
|-------|-----------|-------|-------|
| Raw → Daily | ~200 lines | Copy verbatim | LLM summary |
| Daily → Weekly | ~300 lines | Concat | LLM summary |
| Weekly → Monthly | ~500 lines | Concat | LLM summary |
| Monthly → Root | Always | Recursive recompaction | — |

### Memory Types

Every memory entry is classified into one of four types, controlling how it's preserved over time:

| Type | Purpose | Compaction behavior |
|------|---------|-------------------|
| `project` | Work, decisions, technical findings | Compressed when completed |
| `feedback` | User corrections on approach | Always preserved verbatim |
| `user` | User identity, expertise, preferences | Always preserved |
| `reference` | External pointers (URLs, tools) | Preserved with staleness markers |

`user` and `feedback` memories never get compressed away — they survive indefinitely. `project` memories compress into Historical Summary after completion. `reference` entries get a `[?]` marker after 30 days without verification.

### Selective Recall

When a question might relate to past memory, hipocampus uses a 3-step fallback:

1. **ROOT.md triage (O(1))** — Topics Index lookup. Resolves most queries instantly.
2. **Manifest-based LLM selection** — For cross-domain queries where keywords don't match. Reads compaction node frontmatter only (<500 tokens), LLM selects top 5 relevant files.
3. **qmd search** — BM25/vector hybrid for specific keyword retrieval.

Step 2 solves the keyword mismatch problem: "배포" ↔ "deployment", "CI/CD" ↔ "github-actions" — the LLM understands semantic connections that keyword search misses.

### Automatic Operation

Everything runs automatically after `npx hipocampus init`:

| Mechanism | When | Cost |
|-----------|------|------|
| Session Start | First message — load hot files, check compaction | Read only |
| End-of-Task Checkpoint | After every task — typed entry to daily log | LLM (subagent) |
| Proactive Flush | Every ~20 messages — prevent context loss | LLM (subagent) |
| Pre-Compaction Hook | Before context compression — mechanical compact | Zero LLM |
| Secret Scanning | During compaction — redact API keys, tokens | Zero LLM |
| ROOT.md Auto-Load | Every session start | ~3K tokens |

Memory writes are dispatched to subagents to keep the main session clean.

**Adaptive compaction triggers:** Compaction runs when any condition is met — cooldown expired (default 3h), raw log exceeds 300 lines, or 5+ checkpoints accumulated. Active sessions compact more frequently; quiet days skip unnecessary work.

## Comparison

| | Ad-hoc MEMORY.md | OpenViking | **Hipocampus** |
|---|---|---|---|
| Setup | Manual | Python server + embedding model | **`npx hipocampus init`** |
| Infrastructure | None | Server + DB | **None — just files** |
| Search | None | Vector + directory recursive | **BM25 + vector hybrid (qmd)** |
| Knows what it knows | Only what fits (~50 lines) | No (search required) | **ROOT.md (~3K tokens)** |
| Scales over months | No — overflows | Yes | **Yes — self-compressing tree** |

## File Layout

```
project/
├── SCRATCHPAD.md
├── WORKING.md
├── TASK-QUEUE.md
├── memory/
│   ├── ROOT.md                  # Topic index (auto-loaded)
│   ├── (YYYY-MM-DD.md)         # Raw daily logs
│   ├── daily/                   # Daily compaction nodes
│   ├── weekly/                  # Weekly index nodes
│   └── monthly/                 # Monthly index nodes
├── knowledge/
├── plans/
├── hipocampus.config.json
└── .claude/skills/hipocampus-*  # Agent skills (5 skills)
```

## Configuration

```json
{
  "platform": "claude-code",
  "search": { "vector": true, "embedModel": "auto" },
  "compaction": { "rootMaxTokens": 3000, "cooldownHours": 3 }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `platform` | auto-detected | `"claude-code"`, `"opencode"`, or `"openclaw"` |
| `search.vector` | `true` | Enable vector embeddings (~2GB disk) |
| `search.embedModel` | `"auto"` | `"auto"` for embeddinggemma-300M, `"qwen3"` for CJK |
| `compaction.rootMaxTokens` | `3000` | Max token budget for ROOT.md |
| `compaction.cooldownHours` | `3` | Min hours between compaction runs (0 = disable) |

## Skills

Hipocampus installs five agent skills:

- **hipocampus-core** — Session start protocol + typed checkpoints + exclusion rules
- **hipocampus-compaction** — 5-level compaction tree with type-aware rules + secret scanning
- **hipocampus-recall** — 3-step selective recall (ROOT.md → manifest LLM → qmd search)
- **hipocampus-search** — Search guide: ROOT.md lookup, qmd, tree traversal
- **hipocampus-flush** — Manual memory flush via subagent

## Spec

Formal specification in [`spec/`](./spec/):

- [layers.md](./spec/layers.md) — 3-tier architecture
- [file-formats.md](./spec/file-formats.md) — File format specification
- [compaction.md](./spec/compaction.md) — Compaction tree algorithm
- [checkpoint.md](./spec/checkpoint.md) — Session + checkpoint protocol

## License

MIT
