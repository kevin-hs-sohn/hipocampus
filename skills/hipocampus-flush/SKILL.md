---
name: hipocampus-flush
description: "Manual memory flush: dump current session context to daily raw log via subagent. Invoke with /hipocampus-flush. Run hipocampus-compaction afterwards for tree propagation and qmd reindex."
user_invocable: true
---

# Hipocampus Memory Flush

Dump current session context to the daily raw log. Use when you want to persist what happened in this session without waiting for End-of-Task Checkpoint or context compression.

For full compaction (needs-summarization processing, tree propagation, qmd reindex), run hipocampus-compaction skill after this.

## Steps

### 1. Compose session summary

Gather a summary of everything discussed in this session so far. For each topic:
```markdown
## [Topic Name]
- request: what the user asked
- analysis: what you researched/analyzed
- decisions: choices made with rationale
- outcome: what was done, files changed
- references: knowledge/ files, external sources
```

### 2. Dispatch subagent

**Dispatch a subagent** with the session summary and this task:

> Hipocampus memory flush. Append the following structured log to memory/YYYY-MM-DD.md (today's date). Then run `hipocampus compact` to propagate through the tree.
>
> [paste session summary here]

The subagent writes the files and runs compact. The main session stays clean.

### 3. Report

Confirm the flush completed:
- Topics flushed
- Subagent status
