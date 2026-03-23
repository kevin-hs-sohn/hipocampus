---
name: hipocampus-core
description: "3-tier agent memory system with 5-level compaction tree. OpenCode version. Defines session start protocol, end-of-task checkpoints, and memory file management. MUST be followed every session."
---

# Hipocampus — Agent Memory Protocol (OpenCode)

## Memory Architecture

```
Layer 1 (System Prompt — read at session start):
  MEMORY.md        ~50 lines   long-term memory (Core=frozen, Adaptive=compactable)
  USER.md          ~50 lines   user profile and preferences
  SCRATCHPAD.md    ~150 lines  active working state
  WORKING.md       ~100 lines  current tasks
  TASK-QUEUE.md    ~50 lines   task backlog
  memory/ROOT.md   ~100 lines  topic index of all memory (~3K tokens, via Compaction Root in MEMORY.md)

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

**Before starting the steps below:** Read `MEMORY.md` and `USER.md` first. MEMORY.md contains the Compaction Root section (memory/ROOT.md content). These are NOT auto-loaded on OpenCode — you must read them manually.

**ALL 4 procedures must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** Read `SCRATCHPAD.md` — current work state
2. **DO NOT SKIP** Read `WORKING.md` — active tasks
3. **DO NOT SKIP** Read `TASK-QUEUE.md` — pending items
4. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read `memory/.compaction-state.json` and `hipocampus.config.json` (`compaction.cooldownHours`, default 3).
   - **Within cooldown:** Skip compaction subagent — no dispatch needed.
   - **Cooldown expired, file missing, or `cooldownHours` is 0:** Write `memory/.compaction-state.json` with `{ "lastCompactionRun": "<current ISO timestamp>" }`, then dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run `hipocampus compact` + `qmd update` + `qmd embed`.

   State file is written immediately on dispatch (fire-and-forget), not after subagent completion. The cooldown tracks "a compaction was initiated," not "a compaction succeeded."

   **This step is MANDATORY every session. You MUST read the state file and make the judgment. The only thing that may be skipped is the subagent dispatch when cooldown is active.**
**ALL 4 procedures must be completed before responding to the user NO MATTER WHAT**

Note: The hipocampus plugin (.opencode/plugins/hipocampus.js) handles event-driven mechanical compaction on session.idle — no HEARTBEAT.md needed.

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

| File | Target | When Exceeded |
|------|--------|---------------|
| MEMORY.md Core | ~50 lines | Never touch — frozen |
| MEMORY.md Adaptive | ~50 lines | Prune oldest entries |
| ROOT.md | ~100 lines (~3K tokens) | Automatic recursive self-compression |
| SCRATCHPAD | ~150 lines | Remove completed items |
| WORKING | ~100 lines | Remove completed tasks |
| TASK-QUEUE | ~50 lines | Archive completed items |

## Rules

- MEMORY.md Core section: **FROZEN**. Never compact, modify, or remove.
- MEMORY.md Adaptive section: compactable. Prune when exceeding target.
- memory/*.md (raw daily logs): **PERMANENT**. Never delete originals.
- All memory writes via subagent — never pollute main session context.
- Search: see `.opencode/skills/hipocampus-search/SKILL.md`
- If this session ends NOW, the next session must be able to continue immediately.
