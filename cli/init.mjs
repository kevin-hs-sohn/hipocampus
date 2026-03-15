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

const dirs = ["memory", "memory/weekly", "memory/monthly", "knowledge", "plans"];
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
  const src = join(ROOT, "skills", skill, "SKILL.md");
  if (existsSync(src)) {
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(src, join(destDir, "SKILL.md"));
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

// ─── Step 7: Append to CLAUDE.md ───

const claudeMd = join(CWD, "CLAUDE.md");
if (existsSync(claudeMd)) {
  const content = readFileSync(claudeMd, "utf8");
  if (!content.includes("engram")) {
    const section = `

## Memory System (engram)

This project uses [engram](https://github.com/kevin-hs-sohn/engram) for agent memory.

- **Read at session start:** MEMORY.md, USER.md, SCRATCHPAD.md, WORKING.md
- **Update after every task:** Run the 6-step end-of-task checkpoint (see engram-core skill)
- **Search:** Use \`qmd query "..."\` for hybrid search or \`qmd search "..."\` for keyword search
- **Config:** See \`engram.config.json\` for domain and search settings
`;
    appendFileSync(claudeMd, section);
    console.log("  + added engram section to CLAUDE.md");
  }
}

// ─── Done ───

console.log(`
  done! Your agent now has structured memory.

  Next steps:
    1. Fill in USER.md with your profile
    2. Start a conversation — the agent will follow the memory protocol
    3. Memory builds up automatically over sessions
`);
