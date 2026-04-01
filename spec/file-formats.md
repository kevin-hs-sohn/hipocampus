# File Formats

## Memory Types

Every memory entry carries a type tag that controls compaction priority, expiration, and formatting.

| Type | Description | Compaction Priority | Expires |
|------|-------------|-------------------|---------|
| `project` | Ongoing work, decisions, deliverables, technical findings | Medium | Yes (when completed) |
| `feedback` | User corrections/confirmations on work approach | High (always preserve core) | No |
| `user` | User identity, role, expertise, preferences | Highest (always preserve) | No |
| `reference` | External system pointers (URLs, tools, dashboards) | Low | Yes (needs periodic verification) |

### Type Tag Syntax

In daily logs (headings):
```markdown
## Topic Name [type]
```

In ROOT.md Topics Index:
```markdown
- topic-keyword [type]: sub-keywords → reference
- topic-keyword [type, Nd]: sub-keywords
- topic-keyword [reference, Nd, ?]: sub-keywords
```

Where `Nd` = days since last mention, `?` = needs verification.

### Feedback Type Structure

```markdown
## Feedback Topic [feedback]
- rule: the behavioral rule
- why: reason the user gave
- how-to-apply: when/where this guidance kicks in
```

### Backward Compatibility

Untagged entries (from before v0.5.0) are treated as `[project]` by default. Compaction adds tags during next regeneration — no migration needed.

### What NOT to Save (Exclusion Rules)

- Code snippets (>5 lines): Record file path + line range only
- git diff/log output: Record commit hash only
- Debugging intermediate attempts: Record final solution only
- File tree / directory listings: Derivable from project
- Stack traces: Compress to error message (1 line)
- Content already in SCRATCHPAD/WORKING/TASK-QUEUE: No duplication
- Ephemeral task state: Only useful within current session

**Compaction-specific filtering:**
- Code blocks (triple backtick) → replace with file path reference
- Stack traces → 1-line error message
- Entries with "임시", "테스트 중", "나중에 삭제", "temporary", "test run", "delete later" → remove

## Layer 1 Files

### MEMORY.md

Long-term memory with two sections: Core (frozen) and Adaptive (compactable).

```markdown
# Long-Term Memory

## Core (Static) — DO NOT compact or remove
<!-- User basics, project setup, immutable rules -->
<!-- Agent: append here. Never modify or delete existing entries. -->

## Adaptive (Dynamic) — Subject to compaction
<!-- Lessons learned, decisions, insights -->
<!-- Agent: append here. Compactable when exceeds ~50 lines. -->
```

**Rules:**
- Core section is FROZEN — never modify, compact, or remove
- Adaptive section: append-only within a session, compactable across sessions
- Target size: ~50 lines total
- When over limit: consolidate oldest Adaptive entries, move detail to `knowledge/`

> **Claude Code:** This file is not created. The platform's auto memory system handles long-term fact storage natively. See `hipocampus-core` skill for platform-specific checkpoint behavior.

### USER.md

User profile built up over conversations.

```markdown
# User Profile

## Identity
- Name:
- Timezone:
- Language:

## Role & Expertise
- Role:
- Expertise:
- Communication style:

## Preferences
<!-- Agent: fill in as you learn about the user -->

## Active Projects
<!-- Agent: update as projects change -->
```

> **Claude Code:** This file is not created. The platform's auto memory (user type) handles user profile storage natively.

### SCRATCHPAD.md

Active working state.

```markdown
# Scratchpad

## Current State
<!-- What's happening right now -->

## Cross-Task Lessons
<!-- Patterns that apply across tasks -->

## Pending Decisions
<!-- Unresolved items needing attention -->
```

Target: ~150 lines. When exceeded, remove completed items.

### WORKING.md

Current task tracking with structured recovery context.

```markdown
# Working

(no active tasks)

<!-- Format per task:
## [Task Name]

### Key Files
- path/to/file.ext:line — what's there

### Decisions
- chose X over Y — reason

### Errors & Corrections
- error encountered → how it was fixed

### Next Steps
- [ ] immediate next action
- [ ] following action
-->
```

Target: ~100 lines. When exceeded, remove completed tasks. The structured format (Key Files, Decisions, Errors & Corrections, Next Steps) ensures a new session can resume without re-reading all referenced files.

### TASK-QUEUE.md

Task backlog.

```markdown
# Task Queue

## Queued
<!-- task description — include enough context to start after session reset -->
<!-- When completed, remove from here — the daily log is the permanent record -->
```

Target: ~50 lines. TASK-QUEUE is a backlog only — completed tasks are removed, not archived here. The daily log (`memory/YYYY-MM-DD.md`) is the permanent record of completed work.

### memory/ROOT.md

Full memory topic index — the root node of the 5-level compaction tree. Auto-loaded by the platform at every session start. Enables the agent to decide whether to search memory, search externally, or answer directly, without loading any other memory files first.

```markdown
---
type: root
status: tentative
last-updated: YYYY-MM-DD
---

## Active Context (recent ~7 days)
- topic: current state, what's happening now

## Recent Patterns
- pattern: cross-cutting insight that emerged recently

## Historical Summary
- YYYY-MM~MM: high-level summary of that period
- YYYY-MM: key events

## Topics Index
- topic-keyword [project]: sub-keywords, references → knowledge/file.md
- topic-keyword [feedback]: sub-keywords
- topic-keyword [reference, Nd, ?]: sub-keywords
```

**Format rules:**
- YAML frontmatter: `type: root`, `status: tentative` (always — root never becomes fixed), `last-updated: YYYY-MM-DD`
- Active Context: current week's highlights — what's in progress, immediate priorities
- Recent Patterns: cross-cutting insights not tied to a specific time period
- Historical Summary: high-level chronology — compress older periods, keep recent brief summaries
- Topics Index: keyword-dense lookup table — enables O(1) "do I know about X?" judgment
- No prose — keyword-dense only
- Target: ~100 lines (~3K tokens, configurable via `compaction.rootMaxTokens`)
- When over size cap: self-compress — compress Historical Summary first, keep Active Context and Topics Index intact

**Example:**

```markdown
---
type: root
status: tentative
last-updated: 2026-03-15
---

## Active Context (recent ~7 days)
- hipocampus open-source: finalizing spec, ROOT.md format refactor in progress
- legal research: Civil Act §750 tort liability brief, 2 precedents → knowledge/legal-750.md

## Recent Patterns
- compaction design: functional sections outperform chronological for O(1) topic lookup
- knowledge files: always cross-reference from Topics Index for discoverability

## Historical Summary
- 2026-01~02: initial 3-tier design, checkpoint protocol, clawy.pro K8s launch
- 2026-03: hipocampus open-source, qmd integration, BM25+vector hybrid search

## Topics Index
- hipocampus [project]: compaction tree, ROOT.md, file-formats, skills → spec/
- legal [project]: Civil Act §750, tort liability, precedents → knowledge/legal-750.md
- clawy.pro [project, 30d]: K8s infra, provisioning, 80-bot deployment
- qmd [reference]: BM25, vector hybrid, embeddinggemma-300M
```

## Layer 3 Files — Compaction Nodes

All compaction nodes (daily, weekly, monthly) carry a `status: tentative|fixed` field in their frontmatter. Tentative nodes are regenerated whenever new source data arrives for their period. Fixed nodes are never updated again.

### Daily Compaction Node

One file per calendar day. Compressed view of all raw logs written on that day.

```markdown
---
type: daily
status: tentative
period: YYYY-MM-DD
source-files: [memory/YYYY-MM-DD.md]
topics: keyword1, keyword2, keyword3, keyword4, keyword5
---

## Topics
keyword1 [project], keyword2 [feedback], keyword3 [reference], keyword4 [project], keyword5 [user]

## Key Decisions
- decision-keyword: chose X over Y — reason

## Tasks Completed
- task-name: outcome

## Lessons Learned
- lesson-keyword: concise rule

## Open Items
- carried forward item
```

**Frontmatter fields:**
- `type: daily`
- `status: tentative|fixed` — tentative while the date is current; fixed when date changes
- `period: YYYY-MM-DD` — calendar date this node covers
- `source-files: [list]` — raw log file(s) this node was compiled from
- `topics: [keywords]` — comma-separated keyword list for quick scanning

**Smart threshold:** If the source raw log is below ~200 lines, copy it verbatim instead of generating an LLM summary. Above ~200 lines, generate a keyword-dense LLM summary.

### Weekly Summary Node

```markdown
---
type: weekly
status: tentative
period: YYYY-WNN
dates: YYYY-MM-DD to YYYY-MM-DD
source-files: [memory/daily/YYYY-MM-DD.md, memory/daily/YYYY-MM-DD.md]
topics: keyword1, keyword2, keyword3, keyword4, keyword5
---

# Weekly Summary: YYYY-WNN

## Topics
keyword1, keyword2, keyword3, keyword4, keyword5

## Key Decisions
- decision-keyword: chose X over Y — reason
- decision-keyword: chose A over B — reason

## Tasks Completed
- task-name: outcome
- task-name: outcome

## Entities Referenced
users: user1, user2
services: service1, service2
files: file1.md, file2.md
errors: error-type1, error-type2

## Lessons Learned
- lesson-keyword: concise rule
- lesson-keyword: concise rule

## Open Items
- carried forward item
```

**Frontmatter fields:**
- `type: weekly`
- `status: tentative|fixed` — tentative while the ISO week is current or within 7-day grace; fixed after
- `period: YYYY-WNN` — ISO week identifier
- `dates: YYYY-MM-DD to YYYY-MM-DD` — calendar date range of the week
- `source-files: [list]` — daily compaction nodes used as source
- `topics: [keywords]` — comma-separated keyword list

**Smart threshold:** If combined daily nodes are below ~300 lines, concatenate them instead of generating an LLM summary. Above ~300 lines, generate a keyword-dense LLM summary.

### Monthly Summary Node

```markdown
---
type: monthly
status: tentative
period: YYYY-MM
weeks: YYYY-WNN, YYYY-WNN, YYYY-WNN, YYYY-WNN
source-files: [memory/weekly/YYYY-WNN.md, memory/weekly/YYYY-WNN.md]
topics: keyword1, keyword2, keyword3, keyword4, keyword5
---

# Monthly Summary: YYYY-MM

## Topics
keyword1, keyword2, keyword3, keyword4, keyword5

## Key Themes
- theme-keyword: description across multiple weeks

## Major Decisions
- decision-keyword: chose X over Y — reason

## Completed Work
- project/task: outcome summary

## Recurring Entities
users: user1, user2
services: service1, service2
patterns: pattern1, pattern2

## Lessons & Patterns
- lesson-keyword: concise rule (emerged over N weeks)

## Carried Forward
- item still open at month end
```

**Frontmatter fields:**
- `type: monthly`
- `status: tentative|fixed` — tentative while the calendar month is current or within 7-day grace; fixed after
- `period: YYYY-MM` — calendar month
- `weeks: [list]` — ISO weeks included in this month
- `source-files: [list]` — weekly nodes used as source
- `topics: [keywords]` — comma-separated keyword list

**Smart threshold:** If combined weekly nodes are below ~500 lines, concatenate them instead of generating an LLM summary. Above ~500 lines, generate a keyword-dense LLM summary.

## Agent Memory

Subagents (compaction, recall, flush) can persist learned patterns in per-agent memory files.

### Directory Structure

```
memory/agents/
├── compaction/
│   └── AGENT.md
├── recall/
│   └── AGENT.md
└── flush/
    └── AGENT.md
```

### AGENT.md Format

```markdown
---
agent: compaction
updated: YYYY-MM-DD
---

## Learned Patterns
- observation about this project's memory behavior

## Tuning Notes
- parameter observations and recommendations
```

**Rules:**
- Each agent writes only to its own `AGENT.md`
- AGENT.md is read at the start of each subagent dispatch (if it exists)
- Updates are append-style: add new patterns, update existing ones
- Target: ~30 lines per agent (trim oldest patterns if exceeded)
- Optional: agents that have nothing to learn skip AGENT.md entirely

## Smart Threshold Table

Below threshold, copy or concatenate source files verbatim to prevent information loss. Above threshold, generate a keyword-dense LLM summary.

| Level | Threshold | Below threshold | Above threshold |
|-------|-----------|-----------------|-----------------|
| Raw → Daily | ~200 lines | Copy raw verbatim | LLM keyword-dense summary |
| Daily → Weekly | ~300 lines combined | Concat daily nodes | LLM keyword-dense summary |
| Weekly → Monthly | ~500 lines combined | Concat weekly nodes | LLM keyword-dense summary |
| Monthly → Root | Always LLM | Recompact root + new monthly | (N/A) |

## Format Rules for All Compaction Nodes

- Use keyword-dense structured format, not narrative prose
- Repeat important keywords in multiple sections for BM25 recall
- Include frontmatter with `status` and `topics` fields for quick scanning
- Minimum 50 bytes per node (even sparse periods deserve a node)
- `status: tentative` while the period may still receive new data
- `status: fixed` once the period has definitively ended — node is never modified again
