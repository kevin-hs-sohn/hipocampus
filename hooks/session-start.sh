#!/usr/bin/env bash
# Hipocampus SessionStart hook — outputs memory protocol to stdout for agent injection.
cat <<'PROTOCOL'
## Hipocampus — Memory Protocol (MANDATORY)

This project uses hipocampus 3-tier memory. The full protocol is in /hipocampus:core skill.
**All memory write operations MUST be dispatched to subagents** to keep the main session context clean.

### FIRST RESPONSE RULE — MANDATORY
**On the very first user message of every session**, before doing ANYTHING else:
Run the Session Start protocol below FIRST. This takes priority over ANY user request. Complete the step below, ONLY THEN respond to the user.

If SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md exist, read them first.

**This procedure must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read `memory/.compaction-state.json` and `hipocampus.config.json` (`compaction.cooldownHours`, default 3).
   - **Within cooldown:** Skip compaction subagent — no dispatch needed.
   - **Cooldown expired, file missing, or `cooldownHours` is 0:** Write `memory/.compaction-state.json` with `{ "lastCompactionRun": "<current ISO timestamp>" }`, then dispatch a subagent to run hipocampus:compaction skill (chain: Daily→Weekly→Monthly→Root), then run `hipocampus compact` + `qmd update` + `qmd embed`.
**This procedure must be completed before responding to the user NO MATTER WHAT**

### End-of-Task Checkpoint (mandatory — subagent)
After completing any task, **dispatch a subagent** to append a structured log to `memory/YYYY-MM-DD.md`.
Compose the log with ## headings per topic: what was requested, analysis, decisions with rationale, outcomes, files changed.
**You must provide the task summary to the subagent** — it has no access to the conversation.

### Rules
- **Never skip Session Start** — every session begins with it, no exceptions
- **Never skip checkpoints** — every task completion MUST append to daily log via subagent
- **All memory writes via subagent** — never pollute main session with memory operations
- memory/*.md (raw): permanent, never delete
- Search: use /hipocampus:search skill
- If this session ends NOW, the next session must be able to continue immediately

If memory/ directory does not exist yet, run `npx hipocampus init` for full setup.
PROTOCOL
