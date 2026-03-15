# Session & Checkpoint Protocol

## Session Start (Mandatory, 7 Steps)

Every new conversation MUST begin by loading context. memory/ROOT.md is auto-loaded by the platform before Step 1 — no manual read needed.

### Step 1: Read engram.config.json
- Determine domain mapping: which SCRATCHPAD and WORKING files apply to this session
- If a single domain is configured, auto-select it
- If multiple domains are configured and the user has not specified a domain:
  - Infer the domain from task context (e.g., TASK-QUEUE.md, the user's first message, or the task description)
  - If the domain cannot be inferred with confidence, ask the user which domain to work in

### Step 2: Read MEMORY.md
- Long-term memory: Core (frozen) + Adaptive (dynamic) sections
- Establishes foundational facts, rules, and lessons

### Step 3: Read USER.md
- User profile, preferences, communication style

### Step 4: Read domain-matched SCRATCHPAD
- Active work state for the selected domain
- Single domain: `SCRATCHPAD.md`
- Multi-domain: load the domain-relevant file (e.g., `SCRATCHPAD-WEB.md`)

### Step 5: Read domain-matched WORKING
- Current task list for the selected domain (same domain logic as Step 4)

### Step 6: Read TASK-QUEUE.md
- Pending tasks from previous sessions

### Step 7 (new): Read most recent daily compaction node + check compaction triggers

**Read most recent daily:**
- Find the most recent file in `memory/daily/` (regardless of how many days ago it was)
- Read it for prior-session context
- Note: ROOT.md provides the high-level topic index; the most recent daily provides detailed recent-session continuity

**Check compaction triggers:**
- Evaluate trigger conditions for each level of the compaction tree (daily, weekly, monthly, root)
- If any trigger condition is met, invoke the engram-compaction skill
- Compaction runs at most 1 daily + 1 weekly + 1 monthly + 1 root per cycle

Note: memory/ROOT.md is already in context (auto-loaded by platform) — no separate read step is needed. The agent uses ROOT.md to judge whether any topic in the user's request is already covered by internal memory.

## End-of-Task Checkpoint (Mandatory, 6 Steps)

After completing any meaningful task, persist context. All 6 steps must be completed before responding that the task is done.

### Step 1: Update SCRATCHPAD
- Current findings, pending decisions, cross-task lessons
- Move stale entries to daily log if approaching ~150 lines
- Write to the current domain's SCRATCHPAD file

### Step 2: Append to MEMORY.md
- **APPEND ONLY** — add new entries at the end of the relevant section
- Core facts, key decisions, user preferences, lessons learned
- Never modify or remove Core section entries
- If Adaptive section exceeds ~50 lines: consolidate oldest entries, move detail to `knowledge/`

### Step 3: Update USER.md
- Any new information learned about the user this session
- Preferences, expertise, communication patterns
- Only update sections where new information was actually learned

### Step 4: Append to daily raw log
- Write to `memory/YYYY-MM-DD.md` (using the date the session started)
- Detailed record: what was discussed, decided, accomplished, code written, errors encountered
- Include context that would not fit in MEMORY.md's ~50-line limit
- These are permanent raw records — be thorough

### Step 5: Update WORKING
- Mark task status: completed, blocked, in-progress
- Remove completed tasks (or move to Completed section)
- Add newly discovered sub-tasks
- Write to the current domain's WORKING file

### Step 6: Update TASK-QUEUE.md
- Add follow-up items discovered during the task
- Archive completed items to the Completed section
- Re-prioritize if new information changes priorities

After all file modifications, re-index search:
```bash
qmd update
```

## Priority Ordering if Session Times Out

If session termination is imminent and not all checkpoint steps can be completed, prioritize in this order:

1. Daily raw log (`memory/YYYY-MM-DD.md`) — most detailed, most recoverable by compaction
2. SCRATCHPAD — active work state for next session
3. MEMORY.md — key facts and lessons
4. USER.md — user information
5. WORKING — task status
6. TASK-QUEUE.md — backlog updates

The rule: **if this session ends NOW, the next session must be able to continue immediately.** At minimum, the daily raw log and SCRATCHPAD must be updated.

## Domain Selection Logic

```
User explicitly specifies domain?
  → Yes: use that domain
  → No:
      Only 1 domain configured?
        → Yes: auto-select it
        → No (multiple domains):
            Can domain be inferred from task context?
              → Yes (high confidence): auto-select and mention the choice
              → No (uncertain): ask the user which domain to work in
```

Domain affects only SCRATCHPAD and WORKING file selection. MEMORY.md, USER.md, TASK-QUEUE.md, and the entire compaction tree are always global.

## Domain Partitioning Reference

When `engram.config.json` has multiple domains:

```json
{
  "domains": {
    "web": { "scratchpad": "SCRATCHPAD-WEB.md", "working": "WORKING-WEB.md" },
    "backend": { "scratchpad": "SCRATCHPAD-BACKEND.md", "working": "WORKING-BACKEND.md" }
  }
}
```

- Load only the relevant SCRATCHPAD and WORKING files for the selected domain
- MEMORY.md, USER.md, and TASK-QUEUE.md are always global (never split by domain)
- This saves tokens by not loading irrelevant domain state

## Rules

- MEMORY.md Core section: **FROZEN**. Never compact, modify, or remove.
- MEMORY.md Adaptive section: append-only within session, compactable across sessions.
- Daily logs (`memory/YYYY-MM-DD.md`): **permanent**. Never edit after the session ends.
- Do not skip checkpoints — lost context means the next session cannot continue.
- Keep Layer 1 files within their size targets to avoid prompt truncation.
- If session ends NOW, the next session must be able to continue immediately.

## Edge Cases

**Midnight-spanning session:** The raw log and daily compaction node use the date when the session started. Do not split the session record across two dates even if the session crosses midnight.

**Returning after absence:** Session Start Step 7 reads the "most recent daily" — this means the latest file in `memory/daily/`, regardless of whether it is from yesterday, last week, or three months ago. ROOT.md (auto-loaded) provides the high-level topic index that covers the full absence period. If more than a few days have passed, the compaction trigger check at Step 7 will likely run to process any uncovered raw logs.

**If session ends NOW:** The next session must be able to continue immediately. This rule takes priority over completeness. Write a minimal daily log entry and SCRATCHPAD update before anything else if time is critically short.
