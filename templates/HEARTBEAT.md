# Heartbeat Checklist

Run these checks every heartbeat. Follow strictly. Do not infer tasks from prior chats.

<!-- hipocampus:heartbeat:start -->
## 1. Hipocampus Compaction Maintenance

Check if memory compaction tree needs updating:

1. Search `memory/daily/`, `memory/weekly/`, `memory/monthly/` for files containing `needs-summarization`
2. If found: generate LLM keyword-dense summaries per `skills/hipocampus-compaction/SKILL.md` using subagents
   - Read source files listed in each node's frontmatter
   - Generate summary, update status from `needs-summarization` to `tentative` or `fixed`
   - Follow the strict chain order: Daily → Weekly → Monthly → Root
3. Run: `hipocampus compact` (propagate changes through the tree)
4. Run: `qmd update` (re-index search)
5. Run: `qmd embed` (update vector embeddings, if enabled in hipocampus.config.json)

Skip this section if no `needs-summarization` files exist.
<!-- hipocampus:heartbeat:end -->

## 2. (Add your own heartbeat tasks below)

<!-- Example tasks:
- Check email for urgent items
- Review calendar for upcoming deadlines
- Monitor deployment status
-->

HEARTBEAT_OK
