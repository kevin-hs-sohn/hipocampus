---
name: hipocampus-core
description: "3-tier agent memory system with 5-level compaction tree. Defines session start protocol, end-of-task checkpoints, and memory file management. MUST be followed every session."
---

# Hipocampus — Agent Memory Protocol

## Memory Architecture

```
Layer 1 (System Prompt — read at session start):
  MEMORY.md        ~50 lines   long-term memory — OpenClaw only (Claude Code: platform auto memory)
  USER.md          ~50 lines   user profile — OpenClaw only (Claude Code: platform auto memory)
  SCRATCHPAD.md    ~150 lines  active working state
  WORKING.md       ~100 lines  current tasks
  TASK-QUEUE.md    ~50 lines   task backlog
  memory/ROOT.md   ~100 lines  topic index of all memory (~3K tokens, auto-loaded)

Layer 2 (On-Demand — read when needed):
  memory/YYYY-MM-DD.md         raw daily logs (permanent, never deleted)
  knowledge/*.md               detailed knowledge (searchable via qmd)
  plans/*.md                   task plans

Layer 3 (Search — via qmd + compaction tree):
  memory/daily/YYYY-MM-DD.md   daily compaction nodes
  memory/weekly/YYYY-WNN.md    weekly compaction nodes
  memory/monthly/YYYY-MM.md    monthly compaction nodes
  Tree traversal: ROOT → monthly → weekly → daily → raw
```

## Session Start (MANDATORY — run on first user message)

**FIRST RESPONSE RULE:** On the very first user message of every session, before doing ANYTHING else:
Run the Session Start protocol below FIRST (ALL steps. NO SKIP.) This takes priority over ANY user request — even if the user asks you to do something specific. Complete ALL steps below, ONLY THEN respond to the user.

### Claude Code (1 step — the rest is auto-loaded via @import)

SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md are auto-loaded via @import in CLAUDE.md.

1. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (subagent):**
   Dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run `hipocampus compact` + `qmd update` + `qmd embed`.
   Always run — do not check first, the subagent handles it.

### OpenClaw (4 steps)

MEMORY.md, USER.md, memory/ROOT.md (via Compaction Root section) are auto-loaded by the platform.

**ALL steps must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** Read `SCRATCHPAD.md` — current work state
2. **DO NOT SKIP** Read `WORKING.md` — active tasks
3. **DO NOT SKIP** Read `TASK-QUEUE.md` — pending items
4. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (subagent):**
   Dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run `hipocampus compact` + `qmd update` + `qmd embed`.
   Always run — do not check first, the subagent handles it.
**ALL steps must be completed before responding to the user NO MATTER WHAT**

Note: HEARTBEAT.md also handles needs-summarization at every heartbeat (~30 min).


## End-of-Task Checkpoint (MANDATORY)

After completing any task, **dispatch a subagent** to append a structured log to `memory/YYYY-MM-DD.md`.

Compose the subagent task:

> Append the following to memory/YYYY-MM-DD.md:
>
> ## [Topic Name]
> - request: [what the user asked]
> - analysis: [what you researched/analyzed]
> - decisions: [choices made with rationale]
> - outcome: [what was done, files changed]
> - references: [knowledge/ files, external sources]

**The subagent only needs to do one thing: append to the daily log.** This is the source of truth — everything else (SCRATCHPAD, WORKING, TASK-QUEUE, MEMORY.md) is updated lazily at next session start or by the agent naturally during work.

**The subagent needs the task summary you provide** — it doesn't have access to the conversation.

**Priority if timeout imminent** (no time for subagent — write directly to `memory/YYYY-MM-DD.md`)

## Proactive Session Dump

**Do not wait for task completion to write to the daily log.** Proactively dispatch a subagent to append to `memory/YYYY-MM-DD.md` when:
- The conversation has been going for ~20+ messages without a checkpoint
- You sense the context is getting large
- A significant decision or analysis was just completed, even if the overall task isn't done
- You're switching between topics within the same task

Compose the subagent task with a summary of what to dump, same as the checkpoint format. The subagent writes the file; the main session stays clean.

This protects against context compression — if the platform compresses your conversation history, undumped details are lost forever. Write early, write often. The daily log is append-only, so multiple dumps in the same session are fine.

## File Size Targets

| File | Target | When Exceeded | Platform |
|------|--------|---------------|----------|
| MEMORY.md Core | ~50 lines | Never touch — frozen | OpenClaw only |
| MEMORY.md Adaptive | ~50 lines | Prune oldest entries | OpenClaw only |
| ROOT.md | ~100 lines (~3K tokens) | Automatic recursive self-compression | All |
| SCRATCHPAD | ~150 lines | Remove completed items | All |
| WORKING | ~100 lines | Remove completed tasks | All |
| TASK-QUEUE | ~50 lines | Archive completed items | All |

## Rules

- **OpenClaw:** MEMORY.md Core section: **FROZEN**. Never compact, modify, or remove.
- **OpenClaw:** MEMORY.md Adaptive section: append-only within session, compactable across sessions.
- **Claude Code:** Long-term facts are managed by platform auto memory. No separate MEMORY.md file.
- Raw daily logs (`memory/YYYY-MM-DD.md`): **permanent**. Never delete or edit after session.
- ROOT.md: managed by compaction process. Do not manually edit.
- If this session ends NOW, the next session must be able to continue immediately.
- Don't skip checkpoints — lost context means you forget.

## Edge Cases

- **Midnight-spanning session:** Use the session start date for the raw log file name. Do not split across dates.
- **Returning after long absence:** "Most recent daily" means the latest file that exists, whether it's from yesterday or last week.
