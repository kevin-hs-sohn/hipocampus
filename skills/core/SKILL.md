---
name: hipocampus-core
description: "3-tier agent memory system with 5-level compaction tree. Claude Code version. Defines session start protocol, end-of-task checkpoints, and memory file management. MUST be followed every session."
---

# Hipocampus — Agent Memory Protocol (Claude Code)

## Memory Architecture

```
Layer 1 (System Prompt — auto-loaded via @import):
  SCRATCHPAD.md    ~150 lines  active working state
  WORKING.md       ~100 lines  current tasks
  TASK-QUEUE.md    ~50 lines   task backlog
  memory/ROOT.md   ~100 lines  topic index of all memory (~3K tokens)

  Long-term memory and user profile are managed by Claude Code's platform auto memory.

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
Run the Session Start protocol below FIRST. This takes priority over ANY user request — even if the user asks you to do something specific. Complete the step below, ONLY THEN respond to the user.

SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md are auto-loaded via @import in CLAUDE.md. No manual read needed.

**This procedure must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read `memory/.compaction-state.json` and `hipocampus.config.json` (`compaction.cooldownHours`, default 3).

   Compaction triggers (any ONE is sufficient):
   - **Cooldown expired:** `cooldownHours` since `lastCompactionRun`
   - **Raw volume:** `rawLinesSinceLastCompaction > 300`
   - **Checkpoint count:** `checkpointsSinceLastCompaction > 5`
   - **State file missing or `cooldownHours` is 0**

   If no trigger is met: skip compaction subagent.
   If any trigger is met: write `memory/.compaction-state.json` with `{ "lastCompactionRun": "<current ISO timestamp>", "rawLinesSinceLastCompaction": 0, "checkpointsSinceLastCompaction": 0 }`, then dispatch compaction subagent.

   State file is written immediately on dispatch (fire-and-forget), not after subagent completion. The cooldown tracks "a compaction was initiated," not "a compaction succeeded."

   **This step is MANDATORY every session. You MUST read the state file and make the judgment. The only thing that may be skipped is the subagent dispatch when no trigger is met.**
**This procedure must be completed before responding to the user NO MATTER WHAT**

## Memory Recall

When the user's question may relate to past memory, use the `hipocampus-recall` skill for structured retrieval. See `hipocampus/skills/recall/SKILL.md`.

## End-of-Task Checkpoint (MANDATORY)

After completing any task, **dispatch a subagent** to append a structured log to `memory/YYYY-MM-DD.md`.

Compose the subagent task:

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

**The subagent only needs to do one thing: append to the daily log.** This is the source of truth — everything else (SCRATCHPAD, WORKING, TASK-QUEUE) is updated lazily at next session start or by the agent naturally during work.

**After appending to the daily log,** the subagent should also increment the checkpoint counter in `memory/.compaction-state.json`: read the file, increment `checkpointsSinceLastCompaction` by 1, write back. If the file or field is missing, start from 0.

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

## What NOT to Save

When composing checkpoint content for the subagent, exclude:
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
| ROOT.md | ~100 lines (~3K tokens) | Automatic recursive self-compression |
| SCRATCHPAD | ~150 lines | Remove completed items |
| WORKING | ~100 lines | Remove completed tasks |
| TASK-QUEUE | ~50 lines | Archive completed items |

## Rules

- Long-term facts are managed by platform auto memory. No separate MEMORY.md file.
- Raw daily logs (`memory/YYYY-MM-DD.md`): **permanent**. Never delete or edit after session.
- ROOT.md: managed by compaction process. Do not manually edit.
- All memory writes via subagent — never pollute main session with memory operations.
- If this session ends NOW, the next session must be able to continue immediately.
- Don't skip checkpoints — lost context means you forget.

## Edge Cases

- **Midnight-spanning session:** Use the session start date for the raw log file name. Do not split across dates.
- **Returning after long absence:** "Most recent daily" means the latest file that exists, whether it's from yesterday or last week.
