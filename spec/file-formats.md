# File Formats

## Layer 1 Files

### MEMORY.md

Long-term memory with two sections: Core (frozen) and Adaptive (compactable).

```markdown
# MEMORY.md — Long-Term Memory

APPEND ONLY — add new entries at the end of each section. Never rewrite existing entries.

## Core (Static) — DO NOT compact or remove

These entries survive every compaction cycle. Only update when facts change.

### Identity & Config
(User name, timezone, language, role, accounts, credentials received — last 4 chars only)

### Rules & Preferences
(User decisions, chosen approaches, communication preferences — "user prefers X over Y because Z")

## Adaptive (Dynamic) — Subject to compaction

These entries evolve per session. During compaction cycles, summarize or prune oldest entries first.

### Lessons Learned
(Mistakes made, patterns discovered, things that worked/didn't — prevent repeating errors)

### Active Context
(Ongoing projects, recurring topics, things to follow up on, recent key decisions)
```

**Rules:**
- Core section is FROZEN — never modify, compact, or remove
- Adaptive section: append-only within a session, compactable across sessions
- Target size: ~50 lines total
- When over limit: consolidate oldest Adaptive entries, move detail to `knowledge/`

### USER.md

User profile built up over conversations.

```markdown
# User

## Profile
- Name: (user's name)
- Timezone: (observe from message times or ask)
- Language: (observe from conversation)
- Role/Occupation: (learn from context)

## Communication Style
(observe and note: formal/informal, verbose/concise, language preferences)

## Expertise & Interests
(learn from conversations: technical depth, domain knowledge, hobbies)

## Active Projects
(track ongoing work the user mentions)

## Preferences
(record explicit preferences: "user prefers X over Y")

## Important Notes
(critical context that affects how you assist this user)
```

### SCRATCHPAD.md

Active working state. Cleared/rotated frequently.

```markdown
# SCRATCHPAD

Warm context for all active tasks. Update after every task. Keep under ~150 lines.

## Global
### Cross-Task Lessons
(none yet)
### Pending Decisions
(none)
```

### WORKING.md

Current task tracking.

```markdown
# WORKING.md — Active Tasks

Hot context: 2-5 currently active tasks. Update after every task.

(no active tasks)
```

### TASK-QUEUE.md

Task backlog.

```markdown
# Task Queue

## Queued Tasks
(no tasks queued)

## Completed
(none)
```

### memory/ROOT.md

Full memory topic index — the root node of the 5-level compaction tree. Auto-loaded by the platform at every session start. Enables the agent to decide whether to search memory, search externally, or answer directly, without loading any other memory files first.

```markdown
---
type: root
status: tentative
last-updated: YYYY-MM-DD
months-covered: [YYYY-MM, YYYY-MM, YYYY-MM]
---

## YYYY-MM (recent — detailed)
- topic-keyword: key decisions, references, file pointers
- topic-keyword: key decisions, references, file pointers

## YYYY-MM (compressed)
- topic-keyword: keywords
- topic-keyword: keywords

## YYYY-MM (highly compressed)
- topic-keyword: keywords
```

**Format rules:**
- YAML frontmatter: `type: root`, `status: tentative` (always — root never becomes fixed), `last-updated: YYYY-MM-DD`, `months-covered: [list]`
- Recent months: detailed entries with key decisions and file references
- Older months: progressively compressed — fewer keywords, no detail
- No prose — keyword-dense only
- Target: ~100 lines (~3K tokens, configurable via `compaction.rootMaxTokens`)
- When over size cap: self-compress — shrink oldest months first, keep recent months detailed

**Example:**

```markdown
---
type: root
status: tentative
last-updated: 2026-03-15
months-covered: [2026-01, 2026-02, 2026-03]
---

## 2026-03 (recent — detailed)
- engram open-source: 3-tier memory harness, compaction tree design, qmd integration
- legal research: Civil Act §750 tort liability, 2 precedents summarized → knowledge/legal-750.md
- Claude Code plugin: registration process research, API spec review

## 2026-02 (compressed)
- clawy.pro launch: K8s infra, provisioning pipeline, 80-bot stabilization
- qmd adoption: BM25 + vector hybrid, embeddinggemma-300M selection rationale

## 2026-01 (highly compressed)
- initial design: 3-tier memory architecture, checkpoint protocol established
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
keyword1, keyword2, keyword3, keyword4, keyword5

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
