---
name: hipocampus-core
description: "3-tier agent memory system with 5-level compaction tree. OpenClaw version. Defines session start protocol, end-of-task checkpoints, and memory file management. MUST be followed every session."
---

# Hipocampus — Agent Memory Protocol (OpenClaw)

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

MEMORY.md, USER.md, memory/ROOT.md (via Compaction Root section) are auto-loaded by the platform.

**ALL 5 procedures must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** Read `SCRATCHPAD.md` — current work state
2. **DO NOT SKIP** Read `WORKING.md` — active tasks
3. **DO NOT SKIP** **Stale task recovery:** If WORKING.md contains tasks with `status: in-progress` from a previous session, assess whether they completed (check daily log, file state, git history). Update each to `done`, `failed`, or `abandoned` with a one-line outcome. Update SCRATCHPAD.md to match.
4. **DO NOT SKIP** Read `TASK-QUEUE.md` — pending items
5. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read `memory/.compaction-state.json` and `hipocampus.config.json` (`compaction.cooldownHours`, default 3).

   Compaction triggers (any ONE is sufficient):
   - **Cooldown expired:** `cooldownHours` since `lastCompactionRun`
   - **Raw volume:** `rawLinesSinceLastCompaction > 300`
   - **Checkpoint count:** `checkpointsSinceLastCompaction > 5`
   - **State file missing or `cooldownHours` is 0**

   If no trigger is met: skip compaction subagent.
   If any trigger is met: write `memory/.compaction-state.json` with `{ "lastCompactionRun": "<current ISO timestamp>", "rawLinesSinceLastCompaction": 0, "checkpointsSinceLastCompaction": 0 }`, then dispatch a subagent to run hipocampus:compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run `hipocampus compact` + `qmd update` + `qmd embed`.

   State file is written immediately on dispatch (fire-and-forget), not after subagent completion. The cooldown tracks "a compaction was initiated," not "a compaction succeeded."

   **This step is MANDATORY every session. You MUST read the state file and make the judgment. The only thing that may be skipped is the subagent dispatch when no trigger is met.**
**ALL 5 procedures must be completed before responding to the user NO MATTER WHAT**

Note: HEARTBEAT.md also handles needs-summarization at every heartbeat (~30 min).

## Memory Recall

When the user's question may relate to past memory, use the `hipocampus-recall` skill for structured retrieval. See `skills/hipocampus-recall/SKILL.md`.

## Task Lifecycle (MANDATORY)

Every logical work unit follows a Task Start → Task End cycle. The main agent writes hot files directly — no subagent needed.

### What Is a Task?

A logical work unit — bug fix, feature implementation, investigation, refactor.

**New task if:**
- User requests new work (different goal from current)
- Topic/objective changes

**Same task (no new Task Start):**
- Follow-up messages on the same work
- Clarifying questions within the same goal

**Not a task (skip Task Start/End entirely):**
- Quick factual questions requiring no file changes or analysis
- Simple clarifications about previous work

### Task Start (MANDATORY)

When starting a new logical task, the main agent writes directly:

1. **Update WORKING.md** — add entry:
   ```markdown
   ## [Task Name]
   - status: in-progress
   - started: YYYY-MM-DD HH:MM
   - goal: [one-line goal]
   ```
   Timestamp is best-effort. If wall-clock time is unavailable, use daily log date plus sequence number (e.g., `2026-03-23 #2`).

2. **Update SCRATCHPAD.md** — set current focus:
   ```markdown
   ## Current Focus
   [Task Name] — [what I'm doing now, next step]
   ```
   If SCRATCHPAD.md exceeds ~150 lines, prune stale content before adding.

### Task End (MANDATORY)

When a task completes, fails, or is abandoned — **in this order:**

1. **Update WORKING.md** — main agent directly:
   ```markdown
   ## [Task Name]
   - status: done | failed | abandoned
   - started: YYYY-MM-DD HH:MM
   - outcome: [one-line result or reason]
   ```

2. **Update SCRATCHPAD.md** — main agent directly:
   - Remove completed/failed/abandoned items
   - Replace Current Focus with next task (or clear)

3. **Append to daily log** — dispatch subagent:
   - `memory/YYYY-MM-DD.md` in checkpoint format (see End-of-Task Checkpoint below)

**Order matters:** Hot files first, daily log second. This guarantees hot state is captured even if subagent dispatch fails or session ends.

### Concurrent Tasks

Multiple `in-progress` tasks in WORKING.md are allowed. Each gets its own entry and its own Task End. SCRATCHPAD.md Current Focus reflects whichever task is actively being worked on.

## End-of-Task Checkpoint (MANDATORY)

This is step 3 of Task End — run AFTER updating hot files (WORKING.md, SCRATCHPAD.md).

**Dispatch a subagent** to append a structured log to `memory/YYYY-MM-DD.md`:

> Append the following to memory/YYYY-MM-DD.md:
>
> ## [Topic Name] [type]
> - request: [what the user asked]
> - analysis: [what you researched/analyzed]
> - decisions: [choices made with rationale]
> - outcome: [what was done, files changed]
> - references: [knowledge/ files, external sources]
>
> Where `type` is: project | feedback | user | reference
>
> For feedback entries, use:
> ## [Feedback Topic] [feedback]
> - rule: [the behavioral rule]
> - why: [reason given]
> - how-to-apply: [when/where this applies]

**The subagent needs the task summary you provide** — it doesn't have access to the conversation.

**After appending to the daily log,** the subagent should also increment the checkpoint counter in `memory/.compaction-state.json`: read the file, increment `checkpointsSinceLastCompaction` by 1, write back. If the file or field is missing, start from 0.

### Source of Truth

- **Current task status:** WORKING.md is authoritative
- **Completed task detail:** daily log (`memory/YYYY-MM-DD.md`) is authoritative
- **Active working state:** SCRATCHPAD.md is authoritative

### Timeout-Imminent Priority

If session termination is imminent and no time for subagent:
1. Write hot files directly (WORKING.md, SCRATCHPAD.md) — most critical
2. Write daily log directly if time permits
Hot files take priority — daily log can be reconstructed from context, stale hot files cannot.

## Proactive Session Dump

**Do not wait for task completion to write to the daily log.** Proactively dispatch a subagent to append to `memory/YYYY-MM-DD.md` when:
- The conversation has been going for ~20+ messages without a checkpoint
- You sense the context is getting large
- A significant decision or analysis was just completed, even if the overall task isn't done
- You're switching between topics within the same task

Compose the subagent task with a summary of what to dump, same as the checkpoint format. The subagent writes the file; the main session stays clean.

This protects against context compression — if the platform compresses your conversation history, undumped details are lost forever. Write early, write often. The daily log is append-only, so multiple dumps in the same session are fine.

Proactive dumps do NOT trigger hot file updates (WORKING.md, SCRATCHPAD.md). Hot files are only updated at Task Start and Task End boundaries.

## What NOT to Save

When composing checkpoint content for the subagent, exclude:
- **Secrets** — API keys, tokens, passwords, credentials. If encountered, write `[REDACTED]`.
- Code snippets >5 lines — use file path + line range instead
- git diff/log output — use commit hash instead
- Debugging intermediate attempts — record final solution only
- File tree / directory listings — derivable from project
- Stack traces — compress to 1-line error message
- Content already in SCRATCHPAD/WORKING/TASK-QUEUE — no duplication
- Ephemeral task state — only useful within current session

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
- MEMORY.md Adaptive section: append-only within session, compactable across sessions.
- Raw daily logs (`memory/YYYY-MM-DD.md`): **permanent**. Never delete or edit after session.
- ROOT.md: managed by compaction process. Do not manually edit.
- **Write authority:** Hot files (WORKING.md, SCRATCHPAD.md, TASK-QUEUE.md, MEMORY.md Adaptive) are written directly by the main agent. Layer 2+ files (daily logs, knowledge/) are written via subagent.
- If this session ends NOW, the next session must be able to continue immediately.
- Don't skip checkpoints — lost context means you forget.

## Edge Cases

- **Midnight-spanning session:** Use the session start date for the raw log file name. Do not split across dates.
- **Returning after long absence:** "Most recent daily" means the latest file that exists, whether it's from yesterday or last week.
