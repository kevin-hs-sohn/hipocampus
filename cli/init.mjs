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
    hipocampus init --tenant <id>            Initialize a tenant subdirectory
    hipocampus update                        Update skills and protocol to latest version
    hipocampus compact                       Run mechanical compaction (called automatically by hooks)
    hipocampus uninstall                     Remove hipocampus (keeps memory data)
    hipocampus uninstall --purge             Remove hipocampus and all memory data
    hipocampus uninstall --tenant <id>       Remove a specific tenant

  Options:
    --no-vector        Disable vector search (saves ~2GB disk, no embedding models)
    --no-search        Skip qmd installation and search setup (compaction tree still works)
    --platform <name>  Override platform detection (claude-code, openclaw, or opencode)
    --tenant <id>      Create/manage a tenant subdirectory (alphanumeric + hyphens, 1-64 chars)
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

if (command === "update") {
  console.log("\n  hipocampus — updating to latest version\n");
  // Fall through to init logic — init is already idempotent
  // Skills are always overwritten, templates skip if exists
}

if (command === "uninstall") {
  const uninstallPath = join(__dirname, "uninstall.mjs");
  await import(uninstallPath);
  process.exit(0);
}

if (command !== "init" && command !== "update") {
  console.error(`Unknown command: ${command}. Run 'hipocampus --help' for usage.`);
  process.exit(1);
}

const noVector = args.includes("--no-vector");
const noSearch = args.includes("--no-search");
const platformIdx = args.indexOf("--platform");
const platformOverride = platformIdx !== -1 ? args[platformIdx + 1] : null;
if (platformOverride && !["claude-code", "openclaw", "opencode"].includes(platformOverride)) {
  console.error(`  ! Unknown platform: ${platformOverride}. Use "claude-code", "openclaw", or "opencode".`);
  process.exit(1);
}

const tenantIdx = args.indexOf("--tenant");
const tenantId = tenantIdx !== -1 ? args[tenantIdx + 1] : null;
if (tenantId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(tenantId)) {
    console.error('  ! Invalid tenant ID. Use alphanumeric + hyphens, 1-64 chars, start with alphanumeric.');
    process.exit(1);
  }
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
const opencodeJson = join(CWD, "opencode.json");
const opencodeDir = join(CWD, ".opencode");

const isOpenCode = platformOverride
  ? platformOverride === "opencode"
  : existsSync(opencodeJson) || existsSync(opencodeDir);

const isOpenClaw = !isOpenCode && (platformOverride
  ? platformOverride === "openclaw"
  : existsSync(agentsMd));

const platform = isOpenCode ? "opencode" : isOpenClaw ? "openclaw" : "claude-code";

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
  // HEARTBEAT.md uses marker-based replacement (see Step 7b below)
  const heartbeatDest = join(CWD, "HEARTBEAT.md");
  if (!existsSync(heartbeatDest)) {
    copyFileSync(join(ROOT, "templates", "HEARTBEAT.md"), heartbeatDest);
    console.log("  + HEARTBEAT.md");
  }
}

if (isOpenCode) {
  copyTemplate("MEMORY.md");
  copyTemplate("USER.md");
  // No HEARTBEAT.md — OpenCode uses plugin events for compaction
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

// Plugin namespace is canonical (hipocampus:core); init copies transform to standalone (hipocampus-core).
// Invariant: frontmatter `name:` fields use hipocampus-xxx (not hipocampus:xxx), so replaceAll is safe.
const coreSkillSrc = isOpenCode
  ? { dir: join("platforms", "opencode", "core"), name: "core" }
  : isOpenClaw
    ? { dir: join("platforms", "openclaw", "core"), name: "core" }
    : { dir: join("skills", "core"), name: "core" };
const sharedSkillNames = ["compaction", "search", "flush", "recall"];
const allSkills = [coreSkillSrc, ...sharedSkillNames.map(s => ({ dir: join("skills", s), name: s }))];
const allSkillDests = ["hipocampus-core", ...sharedSkillNames.map(s => `hipocampus-${s}`)];

// OpenCode: .opencode/skills/  |  OpenClaw: skills/  |  Claude Code: .claude/skills/
const skillsBase = isOpenCode
  ? join(CWD, ".opencode", "skills")
  : isOpenClaw
    ? join(CWD, "skills")
    : join(CWD, ".claude", "skills");

for (let i = 0; i < allSkills.length; i++) {
  const skill = allSkills[i];
  const destName = allSkillDests[i];
  const destDir = join(skillsBase, destName);
  const destFile = join(destDir, "SKILL.md");
  const src = join(ROOT, skill.dir, "SKILL.md");
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  // Always overwrite — ensures updates propagate on reinstall/upgrade
  if (existsSync(src)) {
    // Transform plugin namespace (hipocampus:xxx) to standalone (hipocampus-xxx) for init users
    const content = readFileSync(src, "utf8").replaceAll("hipocampus:", "hipocampus-");
    writeFileSync(destFile, content);
    console.log(`  + skill: ${destName}`);
  }
}

// Migration: remove skills from wrong location (.claude/skills on OpenClaw)
if (isOpenClaw) {
  const wrongBase = join(CWD, ".claude", "skills");
  for (const skill of allSkillDests) {
    const wrongDir = join(wrongBase, skill);
    if (existsSync(wrongDir)) {
      const { rmSync } = await import("node:fs");
      rmSync(wrongDir, { recursive: true });
      console.log(`  ~ migrated skill ${skill} from .claude/skills/ to skills/`);
    }
  }
}

// Migration: remove skills from wrong location (skills/ or .claude/skills/ on OpenCode)
if (isOpenCode) {
  for (const wrongBase of [join(CWD, "skills"), join(CWD, ".claude", "skills")]) {
    for (const skill of allSkillDests) {
      const wrongDir = join(wrongBase, skill);
      if (existsSync(wrongDir)) {
        const { rmSync } = await import("node:fs");
        rmSync(wrongDir, { recursive: true });
        console.log(`  ~ migrated skill ${skill} to .opencode/skills/`);
      }
    }
  }
}

// ─── Step 5: Create config ───

const configDest = join(CWD, "hipocampus.config.json");
const DEFAULT_COMPACTION = { rootMaxTokens: 3000, cooldownHours: 3 };

if (existsSync(configDest)) {
  // Merge: add new fields without overwriting existing values
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(configDest, "utf8"));
  } catch {
    console.log("  ! hipocampus.config.json corrupted — resetting to defaults");
    existing = { platform, search: { vector: !noVector, embedModel: "auto" } };
  }

  if (!existing.compaction || typeof existing.compaction !== "object") {
    existing.compaction = DEFAULT_COMPACTION;
  } else {
    if (existing.compaction.cooldownHours === undefined) {
      existing.compaction.cooldownHours = DEFAULT_COMPACTION.cooldownHours;
    }
    if (existing.compaction.rootMaxTokens === undefined) {
      existing.compaction.rootMaxTokens = DEFAULT_COMPACTION.rootMaxTokens;
    }
  }

  writeFileSync(configDest, JSON.stringify(existing, null, 2) + "\n");
  console.log("  ~ hipocampus.config.json updated");
} else {
  const config = {
    platform,
    search: {
      vector: !noVector,
      embedModel: "auto",
    },
    compaction: DEFAULT_COMPACTION,
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

const PROTOCOL_BLOCK_OC = `<!-- hipocampus:protocol:start -->
## Hipocampus — Memory Protocol

This project uses hipocampus 3-tier memory. Follow \`skills/hipocampus-core/SKILL.md\`.
**Hot files (WORKING.md, SCRATCHPAD.md) are written directly by the main agent. Layer 2+ files (daily logs, knowledge/) are written via subagent.**

### FIRST RESPONSE RULE — MANDATORY
**On the very first user message of every session**, before doing ANYTHING else:
Run the Session Start protocol below FIRST (ALL steps. NO SKIP.) This takes priority over ANY user request — even if the user asks you to do something specific. Complete ALL steps below, ONLY THEN respond to the user.

### Session Start (run on first user message, every step required.)
**ALL 5 procedures must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** Read \`SCRATCHPAD.md\` — current work state
2. **DO NOT SKIP** Read \`WORKING.md\` — active tasks
3. **DO NOT SKIP** **Stale task recovery:** If WORKING.md contains tasks with \`status: in-progress\` from a previous session, assess whether they completed (check daily log, file state, git history). Update each to \`done\`, \`failed\`, or \`abandoned\` with a one-line outcome. Update SCRATCHPAD.md to match.
4. **DO NOT SKIP** Read \`TASK-QUEUE.md\` — pending items
5. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read \`memory/.compaction-state.json\` and \`hipocampus.config.json\` (\`compaction.cooldownHours\`, default 3).
   - **Within cooldown:** Skip compaction subagent — no dispatch needed.
   - **Cooldown expired, file missing, or \`cooldownHours\` is 0:** Write \`memory/.compaction-state.json\` with \`{ "lastCompactionRun": "<current ISO timestamp>" }\`, then dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run \`hipocampus compact\` + \`qmd update\` + \`qmd embed\`.

   State file is written immediately on dispatch (fire-and-forget), not after subagent completion. The cooldown tracks "a compaction was initiated," not "a compaction succeeded."

   **This step is MANDATORY every session. You MUST read the state file and make the judgment. The only thing that may be skipped is the subagent dispatch when cooldown is active.**
**ALL 5 procedures must be completed before responding to the user NO MATTER WHAT**

Note: MEMORY.md, USER.md, memory/ROOT.md (via Compaction Root section) are auto-loaded by the platform.

### Task Lifecycle (mandatory)
Every logical work unit follows Task Start → Task End. See \`skills/hipocampus-core/SKILL.md\` for full protocol.
**Task Start:** Update WORKING.md (add in-progress entry) + SCRATCHPAD.md (set current focus) — main agent writes directly.
**Task End (in order):** Update WORKING.md (done/failed/abandoned) → Update SCRATCHPAD.md (clear/replace) → Dispatch subagent for daily log.
Quick factual questions that require no file changes are not tasks — skip the lifecycle.

### End-of-Task Checkpoint (mandatory)
This is step 3 of Task End — run AFTER updating hot files (WORKING.md, SCRATCHPAD.md).
**Dispatch a subagent** to append a structured log to \`memory/YYYY-MM-DD.md\`.
Compose the log with ## headings per topic: what was requested, analysis, decisions with rationale, outcomes, files changed.
**You must provide the task summary to the subagent** — it has no access to the conversation.

### Rules
- **Never skip Session Start** — every session begins with it, no exceptions
- **Never skip Task Lifecycle** — every logical work unit MUST have Task Start and Task End
- **Write authority:** Hot files (WORKING.md, SCRATCHPAD.md, TASK-QUEUE.md, MEMORY.md Adaptive) written directly by main agent. Layer 2+ files (daily logs, knowledge/) written via subagent.
- MEMORY.md Core section: never modify or delete
- memory/*.md (raw): permanent, never delete
- Search: see \`skills/hipocampus-search/SKILL.md\`
- If this session ends NOW, the next session must be able to continue immediately
<!-- hipocampus:protocol:end -->
`;

const PROTOCOL_BLOCK_CC = `<!-- hipocampus:protocol:start -->
## Hipocampus — Memory Protocol

This project uses hipocampus 3-tier memory. Follow \`.claude/skills/hipocampus-core/SKILL.md\`.
**All memory write operations MUST be dispatched to subagents** to keep the main session context clean.

### FIRST RESPONSE RULE — MANDATORY
**On the very first user message of every session**, before doing ANYTHING else:
Run the Session Start protocol below FIRST (ALL steps. NO SKIP.) This takes priority over ANY user request — even if the user asks you to do something specific. Complete ALL steps below, ONLY THEN respond to the user.

### Session Start (run on first user message.)
SCRATCHPAD.md, WORKING.md, TASK-QUEUE.md, memory/ROOT.md are auto-loaded via @import below — no manual read needed.
**This procedure must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read \`memory/.compaction-state.json\` and \`hipocampus.config.json\` (\`compaction.cooldownHours\`, default 3).
   - **Within cooldown:** Skip compaction subagent — no dispatch needed.
   - **Cooldown expired, file missing, or \`cooldownHours\` is 0:** Write \`memory/.compaction-state.json\` with \`{ "lastCompactionRun": "<current ISO timestamp>" }\`, then dispatch a subagent to run hipocampus-compaction skill (chain: Daily→Weekly→Monthly→Root), then run \`hipocampus compact\` + \`qmd update\` + \`qmd embed\`.

   State file is written immediately on dispatch (fire-and-forget), not after subagent completion. The cooldown tracks "a compaction was initiated," not "a compaction succeeded."

   **This step is MANDATORY every session. You MUST read the state file and make the judgment. The only thing that may be skipped is the subagent dispatch when cooldown is active.**
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
<!-- hipocampus:protocol:end -->
`;

const PROTOCOL_BLOCK_OPENCODE = `<!-- hipocampus:protocol:start -->
## Hipocampus — Memory Protocol

This project uses hipocampus 3-tier memory. Follow \`.opencode/skills/hipocampus-core/SKILL.md\`.
**All memory write operations MUST be dispatched to subagents** to keep the main session context clean.

### FIRST RESPONSE RULE — MANDATORY
**On the very first user message of every session**, before doing ANYTHING else:
Run the Session Start protocol below FIRST (ALL steps. NO SKIP.) This takes priority over ANY user request — even if the user asks you to do something specific. Complete ALL steps below, ONLY THEN respond to the user.

### Session Start (run on first user message, every step required.)
**Before starting the steps below:** Read \`MEMORY.md\` and \`USER.md\` first. MEMORY.md contains the Compaction Root section (memory/ROOT.md content). These are NOT auto-loaded on OpenCode — you must read them manually.
**ALL 4 procedures must be completed before responding to the user NO MATTER WHAT**
1. **DO NOT SKIP** Read \`SCRATCHPAD.md\` — current work state
2. **DO NOT SKIP** Read \`WORKING.md\` — active tasks
3. **DO NOT SKIP** Read \`TASK-QUEUE.md\` — pending items
4. **DO NOT SKIP** **DO NOT COMPROMISE** **Compaction maintenance (cooldown-gated):**
   Read \`memory/.compaction-state.json\` and \`hipocampus.config.json\` (\`compaction.cooldownHours\`, default 3).
   - **Within cooldown:** Skip compaction subagent — no dispatch needed.
   - **Cooldown expired, file missing, or \`cooldownHours\` is 0:** Write \`memory/.compaction-state.json\` with \`{ "lastCompactionRun": "<current ISO timestamp>" }\`, then dispatch a subagent to run hipocampus-compaction skill USING SUBAGENTS (chain: Daily→Weekly→Monthly→Root), then run \`hipocampus compact\` + \`qmd update\` + \`qmd embed\`.

   State file is written immediately on dispatch (fire-and-forget), not after subagent completion. The cooldown tracks "a compaction was initiated," not "a compaction succeeded."

   **This step is MANDATORY every session. You MUST read the state file and make the judgment. The only thing that may be skipped is the subagent dispatch when cooldown is active.**
**ALL 4 procedures must be completed before responding to the user NO MATTER WHAT**

Note: The hipocampus plugin (.opencode/plugins/hipocampus.js) handles event-driven mechanical compaction — no HEARTBEAT.md needed.

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
- Search: see \`.opencode/skills/hipocampus-search/SKILL.md\`
- If this session ends NOW, the next session must be able to continue immediately
<!-- hipocampus:protocol:end -->
`;

const MARKER_START = "<!-- hipocampus:protocol:start -->";
const MARKER_END = "<!-- hipocampus:protocol:end -->";
const LEGACY_PROTOCOL_RE = /## Hipocampus — Memory Protocol[\s\S]*?(?=\n## (?!#)|$)/;

const replaceOrPrependProtocol = (content, protocolBlock) => {
  if (content.includes(MARKER_START)) {
    const re = new RegExp(
      MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "[\\s\\S]*?"
      + MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    return content.replace(re, protocolBlock.trim());
  }
  if (LEGACY_PROTOCOL_RE.test(content)) {
    return content.replace(LEGACY_PROTOCOL_RE, protocolBlock.trim());
  }
  return protocolBlock.trimStart() + "\n" + content;
};

const appendCompactionRoot = () => {
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
};

if (isOpenCode) {
  // ── OpenCode path ──
  if (existsSync(agentsMd)) {
    let content = readFileSync(agentsMd, "utf8");
    content = replaceOrPrependProtocol(content, PROTOCOL_BLOCK_OPENCODE);
    writeFileSync(agentsMd, content);
    console.log("  + hipocampus protocol updated in AGENTS.md");
  } else {
    writeFileSync(agentsMd, PROTOCOL_BLOCK_OPENCODE.trimStart());
    console.log("  + created AGENTS.md with hipocampus protocol");
  }

  appendCompactionRoot();
} else if (isOpenClaw) {
  // ── OpenClaw path ──
  if (existsSync(agentsMd)) {
    let content = readFileSync(agentsMd, "utf8");
    content = replaceOrPrependProtocol(content, PROTOCOL_BLOCK_OC);
    writeFileSync(agentsMd, content);
    console.log("  + hipocampus protocol updated in AGENTS.md");
  }

  appendCompactionRoot();

  // ── HEARTBEAT.md marker-based update ──
  const heartbeatDest = join(CWD, "HEARTBEAT.md");
  if (existsSync(heartbeatDest)) {
    const HB_MARKER_START = "<!-- hipocampus:heartbeat:start -->";
    const HB_MARKER_END = "<!-- hipocampus:heartbeat:end -->";
    const templateContent = readFileSync(join(ROOT, "templates", "HEARTBEAT.md"), "utf8");
    // Extract the hipocampus section from template (between markers)
    const markerRe = new RegExp(
      HB_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "[\\s\\S]*?"
      + HB_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const templateMatch = templateContent.match(markerRe);
    if (templateMatch) {
      let hbContent = readFileSync(heartbeatDest, "utf8");
      if (hbContent.includes(HB_MARKER_START)) {
        // Replace existing marked section
        hbContent = hbContent.replace(markerRe, templateMatch[0]);
        writeFileSync(heartbeatDest, hbContent);
        console.log("  + HEARTBEAT.md hipocampus section updated");
      } else if (hbContent.includes("Hipocampus Compaction Maintenance")) {
        // Legacy: replace old section (from "## 1. Hipocampus" to next "## " or "HEARTBEAT_OK")
        const legacyRe = /## 1\. Hipocampus Compaction Maintenance[\s\S]*?(?=\n## (?!#)|HEARTBEAT_OK)/;
        if (legacyRe.test(hbContent)) {
          hbContent = hbContent.replace(legacyRe, templateMatch[0] + "\n\n");
          writeFileSync(heartbeatDest, hbContent);
          console.log("  + HEARTBEAT.md hipocampus section updated (legacy migration)");
        }
      } else {
        // No hipocampus section at all — inject after the header
        const headerEnd = hbContent.indexOf("\n\n");
        if (headerEnd !== -1) {
          hbContent = hbContent.slice(0, headerEnd + 2) + templateMatch[0] + "\n\n" + hbContent.slice(headerEnd + 2);
        } else {
          hbContent = hbContent + "\n\n" + templateMatch[0] + "\n";
        }
        writeFileSync(heartbeatDest, hbContent);
        console.log("  + HEARTBEAT.md hipocampus section injected");
      }
    }
  }
} else {
  // ── Claude Code path ──
  if (existsSync(claudeMd)) {
    let content = readFileSync(claudeMd, "utf8");
    content = replaceOrPrependProtocol(content, PROTOCOL_BLOCK_CC);
    // Ensure @imports exist (idempotent)
    for (const imp of ["@memory/ROOT.md", "@SCRATCHPAD.md", "@WORKING.md", "@TASK-QUEUE.md"]) {
      if (!content.includes(imp)) {
        content = content.replace(MARKER_END, MARKER_END + "\n" + imp);
      }
    }
    writeFileSync(claudeMd, content);
    console.log("  + hipocampus protocol updated in CLAUDE.md");
  } else {
    const importBlock = ["@memory/ROOT.md", "@SCRATCHPAD.md", "@WORKING.md", "@TASK-QUEUE.md"].join("\n") + "\n";
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
tenants/
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

if (isOpenCode) {
  // OpenCode: install plugin + register in opencode.json
  const pluginDir = join(CWD, ".opencode", "plugins");
  const pluginDest = join(pluginDir, "hipocampus.js");
  const pluginSrc = join(ROOT, "platforms", "opencode", "plugin", "hipocampus.js");

  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
  copyFileSync(pluginSrc, pluginDest);
  console.log("  + .opencode/plugins/hipocampus.js");

  // Register plugin in opencode.json (merge if exists, create if not)
  const pluginEntry = ".opencode/plugins/hipocampus.js";
  if (existsSync(opencodeJson)) {
    try {
      const oc = JSON.parse(readFileSync(opencodeJson, "utf8"));
      oc.plugin = oc.plugin || [];
      if (!oc.plugin.includes(pluginEntry)) {
        oc.plugin.push(pluginEntry);
        writeFileSync(opencodeJson, JSON.stringify(oc, null, 2) + "\n");
        console.log("  + registered hipocampus plugin in opencode.json");
      }
    } catch {
      console.log("  ! opencode.json not parseable — skipping plugin registration");
    }
  } else {
    const oc = {
      "$schema": "https://opencode.ai/config.json",
      plugin: [pluginEntry],
    };
    writeFileSync(opencodeJson, JSON.stringify(oc, null, 2) + "\n");
    console.log("  + created opencode.json with hipocampus plugin");
  }
} else if (!isOpenClaw) {
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

// Add OpenCode plugin to gitignore (generated file, not committed)
if (isOpenCode) {
  const gi = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!gi.includes(".opencode/plugins/hipocampus.js")) {
    appendFileSync(gitignorePath, "\n# hipocampus plugin (generated)\n.opencode/plugins/hipocampus.js\n");
    console.log("  + added plugin to .gitignore");
  }
}

// ─── Tenant init (if --tenant specified) ───

if (tenantId) {
  const configPath = join(CWD, "hipocampus.config.json");
  if (!existsSync(configPath)) {
    console.error("  ! Run 'hipocampus init' first before adding tenants.");
    process.exit(1);
  }

  const tenantDir = join(CWD, "tenants", tenantId);
  console.log(`\n  setting up tenant: ${tenantId}\n`);

  // Create tenant directory structure
  const tenantDirs = [
    "", "memory", "memory/daily", "memory/weekly", "memory/monthly",
    "knowledge", "plans"
  ];
  for (const dir of tenantDirs) {
    const p = join(tenantDir, dir);
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
      if (dir) console.log(`  + tenants/${tenantId}/${dir}/`);
    }
  }

  // Copy templates into tenant dir
  const tenantTemplates = ["SCRATCHPAD.md", "WORKING.md", "TASK-QUEUE.md"];
  // OpenClaw/OpenCode also get MEMORY.md and USER.md
  if (isOpenClaw || isOpenCode) {
    tenantTemplates.unshift("MEMORY.md", "USER.md");
  }
  for (const tmpl of tenantTemplates) {
    const dest = join(tenantDir, tmpl);
    if (!existsSync(dest)) {
      copyFileSync(join(ROOT, "templates", tmpl), dest);
      console.log(`  + tenants/${tenantId}/${tmpl}`);
    }
  }

  // Create tenant ROOT.md
  const tenantRootMd = join(tenantDir, "memory", "ROOT.md");
  if (!existsSync(tenantRootMd)) {
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(tenantRootMd, `---
type: root
status: tentative
last-updated: ${today}
tenant: ${tenantId}
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
    console.log(`  + tenants/${tenantId}/memory/ROOT.md`);
  }

  // Copy tenant config (inherit from root, add tenant field)
  const tenantConfigPath = join(tenantDir, "hipocampus.config.json");
  if (!existsSync(tenantConfigPath)) {
    const rootConfig = JSON.parse(readFileSync(configPath, "utf8"));
    const tenantConfig = { ...rootConfig, tenant: tenantId };
    delete tenantConfig.tenants; // Don't nest tenants array
    writeFileSync(tenantConfigPath, JSON.stringify(tenantConfig, null, 2) + "\n");
    console.log(`  + tenants/${tenantId}/hipocampus.config.json`);
  }

  // Register tenant in root config
  const rootConfig = JSON.parse(readFileSync(configPath, "utf8"));
  rootConfig.tenants = rootConfig.tenants || [];
  if (!rootConfig.tenants.includes(tenantId)) {
    rootConfig.tenants.push(tenantId);
    writeFileSync(configPath, JSON.stringify(rootConfig, null, 2) + "\n");
    console.log(`  + registered tenant "${tenantId}" in hipocampus.config.json`);
  }

  // Register tenant qmd collections (if qmd available)
  if (hasQmd) {
    const tryExec = (cmd, label) => {
      try {
        execSync(cmd, { cwd: CWD, stdio: "pipe" });
        console.log(`  + ${label}`);
      } catch { /* collection may already exist */ }
    };
    tryExec(`qmd collection add ./tenants/${tenantId}/memory --name tenant-${tenantId}-memory`, `collection: tenant-${tenantId}-memory`);
    tryExec(`qmd collection add ./tenants/${tenantId}/knowledge --name tenant-${tenantId}-knowledge`, `collection: tenant-${tenantId}-knowledge`);
    try {
      execSync("qmd update", { cwd: CWD, stdio: "pipe" });
    } catch { /* ignore */ }
  }

  console.log(`
  tenant "${tenantId}" ready!

  Usage: set CWD to tenants/${tenantId}/ when running hipocampus for this tenant.
  Example: hipocampus compact  (from tenants/${tenantId}/ directory)
`);
}

// ─── Done ───

if (isOpenCode) {
  console.log(`
  done! Your agent now has structured memory.

  Next steps:
    1. Fill in USER.md with your profile
    2. Start opencode — the agent will follow the memory protocol
    3. Memory builds up automatically over sessions
    4. The hipocampus plugin handles compaction on session.idle events
`);
} else if (isOpenClaw) {
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
