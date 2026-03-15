# Engram — Project Context

## What is this

Open-source agent memory harness. Extracted from the 3-tier memory system running on 80+ production bots at clawy.pro.

**Repo:** `github.com/kevin-hs-sohn/engram`
**Package:** `npx engram init`
**License:** MIT

## Goals

1. **clawy.pro branding** — developer community visibility, user acquisition
2. **Community contribution** — share a battle-tested pattern with the OpenClaw/Claude Code ecosystem
3. **Standardization** — establish a de facto standard for agent memory ("agent memory should work like this")

## Architecture

3-tier file-based memory:
- **Layer 1 (Hot):** MEMORY.md, USER.md, SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md — injected every API call
- **Layer 2 (Warm):** daily logs, knowledge/, plans/ — read on demand
- **Layer 3 (Cold):** qmd hybrid search + compaction tree (weekly/monthly summaries)

## Key Design Decisions

- **Zero infrastructure** — no server, no DB, just .md files. This is the core differentiator vs OpenViking.
- **qmd as search engine** — not built-in. qmd (MIT, by tobi) handles BM25 + vector + rerank. Auto-installed by CLI.
- **Vector search opt-in but default on** — `search.vector: true` default. Users can disable with `--no-vector` for low-resource environments.
- **Agent-curated memory** — the agent writes its own memory via checkpoint protocol, not an external system.
- **Domain partitioning** — SCRATCHPAD/WORKING can be split by domain (web, backend, infra) to save tokens.
- **Compaction tree** — daily→weekly→monthly hierarchy. Summaries are keyword-dense BM25 index nodes, not replacements. Originals never deleted.

## Target Users

OpenClaw bot builders and Claude Code users. File-based agent environments.

## Relationship to clawy.pro

Engram is extracted from clawy's internal templates:
- `clawy/src/lib/templates/static/` → engram `templates/`
- `clawy/src/lib/templates/skills/memory-compaction/` → engram `skills/engram-compaction/`
- `clawy/src/lib/templates/skills/qmd-search/` → engram `skills/engram-search/`
- Session protocol from `clawy/clawy_initialize_docs/03-memory-system.md` → engram `spec/`

clawy bots continue using their own templates internally. Engram is a clean, generic extraction.

## Launch Strategy

1. **Phase 1:** Public repo + working CLI + spec docs
2. **Phase 2:** OpenClaw community introduction, qmd maintainer outreach
3. **Phase 3:** Claude Code plugin registration, blog post

## Tech Stack

- Node.js ESM (>=18)
- No build step, no runtime dependencies
- qmd auto-installed by CLI
- Skills are markdown files copied into `.claude/skills/`

## File Structure

```
engram/
├── cli/init.mjs           # npx engram init
├── spec/                   # Memory system specification
│   ├── layers.md
│   ├── file-formats.md
│   ├── compaction.md
│   └── checkpoint.md
├── templates/              # Drop-in Layer 1 files
│   ├── MEMORY.md
│   ├── USER.md
│   ├── SCRATCHPAD.md
│   ├── WORKING.md
│   └── TASK-QUEUE.md
├── skills/                 # Agent skills
│   ├── engram-core/
│   ├── engram-compaction/
│   └── engram-search/
├── engram.config.json      # Default config
├── package.json
├── README.md
├── LICENSE
└── project_context.md      # This file
```
