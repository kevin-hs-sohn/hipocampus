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
  engram — Drop-in memory harness for AI agents

  Usage:
    engram init                          Initialize memory system in current directory
    engram init --domains web,backend    Initialize with domain partitioning
    engram init --no-vector              Disable vector search (BM25 only)

  Options:
    --domains <list>   Comma-separated domain names for SCRATCHPAD/WORKING partitioning
    --no-vector        Disable vector search (saves ~2GB disk, no embedding models)
    --help, -h         Show this help
`);
  process.exit(0);
}

if (command !== "init") {
  console.error(`Unknown command: ${command}. Run 'engram --help' for usage.`);
  process.exit(1);
}

const domainsIdx = args.indexOf("--domains");
const domains = domainsIdx !== -1 && args[domainsIdx + 1]
  ? args[domainsIdx + 1].split(",").map(d => d.trim()).filter(Boolean)
  : null;
const noVector = args.includes("--no-vector");

console.log("\n  engram — initializing memory system\n");

// ─── Step 1: Check qmd ───

let hasQmd = false;
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
    console.warn("  ! Could not install qmd. Install manually: npm install -g @tobilu/qmd");
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

// ─── Step 3: Copy templates ───

function copyTemplate(filename, destName) {
  const dest = join(CWD, destName || filename);
  if (!existsSync(dest)) {
    copyFileSync(join(ROOT, "templates", filename), dest);
    console.log(`  + ${destName || filename}`);
  }
}

copyTemplate("MEMORY.md");
copyTemplate("USER.md");
copyTemplate("TASK-QUEUE.md");

// Create ROOT.md stub if it doesn't exist
const rootMdPath = join(CWD, "memory", "ROOT.md");
if (!existsSync(rootMdPath)) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(rootMdPath, `---
type: root
status: tentative
last-updated: ${today}
months-covered: []
---

(No memory entries yet. This file will be populated automatically as conversations occur.)
`);
  console.log("  + memory/ROOT.md");
}

if (domains) {
  for (const domain of domains) {
    const upper = domain.toUpperCase();
    copyTemplate("SCRATCHPAD.md", `SCRATCHPAD-${upper}.md`);
    copyTemplate("WORKING.md", `WORKING-${upper}.md`);
  }
} else {
  copyTemplate("SCRATCHPAD.md");
  copyTemplate("WORKING.md");
}

// ─── Step 4: Install skills ───

const skillNames = ["engram-core", "engram-compaction", "engram-search"];
const skillsBase = join(CWD, ".claude", "skills");

for (const skill of skillNames) {
  const destDir = join(skillsBase, skill);
  const destFile = join(destDir, "SKILL.md");
  const src = join(ROOT, "skills", skill, "SKILL.md");
  if (existsSync(src) && !existsSync(destFile)) {
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(src, destFile);
    console.log(`  + skill: ${skill}`);
  }
}

// ─── Step 5: Create config ───

const configDest = join(CWD, "engram.config.json");
if (!existsSync(configDest)) {
  const config = {
    domains: {},
    search: {
      vector: !noVector,
      embedModel: "auto",
    },
    compaction: {
      rootMaxTokens: 3000,
    },
  };

  if (domains) {
    for (const d of domains) {
      config.domains[d] = {
        scratchpad: `SCRATCHPAD-${d.toUpperCase()}.md`,
        working: `WORKING-${d.toUpperCase()}.md`,
      };
    }
  } else {
    config.domains.default = {
      scratchpad: "SCRATCHPAD.md",
      working: "WORKING.md",
    };
  }

  writeFileSync(configDest, JSON.stringify(config, null, 2) + "\n");
  console.log("  + engram.config.json");
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

// ─── Step 7: Platform detection & protocol injection ───

const agentsMd = join(CWD, "AGENTS.md");
const claudeMd = join(CWD, "CLAUDE.md");
const openclawJson = join(CWD, "openclaw.json");

const PROTOCOL_BLOCK = `
## Engram — Memory Protocol

This project uses engram 3-tier memory. Follow \`.claude/skills/engram-core/SKILL.md\`.

### Session Start (mandatory)
1. Read engram.config.json, then load domain-matched files per engram-core skill
2. memory/ROOT.md is auto-loaded (full memory topic index)
3. Read: most recent memory/daily/*.md (if exists)
4. Check compaction triggers — run engram-compaction skill if needed

### End-of-Task Checkpoint (mandatory)
1. SCRATCHPAD.md — current state, decisions, next steps
2. MEMORY.md — APPEND ONLY (never modify Core section)
3. USER.md — newly learned user info
4. memory/YYYY-MM-DD.md — append detailed record
5. WORKING.md — update task status
6. TASK-QUEUE.md — mark completed, add follow-ups

### Rules
- **Never skip checkpoints** — every task completion MUST trigger the 6-step checkpoint
- MEMORY.md Core section: never modify or delete
- memory/*.md (raw): permanent, never delete
- Search: see \`.claude/skills/engram-search/SKILL.md\`
- If this session ends NOW, the next session must be able to continue immediately
`;

const hasEngram = (text) => text.toLowerCase().includes("engram");
const isOpenClaw = existsSync(agentsMd);

if (isOpenClaw) {
  // ── OpenClaw path ──
  const content = readFileSync(agentsMd, "utf8");
  if (!hasEngram(content)) {
    appendFileSync(agentsMd, "\n" + PROTOCOL_BLOCK);
    console.log("  + appended engram protocol to AGENTS.md");
  }

  // Add ROOT.md to bootstrapFiles
  if (existsSync(openclawJson)) {
    try {
      const oc = JSON.parse(readFileSync(openclawJson, "utf8"));
      const bsFiles = oc.bootstrapFiles || [];
      if (!bsFiles.includes("memory/ROOT.md")) {
        oc.bootstrapFiles = [...bsFiles, "memory/ROOT.md"];
        writeFileSync(openclawJson, JSON.stringify(oc, null, 2) + "\n");
        console.log("  + added memory/ROOT.md to openclaw.json bootstrapFiles");
      }
    } catch {
      // openclaw.json not parseable — fallback to instruction
      const agentsContent = readFileSync(agentsMd, "utf8");
      if (!agentsContent.includes("ROOT.md")) {
        appendFileSync(agentsMd, "\nRead `memory/ROOT.md` at every session start.\n");
        console.log("  + added ROOT.md instruction to AGENTS.md");
      }
    }
  } else {
    // No openclaw.json — fallback to instruction in AGENTS.md
    const agentsContent = readFileSync(agentsMd, "utf8");
    if (!agentsContent.includes("ROOT.md")) {
      appendFileSync(agentsMd, "\nRead `memory/ROOT.md` at every session start.\n");
      console.log("  + added ROOT.md instruction to AGENTS.md (no openclaw.json)");
    }
  }
  // Add compaction rotation to HEARTBEAT.md if it exists
  const heartbeatMd = join(CWD, "HEARTBEAT.md");
  if (existsSync(heartbeatMd)) {
    const hbContent = readFileSync(heartbeatMd, "utf8");
    if (!hbContent.includes("engram-compaction")) {
      const compactionRotation = `
### Memory Maintenance (each heartbeat)
Check compaction triggers and run \`engram-compaction\` skill when any condition is met.
Builds/updates the compaction tree (daily/weekly/monthly/root nodes) as new data arrives.
`;
      appendFileSync(heartbeatMd, compactionRotation);
      console.log("  + added compaction rotation to HEARTBEAT.md");
    }
  }
} else {
  // ── Claude Code path ──
  const rootImport = "@memory/ROOT.md\n";

  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, "utf8");
    if (!hasEngram(content)) {
      let newContent = content;
      // Insert @import after existing @ imports, or at the very top
      if (!content.includes("@memory/ROOT.md")) {
        const lines = content.split("\n");
        let insertIdx = 0;
        // Find the last @ import line to insert after it
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("@")) insertIdx = i + 1;
        }
        lines.splice(insertIdx, 0, (insertIdx > 0 ? "" : "") + "@memory/ROOT.md", "");
        newContent = lines.join("\n");
      }
      newContent += "\n" + PROTOCOL_BLOCK;
      writeFileSync(claudeMd, newContent);
      console.log("  + added ROOT.md import and engram protocol to CLAUDE.md");
    }
  } else {
    // Create new CLAUDE.md
    writeFileSync(claudeMd, rootImport + "\n" + PROTOCOL_BLOCK);
    console.log("  + created CLAUDE.md with ROOT.md import and engram protocol");
  }
}

// ─── Step 8: .gitignore ───

const gitignorePath = join(CWD, ".gitignore");
const ENGRAM_GITIGNORE = `
# engram - personal memory (don't commit)
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
  if (!gi.includes("engram")) {
    appendFileSync(gitignorePath, ENGRAM_GITIGNORE);
    console.log("  + added engram entries to .gitignore");
  }
} else {
  writeFileSync(gitignorePath, ENGRAM_GITIGNORE.trimStart());
  console.log("  + created .gitignore with engram entries");
}

// ─── Done ───

console.log(`
  done! Your agent now has structured memory.

  Next steps:
    1. Fill in USER.md with your profile
    2. Start a conversation — the agent will follow the memory protocol
    3. Memory builds up automatically over sessions
`);
