# Session & Checkpoint Protocol

## Session Start (Mandatory — first user message)

**FIRST RESPONSE RULE:** On the very first user message of every session, run ALL steps below BEFORE responding. This takes priority over ANY user request.

memory/ROOT.md is auto-loaded by the platform — no manual read needed.
On Claude Code, SCRATCHPAD.md, WORKING.md, and TASK-QUEUE.md are auto-loaded via @import — no manual read needed.

### Claude Code (1 step)

SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md are auto-loaded via @import — no manual read needed.

1. **Compaction maintenance (subagent):** Dispatch a subagent to run hipocampus-compaction skill using subagents. Always run — do not check first.

### OpenClaw (5 steps)

MEMORY.md, USER.md, memory/ROOT.md (via Compaction Root section) are auto-loaded by the platform.

1. Read `SCRATCHPAD.md` — current work state
2. Read `WORKING.md` — active tasks
3. **Stale task recovery:** If WORKING.md contains tasks with `status: in-progress` from a previous session, assess whether they completed (check daily log, file state, git history). Update each to `done`, `failed`, or `abandoned`. Update SCRATCHPAD.md to match.
4. Read `TASK-QUEUE.md` — pending items
5. **Compaction maintenance (subagent):** Dispatch a subagent to run hipocampus-compaction skill using subagents. Always run.

## End-of-Task Checkpoint (Mandatory)

### OpenClaw — Task Lifecycle

Every logical work unit follows Task Start → Task End. Hot files are written directly by the main agent (no subagent).

**Task Start:** Update WORKING.md (add in-progress entry) + SCRATCHPAD.md (set current focus).
**Task End (in order):** Update WORKING.md (done/failed/abandoned) → Update SCRATCHPAD.md (clear/replace) → Dispatch subagent for daily log.

Quick factual questions that require no file changes are not tasks — skip the lifecycle.

See `hipocampus/platforms/openclaw/core/SKILL.md` for full protocol.

### All Platforms — Daily Log

After completing any task, **dispatch a subagent** to append a structured log to `memory/YYYY-MM-DD.md`.

### Daily log format

```markdown
## [Topic Name] [type]
- request: what the user asked
- analysis: what you researched/analyzed
- decisions: choices made with rationale
- outcome: what was done, files changed
- references: knowledge/ files, external sources
```

Where `type` is one of: `project`, `feedback`, `user`, `reference`.

#### Feedback type format

```markdown
## [Feedback Topic] [feedback]
- rule: the behavioral rule
- why: reason given
- how-to-apply: when/where this applies
```

### What NOT to Save

- Code snippets (>5 lines): Record file path + line range only
- git diff/log output: Record commit hash only
- Debugging intermediate attempts: Record final solution only
- File tree / directory listings: Derivable from project
- Stack traces: Compress to error message (1 line)
- Content already in SCRATCHPAD/WORKING/TASK-QUEUE: No duplication
- Ephemeral task state: Only useful within current session

The subagent has no access to the conversation — you must provide the task summary.

## Proactive Session Dump

Do not wait for task completion. Dispatch a subagent to flush to the daily log when:
- ~20+ messages without a checkpoint
- Context is getting large
- A significant decision was just completed
- Switching between topics

## Priority if Timeout Imminent

If session termination is imminent and no time for subagent:

**OpenClaw:** Write hot files (WORKING.md, SCRATCHPAD.md) first — most critical. Write daily log directly if time permits. Hot files take priority because stale state cannot be reconstructed.

**Claude Code / OpenCode:** Write directly to `memory/YYYY-MM-DD.md` — most critical. Hot files are auto-loaded via @import and naturally stay current.

## Rules

- **OpenClaw:** MEMORY.md Core section: **FROZEN**. Never compact, modify, or remove.
- Daily logs (`memory/YYYY-MM-DD.md`): **permanent**. Never edit after the session ends.
- **OpenClaw write authority:** Hot files (Layer 1) written directly by main agent. Layer 2+ files written via subagent.
- **Claude Code / OpenCode:** All memory writes via subagent.
- If session ends NOW, the next session must be able to continue immediately.

## Edge Cases

**Midnight-spanning session:** Use the session start date for the raw log file name.

**Returning after absence:** Read the most recent daily file regardless of age. ROOT.md covers the full absence period. Compaction maintenance at session start will process uncovered raw logs.
