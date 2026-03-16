# Session & Checkpoint Protocol

## Session Start (Mandatory — first user message)

**FIRST RESPONSE RULE:** On the very first user message of every session, run ALL steps below BEFORE responding. This takes priority over ANY user request.

memory/ROOT.md is auto-loaded by the platform — no manual read needed.
On Claude Code, SCRATCHPAD.md, WORKING.md, and TASK-QUEUE.md are auto-loaded via @import — no manual read needed.

### Claude Code (1 step)

SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md are auto-loaded via @import — no manual read needed.

1. **Compaction maintenance (subagent):** Dispatch a subagent to run hipocampus-compaction skill using subagents. Always run — do not check first.

### OpenClaw (4 steps)

MEMORY.md, USER.md, memory/ROOT.md (via Compaction Root section) are auto-loaded by the platform.

1. Read `SCRATCHPAD.md` — current work state
2. Read `WORKING.md` — active tasks
3. Read `TASK-QUEUE.md` — pending items
4. **Compaction maintenance (subagent):** Dispatch a subagent to run hipocampus-compaction skill using subagents. Always run.

## End-of-Task Checkpoint (Mandatory — subagent)

After completing any task, **dispatch a subagent** to append a structured log to `memory/YYYY-MM-DD.md`.

The subagent only needs to do one thing: append to the daily log. This is the source of truth — everything else (SCRATCHPAD, WORKING, TASK-QUEUE, MEMORY.md) is updated lazily at next session start or naturally during work.

### Daily log format

```markdown
## [Topic Name]
- request: what the user asked
- analysis: what you researched/analyzed
- decisions: choices made with rationale
- outcome: what was done, files changed
- references: knowledge/ files, external sources
```

The subagent has no access to the conversation — you must provide the task summary.

## Proactive Session Dump

Do not wait for task completion. Dispatch a subagent to flush to the daily log when:
- ~20+ messages without a checkpoint
- Context is getting large
- A significant decision was just completed
- Switching between topics

## Priority if Timeout Imminent

If session termination is imminent and no time for subagent:
1. Write directly to `memory/YYYY-MM-DD.md` — most critical
2. Everything else is recoverable from the daily log at next session start

## Rules

- **OpenClaw:** MEMORY.md Core section: **FROZEN**. Never compact, modify, or remove.
- Daily logs (`memory/YYYY-MM-DD.md`): **permanent**. Never edit after the session ends.
- All memory writes via subagent — never pollute main session context.
- If session ends NOW, the next session must be able to continue immediately.

## Edge Cases

**Midnight-spanning session:** Use the session start date for the raw log file name.

**Returning after absence:** Read the most recent daily file regardless of age. ROOT.md covers the full absence period. Compaction maintenance at session start will process uncovered raw logs.
