#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CWD = process.cwd();

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log(`
  hipocampus — Drop-in memory harness for AI agents

  Usage:
    hipocampus init                          Initialize memory system in current directory
    hipocampus init --no-vector              Disable vector search (BM25 only)
    hipocampus init --no-search              Skip qmd entirely (use tree traversal only)
    hipocampus compact                       Run mechanical compaction (called automatically by hooks)

  Options:
    --no-vector        Disable vector search (saves ~2GB disk, no embedding models)
    --no-search        Skip qmd installation and search setup (compaction tree still works)
    --platform <name>  Override platform detection (claude-code or openclaw)
    --help, -h         Show this help
`);
  process.exit(0);
}

if (command === "compact") {
  // Delegate to compact.mjs
  const compactPath = join(__dirname, "compact.mjs");
  await import(compactPath);
  process.exit(0);
}

if (command !== "init") {
  console.error(`Unknown command: ${command}. Run 'hipocampus --help' for usage.`);
  process.exit(1);
}

const noVector = args.includes("--no-vector");
const noSearch = args.includes("--no-search");
const platformIdx = args.indexOf("--platform");
const platformOverride = platformIdx !== -1 ? args[platformIdx + 1] : null;
if (platformOverride && !["claude-code", "openclaw"].includes(platformOverride)) {
  console.error(`  ! Unknown platform: ${platformOverride}. Use "claude-code" or "openclaw".`);
  process.exit(1);
}

console.log("\n  hipocampus — initializing memory system\n");

// ─── Step 1: Check qmd ───

let hasQmd = false;
if (noSearch) {
  console.log("  ~ search disabled (--no-search), skipping qmd");
} else {
  try {
    execSync("qmd --version", { stdio: "pipe" });
    hasQmd = true;
    console.log("  + qmd found");
  } catch {
    console.log("  ~ qmd not found, installing...");
    try {
      execSync("npm install -g @tobilu/qmd", { stdio: "inherit" });
      hasQmd = true;
      console.log("  + qmd installed");
    } catch {
      console.warn("  ! Could not install qmd. Memory system works without it (tree traversal only).");
    }
  }
}

// ─── Step 2: Create directories ───

const dirs = ["memory", "memory/daily", "memory/weekly", "memory/monthly", "knowledge", "plans"];
for (const dir of dirs) {
  const p = join(CWD, dir);
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
    console.log(`  + ${dir}/`);
  }
}

// ─── Platform detection (needed before template copying) ───

const agentsMd = join(CWD, "AGENTS.md");
const claudeMd = join(CWD, "CLAUDE.md");
const openclawJson = join(CWD, "openclaw.json");

const isOpenClaw = platformOverride
  ? platformOverride === "openclaw"
  : existsSync(agentsMd);
const platform = isOpenClaw ? "openclaw" : "claude-code";

console.log(`  ~ platform: ${platform}`);

// ─── Step 3: Copy templates ───

function copyTemplate(filename, destName) {
  const dest = join(CWD, destName || filename);
  if (!existsSync(dest)) {
    copyFileSync(join(ROOT, "templates", filename), dest);
    console.log(`  + ${destName || filename}`);
  }
}

if (isOpenClaw) {
  copyTemplate("MEMORY.md");
  copyTemplate("USER.md");
  copyTemplate("HEARTBEAT.md");
}
copyTemplate("TASK-QUEUE.md");

// Create ROOT.md stub if it doesn't exist
const rootMdPath = join(CWD, "memory", "ROOT.md");
if (!existsSync(rootMdPath)) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(rootMdPath, `---
type: root
status: tentative
last-updated: ${today}
---

## Active Context (recent ~7 days)
<!-- Current work and priorities -->

## Recent Patterns
<!-- Cross-cutting insights -->

## Historical Summary
<!-- High-level timeline -->

## Topics Index
<!-- topic: keywords, references -->
`);
  console.log("  + memory/ROOT.md");
}

copyTemplate("SCRATCHPAD.md");
copyTemplate("WORKING.md");

// ─── Step 4: Install skills ───

const skillNames = ["hipocampus-core", "hipocampus-compaction", "hipocampus-search", "hipocampus-flush"];
// Claude Code: .claude/skills/  |  OpenClaw: skills/
const skillsBase = isOpenClaw ? join(CWD, "skills") : join(CWD, ".claude", "skills");

for (const skill of skillNames) {
  const destDir = join(skillsBase, skill);
  const destFile = join(destDir, "SKILL.md");
  const src = join(ROOT, "skills", skill, "SKILL.md");
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  // Always overwrite — ensures updates propagate on reinstall/upgrade
  if (existsSync(src)) {
    copyFileSync(src, destFile);
    console.log(`  + skill: ${skill}`);
  }
}

// Migration: remove skills from wrong location (.claude/skills on OpenClaw, skills/ on Claude Code)
if (isOpenClaw) {
  const wrongBase = join(CWD, ".claude", "skills");
  for (const skill of skillNames) {
    const wrongDir = join(wrongBase, skill);
    if (existsSync(wrongDir)) {
      const { rmSync } = await import("node:fs");
      rmSync(wrongDir, { recursive: true });
      console.log(`  ~ migrated skill ${skill} from .claude/skills/ to skills/`);
    }
  }
}

// ─── Step 5: Create config ───

const configDest = join(CWD, "hipocampus.config.json");
if (!existsSync(configDest)) {
  const config = {
    platform,
    search: {
      vector: !noVector,
      embedModel: "auto",
    },
    compaction: {
      rootMaxTokens: 3000,
    },
  };

  writeFileSync(configDest, JSON.stringify(config, null, 2) + "\n");
  console.log("  + hipocampus.config.json");
}

// ─── Step 6: Register qmd collections ───

if (hasQmd) {
  console.log("\n  setting up search...\n");

  const tryExec = (cmd, label) => {
    try {
      execSync(cmd, { cwd: CWD, stdio: "pipe" });
      console.log(`  + ${label}`);
    } catch { /* collection may already exist */ }
  };

  tryExec("qmd collection add ./memory --name memory", "collection: memory");
  tryExec("qmd collection add ./knowledge --name knowledge", "collection: knowledge");

  try {
    execSync("qmd update", { cwd: CWD, stdio: "pipe" });
    console.log("  + search index updated");
  } catch { /* ignore */ }

  const cfg = JSON.parse(readFileSync(configDest, "utf8"));
  if (cfg.search?.vector !== false) {
    console.log("  ~ generating vector embeddings (first run downloads ~2GB of models)...");
    try {
      execSync("qmd embed", { cwd: CWD, stdio: "inherit" });
      console.log("  + embeddings generated");
    } catch {
      console.warn("  ! Vector embedding failed. Search will use BM25 only. Run 'qmd embed' later.");
    }
  }
}

// ─── Step 7: Protocol injection ───

const PROTOCOL_BLOCK_OC = `
## Hipocampus — Memory Protocol

This project uses hipocampus 3-tier memory. Follow \`skills/hipocampus-core/SKILL.md\`.
**All memory write operations MUST be dispatched to subagents** to keep the main session context clean.

### FIRST RESPONSE RULE — MANDATORY
**On the very first user message of every session**, before doing ANYTHING else:
Run the Session Start protocol below FIRST (ALL steps. NO SKIP.) This takes priority over ANY user request — even if the user asks you to do something specific. Complete ALL steps below, ONLY THEN respond to the user.

### Session Start (run on first user message, every step required.)
**ALL 4 procedures must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** Read \`SCRATCHPAD.md\` — current work state
2. **DO NOT SKIP** Read \`WORKING.md\` — active tasks
3. **DO NOT SKIP** Read \`TASK-QUEUE.md\` — pending items
4. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (subagent):** Dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run \`hipocampus compact\` + \`qmd update\` + \`qmd embed\`. Always run — do not check first, the subagent handles it.
**ALL 4 procedures must be completed before responding to the user NO MATTER WHAT**

Note: MEMORY.md, USER.md, memory/ROOT.md (via Compaction Root section) are auto-loaded by the platform.

### End-of-Task Checkpoint (mandatory — subagent)
After completing any task, **dispatch a subagent** to append a structured log to \`memory/YYYY-MM-DD.md\`.
Compose the log with ## headings per topic: what was requested, analysis, decisions with rationale, outcomes, files changed.
**The subagent only needs to do one thing: append to the daily log.** Everything else (SCRATCHPAD, WORKING, TASK-QUEUE, MEMORY.md) is updated lazily at next session start or by the agent naturally during work.
**You must provide the task summary to the subagent** — it has no access to the conversation.

### Rules
- **Never skip Session Start** — every session begins with it, no exceptions
- **Never skip checkpoints** — every task completion MUST append to daily log via subagent
- **All memory writes via subagent** — never pollute main session with memory operations
- MEMORY.md Core section: never modify or delete
- memory/*.md (raw): permanent, never delete
- Search: see \`skills/hipocampus-search/SKILL.md\`
- If this session ends NOW, the next session must be able to continue immediately
`;

const PROTOCOL_BLOCK_CC = `
## Hipocampus — Memory Protocol

This project uses hipocampus 3-tier memory. Follow \`.claude/skills/hipocampus-core/SKILL.md\`.
**All memory write operations MUST be dispatched to subagents** to keep the main session context clean.

### FIRST RESPONSE RULE — MANDATORY
**On the very first user message of every session**, before doing ANYTHING else:
Run the Session Start protocol below FIRST (ALL steps. NO SKIP.) This takes priority over ANY user request — even if the user asks you to do something specific. Complete ALL steps below, ONLY THEN respond to the user.

### Session Start (run on first user message.)
SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md are auto-loaded via @import below — no manual read needed.
**This procedure must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (subagent):** Dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run \`hipocampus compact\` + \`qmd update\` + \`qmd embed\`. Always run — do not check first, the subagent handles it.
**This procedure must be completed before responding to the user NO MATTER WHAT**

### End-of-Task Checkpoint (mandatory — subagent)
After completing any task, **dispatch a subagent** to append a structured log to \`memory/YYYY-MM-DD.md\`.
Compose the log with ## headings per topic: what was requested, analysis, decisions with rationale, outcomes, files changed.
**The subagent only needs to do one thing: append to the daily log.** Everything else (SCRATCHPAD, WORKING, TASK-QUEUE) is updated lazily at next session start or by the agent naturally during work.
**You must provide the task summary to the subagent** — it has no access to the conversation.

### Rules
- **Never skip Session Start** — every session begins with it, no exceptions
- **Never skip checkpoints** — every task completion MUST append to daily log via subagent
- **All memory writes via subagent** — never pollute main session with memory operations
- memory/*.md (raw): permanent, never delete
- Search: see \`.claude/skills/hipocampus-search/SKILL.md\`
- If this session ends NOW, the next session must be able to continue immediately
`;

const hasHipocampus = (text) => text.toLowerCase().includes("hipocampus");

if (isOpenClaw) {
  // ── OpenClaw path ──
  if (existsSync(agentsMd)) {
    const content = readFileSync(agentsMd, "utf8");
    if (!hasHipocampus(content)) {
      // Prepend: protocol block at top of AGENTS.md (highest priority)
      const newContent = PROTOCOL_BLOCK_OC.trimStart() + "\n" + content;
      writeFileSync(agentsMd, newContent);
      console.log("  + added hipocampus protocol (top) to AGENTS.md");
    }
  }

  // OpenClaw bootstraps a fixed set of files (AGENTS.md, MEMORY.md, etc.)
  // ROOT.md can't be added to the bootstrap list, so we embed it as a section in MEMORY.md.
  // The agent reads MEMORY.md at session start (it's always bootstrapped), and the
  // Compaction Root section gives it the same awareness as a standalone ROOT.md.
  const memoryMd = join(CWD, "MEMORY.md");
  if (existsSync(memoryMd)) {
    const memContent = readFileSync(memoryMd, "utf8");
    if (!memContent.includes("Compaction Root")) {
      appendFileSync(memoryMd, `
## Compaction Root
<!-- This section serves as the ROOT.md index for platforms that can't auto-load separate files. -->
<!-- Updated automatically by hipocampus compact. See memory/ROOT.md for the full version. -->

### Active Context (recent ~7 days)
<!-- Current work and priorities -->

### Recent Patterns
<!-- Cross-cutting insights -->

### Topics Index
<!-- topic: keywords, references -->
`);
      console.log("  + added Compaction Root section to MEMORY.md");
    }
  }
} else {
  // ── Claude Code path ──
  // Protocol block goes at the TOP of CLAUDE.md (highest priority)
  // @memory/ROOT.md import goes after protocol block but before existing content

  // @imports: platform auto-loads these at session start (no agent read needed)
  const importBlock = [
    "@memory/ROOT.md",
    "@SCRATCHPAD.md",
    "@WORKING.md",
    "@TASK-QUEUE.md",
  ].join("\n") + "\n";

  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, "utf8");
    if (!hasHipocampus(content)) {
      // Prepend: protocol block + @imports + existing content
      const newContent = PROTOCOL_BLOCK_CC.trimStart() + "\n" + importBlock + "\n" + content;
      writeFileSync(claudeMd, newContent);
      console.log("  + added hipocampus protocol (top) and @imports to CLAUDE.md");
    }
  } else {
    // Create new CLAUDE.md: protocol block first, then @imports
    writeFileSync(claudeMd, PROTOCOL_BLOCK_CC.trimStart() + "\n" + importBlock);
    console.log("  + created CLAUDE.md with hipocampus protocol and @imports");
  }
}

// ─── Step 8: .gitignore ───

const gitignorePath = join(CWD, ".gitignore");
const HIPOCAMPUS_GITIGNORE = `
# hipocampus - personal memory (don't commit)
MEMORY.md
USER.md
SCRATCHPAD*.md
WORKING*.md
TASK-QUEUE.md
memory/
knowledge/
plans/
`;

if (existsSync(gitignorePath)) {
  const gi = readFileSync(gitignorePath, "utf8");
  if (!gi.includes("hipocampus")) {
    appendFileSync(gitignorePath, HIPOCAMPUS_GITIGNORE);
    console.log("  + added hipocampus entries to .gitignore");
  }
} else {
  writeFileSync(gitignorePath, HIPOCAMPUS_GITIGNORE.trimStart());
  console.log("  + created .gitignore with hipocampus entries");
}

// ─── Step 9: Register pre-compaction hook ───

// PreCompact only supports type: "command" hooks (not agent/prompt/http).
// Mechanical compaction runs here; LLM pass (needs-summarization, flush) is handled by:
//   - Claude Code: Session Start step 9 + /hipocampus-flush manual command
//   - OpenClaw: HEARTBEAT.md + Session Start step 9

const hipocampusBin = join(ROOT, "cli", "init.mjs");
const compactCmd = `node "${hipocampusBin}" compact --stdin`;

if (!isOpenClaw) {
  // Claude Code: register PreCompact command hook in .claude/settings.json
  const settingsDir = join(CWD, ".claude");
  const settingsPath = join(settingsDir, "settings.json");
  let settings = {};

  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { /* fresh start */ }
  }

  if (!settings.hooks?.PreCompact) {
    if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });

    settings.hooks = settings.hooks || {};
    settings.hooks.PreCompact = [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: compactCmd,
            timeout: 30000,
          },
        ],
      },
    ];

    // Also register TaskCompleted hook for mechanical compaction after each task
    if (!settings.hooks.TaskCompleted) {
      settings.hooks.TaskCompleted = [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `node "${hipocampusBin}" compact`,
              timeout: 30000,
            },
          ],
        },
      ];
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log("  + registered PreCompact + TaskCompleted hooks (mechanical compaction)");
  }
} else {
  // OpenClaw: compaction is handled by two mechanisms:
  //   1. HEARTBEAT.md — LLM pass: needs-summarization processing + qmd reindex (every heartbeat)
  //   2. hipocampus compact — mechanical compaction: called manually or by session:compact:before hook
  //
  // HEARTBEAT.md is already copied in Step 3.
  // Register mechanical compact in openclaw.json for session:compact:before if possible.
  if (existsSync(openclawJson)) {
    try {
      const oc = JSON.parse(readFileSync(openclawJson, "utf8"));
      if (!oc.hooks?.internal?.entries?.["hipocampus-compact"]) {
        oc.hooks = oc.hooks || {};
        oc.hooks.internal = oc.hooks.internal || { enabled: true, entries: {} };
        oc.hooks.internal.entries = oc.hooks.internal.entries || {};
        oc.hooks.internal.entries["hipocampus-compact"] = {
          enabled: true,
          env: { HIPOCAMPUS_BIN: hipocampusBin },
        };
        writeFileSync(openclawJson, JSON.stringify(oc, null, 2) + "\n");
        console.log("  + registered hipocampus-compact hook entry in openclaw.json");
      }
    } catch { /* openclaw.json not parseable */ }
  }
  console.log("  + HEARTBEAT.md includes hipocampus compaction maintenance tasks");
}

// ─── Done ───

if (isOpenClaw) {
  console.log(`
  done! Your agent now has structured memory.

  Next steps:
    1. Fill in USER.md with your profile
    2. Start a conversation — the agent will follow the memory protocol
    3. Memory builds up automatically over sessions
`);
} else {
  console.log(`
  done! Your agent now has structured memory.

  Next steps:
    1. Your profile is managed by the platform's auto memory
    2. Start a conversation — the agent will follow the memory protocol
    3. Memory builds up automatically over sessions
`);
}
