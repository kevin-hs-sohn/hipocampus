# Compaction Tree

Hierarchical search index over daily memory logs. The 5-level compaction tree builds a complete, searchable index from raw session logs up to a single root node that fits in the system prompt. All compaction nodes are index supplements — originals (raw logs) are never deleted.

## Hierarchy

```
memory/
  ROOT.md                        <- root node (Layer 1, always loaded, ~100 lines)
  2026-03-01.md                  <- raw daily log (Layer 2, permanent)
  2026-03-02.md
  daily/2026-03-01.md            <- daily compaction node (Layer 3)
  weekly/2026-W09.md             <- weekly index node (Layer 3)
  monthly/2026-02.md             <- monthly index node (Layer 3)
```

**Compaction chain:** Raw → Daily → Weekly → Monthly → Root

**Tree traversal:** ROOT.md → monthly → weekly → daily → raw. Start broad, drill down for detail.

## Fixed vs Tentative Nodes

Every compaction node carries a `status` field in its YAML frontmatter.

- **tentative** — The period is still active. The node is regenerated from scratch whenever new source data arrives.
- **fixed** — The period has definitively ended. The node is never updated or regenerated again.

| Level | Becomes fixed when |
|-------|--------------------|
| Daily | Date changes (next calendar day begins) |
| Weekly | ISO week ended AND 7 days have elapsed since week end |
| Monthly | Calendar month ended AND 7 days have elapsed since month end |
| Root | Never — accumulates all history forever, self-compresses when over size cap |

## Trigger Conditions

### Raw → Daily

Tentative create/update triggers:
- A new raw log (`memory/YYYY-MM-DD.md`) is created or modified for today

Fixed transition:
- Date changes (today is now a different calendar date than the daily node's period)

### Daily → Weekly

Tentative create/update triggers:
- A daily node for any day in the current ISO week is created or updated

Fixed transition:
- ALL conditions must be true:
  - The ISO week has fully ended (current date is in a later ISO week)
  - At least 7 days have elapsed since the week ended
  - At least 1 daily node exists for that week

### Weekly → Monthly

Tentative create/update triggers:
- A weekly node for any week in the current calendar month is created or updated

Fixed transition:
- ALL conditions must be true:
  - The calendar month has fully ended (current date is in a later month)
  - At least 7 days have elapsed since the month ended (today >= 8th of the following month)
  - At least 1 weekly node exists for that month

### Monthly → Root

Trigger: any time a monthly node is created or updated (tentative or fixed).

Root is always regenerated recursively when its inputs change. Root never becomes fixed — it accumulates forever and self-compresses when the size cap is exceeded.

## Algorithm

### Step 1: Discover Candidates

List all raw daily files and compute their ISO weeks:

```bash
ls -1 memory/*.md 2>/dev/null | grep -E '^memory/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' | sort
```

For each raw file, compute the ISO week:
```bash
date -d 'YYYY-MM-DD' '+%G-W%V'       # Linux
date -jf '%Y-%m-%d' 'YYYY-MM-DD' '+%G-W%V'  # macOS
```

Group files by date, ISO week, and calendar month. Check trigger conditions at each level. Identify which nodes need to be created or regenerated.

### Step 2: Raw → Daily Compaction (max 1 per compaction cycle)

1. Select the candidate daily node to process (today's date if active; or the most recent uncovered date)
2. Read source raw log (`memory/YYYY-MM-DD.md`)
3. Size check against ~200-line threshold:
   - Below threshold: copy raw log verbatim
   - Above threshold: generate keyword-dense LLM summary using daily node template
4. Extract topic keywords from headings and key decisions, write to frontmatter `topics` field including type tags (e.g., `topics: auth [project], timezone [user], api-key [reference]`)
5. Set `status: tentative` (date is still current) or `status: fixed` (date has changed)
6. Write to `memory/daily/YYYY-MM-DD.md`
7. Verify the written file is non-empty (>= 50 bytes)
8. Re-index search: `qmd update` (+ `qmd embed` if vector enabled)

Raw log is **kept** — the daily node is a compressed index, not a replacement.

### Step 3: Daily → Weekly Compaction (max 1 per compaction cycle)

1. Select the candidate weekly node to process
2. Read all daily nodes (`memory/daily/YYYY-MM-DD.md`) for the target ISO week
3. Size check: compute combined line count of all daily nodes
   - Below ~300 lines combined: concatenate daily nodes verbatim
   - Above ~300 lines combined: generate keyword-dense LLM weekly summary
4. Set `status: tentative` or `status: fixed` per trigger conditions
5. Write to `memory/weekly/YYYY-WNN.md`
6. Verify the written file is non-empty (>= 50 bytes)
7. Re-index: `qmd update` (+ `qmd embed` if vector enabled)

Daily nodes are **kept** — they are mid-level index nodes, not consumed.

### Step 4: Weekly → Monthly Compaction (max 1 per compaction cycle)

1. Select the candidate monthly node to process
2. Read all weekly nodes (`memory/weekly/YYYY-WNN.md`) whose ISO week falls within the target calendar month
3. Size check: compute combined line count of all weekly nodes
   - Below ~500 lines combined: concatenate weekly nodes verbatim
   - Above ~500 lines combined: generate keyword-dense LLM monthly summary
4. Set `status: tentative` or `status: fixed` per trigger conditions
5. Write to `memory/monthly/YYYY-MM.md`
6. Verify the written file is non-empty (>= 50 bytes)
7. Re-index: `qmd update` (+ `qmd embed` if vector enabled)

Weekly nodes are **kept** — they are mid-level index nodes, not consumed.

### Step 5: Monthly → Root Compaction (max 1 per compaction cycle)

Recursive compaction algorithm:

```
# Initial — full tree created as tentative on first daily
root = compaction(monthly_tentative)
      where monthly_tentative = compaction(weekly_tentative)
      where weekly_tentative = compaction(daily_tentative)
      where daily_tentative = compaction(raw) or copy(raw)

# Tentative update — on each new monthly node addition/change
root = recompact(existing_root, changed_monthly_node)

# Root exceeds size cap → self-compress
# Compress Historical Summary first; keep Active Context and Topics Index intact
```

Steps:
1. Read all existing monthly nodes (`memory/monthly/YYYY-MM.md`), sorted by date
2. Read existing `memory/ROOT.md` (if it exists)
3. Recompact root by updating each functional section:
   - **Active Context**: replace with current week's highlights — what's in progress, immediate priorities
   - **Recent Patterns**: update with newly emerged cross-cutting insights
   - **Historical Summary**: append/compress older context — keep brief summaries of past periods
   - **Topics Index**: merge new topics, update existing entries with new sub-keywords and references
4. Ensure total size stays within `compaction.rootMaxTokens` (default 3000 tokens / ~100 lines)
   - When over cap: compress Historical Summary entries first (merge periods, remove detail)
   - Active Context and Topics Index are the highest-value sections — preserve them
5. Set `status: tentative` (root is always tentative — it never becomes fixed)
6. Update `last-updated: YYYY-MM-DD` in frontmatter
7. **Calculate topic ages:** For each topic in the Topics Index:
   - Find the most recent source-file date that mentions the topic
   - Compute `age = today - most_recent_mention_date` in days
   - Write as `Nd` suffix: `- topic [project, 5d]: sub-keywords`
   - For `reference` topics with age >30d: add `?` marker: `- topic [reference, 45d, ?]: pointer`
   - For `project` topics with age >90d: candidate for removal from Topics Index (move to Historical Summary if root exceeds size cap)
8. Write to `memory/ROOT.md`

**Example ROOT.md after Step 5:**

```markdown
---
type: root
status: tentative
last-updated: 2026-03-15
---

## Active Context (recent ~7 days)
- hipocampus open-source: finalizing spec, ROOT.md format refactor in progress
- legal research: Civil Act §750 tort liability brief, 2 precedents → knowledge/legal-750.md

## Recent Patterns
- compaction design: functional sections outperform chronological for O(1) topic lookup
- knowledge files: always cross-reference from Topics Index for discoverability

## Historical Summary
- 2026-01~02: initial 3-tier design, checkpoint protocol, clawy.pro K8s launch
- 2026-03: hipocampus open-source, qmd integration, BM25+vector hybrid search

## Topics Index
- hipocampus: compaction tree, ROOT.md, file-formats, skills → spec/
- legal: Civil Act §750, tort liability, precedents → knowledge/legal-750.md
- clawy.pro: K8s infra, provisioning, 80-bot deployment
- qmd: BM25, vector hybrid, embeddinggemma-300M
```

## Smart Threshold Table

| Level | Threshold | Below threshold | Above threshold |
|-------|-----------|-----------------|-----------------|
| Raw → Daily | ~200 lines | Copy raw verbatim | LLM keyword-dense summary |
| Daily → Weekly | ~300 lines combined | Concat daily nodes | LLM keyword-dense summary |
| Weekly → Monthly | ~500 lines combined | Concat weekly nodes | LLM keyword-dense summary |
| Monthly → Root | Always LLM | Recompact root + new monthly | (N/A) |

## Per-Cycle Limit

To control cost, a single compaction cycle processes at most:
- **1 daily node** created or regenerated
- **1 weekly node** created or regenerated
- **1 monthly node** created or regenerated
- **1 root recompaction**

If multiple candidates exist at a given level, process the most recent first. Remaining candidates will be processed in subsequent compaction cycles.

## Type-Aware Compaction Rules

### Type-Specific Behavior

| Type | Compaction Behavior |
|------|-------------------|
| `user` | Always preserve. Never push to Historical Summary. |
| `feedback` | Always preserve rule+why+how-to-apply. Never push to Historical Summary. |
| `project` | Completed → compress to Historical Summary. Active → preserve in Active Context. |
| `reference` | Preserve with `[?]` if >30 days since last mention. |

### ROOT.md Topics Index with Types

```
- topic-keyword [type, Nd]: sub-keywords → reference
```

Where `type` = project|feedback|user|reference, `Nd` = days since last mention, `?` = needs verification (reference only).

### Compaction Summary Rules

1. Extract type tag from heading — default to `project` if missing
2. Preserve `user`/`feedback` verbatim when possible
3. `project`: summarize completed, preserve active
4. `reference`: keep URL/pointer + 1-line description, drop surrounding context
5. Apply exclusion rules: strip code blocks, stack traces, ephemeral markers ("임시", "temporary", "test run", "delete later")

## Guards

- Raw logs must **never** be deleted — they are permanent leaf nodes
- Never write a node shorter than 50 bytes
- If reading a source file fails, skip it and log the error — do not abort the entire compaction
- Never delete daily, weekly, or monthly nodes — they are permanent index nodes
- MEMORY.md Core section is frozen — compaction never touches it
- qmd update failure is a warning, not a fatal error — continue compaction
- Root node self-compresses when exceeding size cap — shrink older topics first

## Fixed/Tentative Lifecycle Example

```
=== Day 1 (2026-03-15, Saturday) ===
memory/2026-03-15.md created (raw log)
→ daily/2026-03-15.md (tentative) — created from raw
→ weekly/2026-W11.md (tentative) — created from daily/03-15 alone
→ monthly/2026-03.md (tentative) — created from weekly/W11 alone
→ ROOT.md (tentative) — created from monthly/03 alone

=== Day 2 (2026-03-16, Sunday) ===
memory/2026-03-16.md created
→ daily/2026-03-15.md → status: fixed (date changed)
→ daily/2026-03-16.md (tentative) — new node for today
→ weekly/2026-W11.md (tentative) — recompact(daily/03-15 + daily/03-16)
→ monthly/2026-03.md (tentative) — recompact(weekly/W11)
→ ROOT.md (tentative) — recompact(root, monthly changes)

=== Day 8 (2026-03-22, Monday — W11 ended + 7 days) ===
daily/2026-03-15 through 2026-03-21 → all status: fixed
weekly/2026-W11.md → status: fixed
weekly/2026-W12.md (tentative) — new week begins

=== Month boundary (after 2026-04-01 + 7 days = 2026-04-08) ===
monthly/2026-03.md → status: fixed
monthly/2026-04.md (tentative) — new month begins
ROOT.md updated to include 2026-04 as new tentative month
```

Key: ROOT.md is populated with real content immediately on Day 1 — no waiting for a full week or month.

## Edge Cases

**Empty days:** If no raw log exists for a calendar date, no daily compaction node is generated for that date. Weekly compaction naturally skips those days — it only reads daily nodes that actually exist.

**First day (full tentative tree):** On the first day that any raw log is written, the full tree is created in one cycle: daily → weekly → monthly → root. All nodes are tentative. ROOT.md is immediately usable from day one.

**Midnight-spanning sessions:** The raw log uses the date when the session started. There is no splitting across calendar dates.

**Returning after long absence:** Session Start reads "most recent daily node" — whether it is from 3 days ago or 3 weeks ago, the latest available daily node in `memory/daily/` is used for context. During compaction, any uncovered raw logs in that gap are processed normally.

## Compaction Cycle

The term "compaction cycle" is platform-neutral. How it is triggered depends on the platform:

| Platform | Trigger mechanism |
|----------|------------------|
| Claude Code | Session Start Step 7 (lazy, agent-driven) |
| OpenClaw | Scheduled heartbeat (proactive, platform-driven) |

In both cases, the algorithm is identical — the same skill runs the same steps. The platform difference is only in when the cycle is initiated.

## ISO Week Reference

```bash
# Get ISO week for a date (Linux)
date -d '2026-03-01' '+%G-W%V'
# Output: 2026-W09

# Get current ISO week
date '+%G-W%V'
```

Note: `%G` is the ISO year (may differ from calendar year at year boundaries), `%V` is the ISO week number (01-53).
