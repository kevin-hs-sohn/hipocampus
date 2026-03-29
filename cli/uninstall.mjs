/**
 * hipocampus uninstall — Remove hipocampus from the current project.
 *
 * Default: removes hooks, skills, protocol blocks, config. Keeps memory data.
 * --purge: also removes memory/, knowledge/, plans/, templates, tenants/
 * --tenant <id>: removes only a specific tenant directory
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const CWD = process.cwd();
const args = process.argv.slice(2);

const purge = args.includes("--purge");
const tenantIdx = args.indexOf("--tenant");
const tenantId = tenantIdx !== -1 ? args[tenantIdx + 1] : null;

// ─── Tenant-only uninstall ───

if (tenantId) {
  const tenantDir = join(CWD, "tenants", tenantId);
  if (!existsSync(tenantDir)) {
    console.error(`  ! Tenant "${tenantId}" not found at tenants/${tenantId}/`);
    process.exit(1);
  }

  rmSync(tenantDir, { recursive: true });
  console.log(`  + removed tenants/${tenantId}/`);

  // Remove from config
  const configPath = join(CWD, "hipocampus.config.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (Array.isArray(config.tenants)) {
        config.tenants = config.tenants.filter(t => t !== tenantId);
        if (config.tenants.length === 0) delete config.tenants;
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
        console.log(`  + removed "${tenantId}" from hipocampus.config.json`);
      }
    } catch { /* config parse error */ }
  }

  // Remove tenant qmd collections
  try {
    const { execSync } = await import("node:child_process");
    execSync(`qmd collection remove tenant-${tenantId}-memory`, { cwd: CWD, stdio: "pipe" });
    execSync(`qmd collection remove tenant-${tenantId}-knowledge`, { cwd: CWD, stdio: "pipe" });
    console.log(`  + removed tenant qmd collections`);
  } catch { /* qmd not installed or collections don't exist */ }

  console.log(`\n  tenant "${tenantId}" uninstalled.\n`);
  process.exit(0);
}

// ─── Purge confirmation ───

if (purge) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question('  ! This will delete ALL memory data. Type "yes" to confirm: ', resolve);
  });
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("  ~ uninstall cancelled.");
    process.exit(0);
  }
}

console.log(`\n  hipocampus — uninstalling${purge ? " (purge)" : ""}\n`);

// ─── Platform detection ───

const configPath = join(CWD, "hipocampus.config.json");
let platform = "claude-code";
if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config.platform) platform = config.platform;
  } catch { /* use default */ }
}

// ─── Step 1: Remove hooks ───

if (platform === "claude-code") {
  const settingsPath = join(CWD, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      let changed = false;
      if (settings.hooks?.PreCompact) {
        settings.hooks.PreCompact = settings.hooks.PreCompact.filter(
          rule => !rule.hooks?.some(h => h.command?.includes("hipocampus"))
        );
        if (settings.hooks.PreCompact.length === 0) delete settings.hooks.PreCompact;
        changed = true;
      }
      if (settings.hooks?.TaskCompleted) {
        settings.hooks.TaskCompleted = settings.hooks.TaskCompleted.filter(
          rule => !rule.hooks?.some(h => h.command?.includes("hipocampus"))
        );
        if (settings.hooks.TaskCompleted.length === 0) delete settings.hooks.TaskCompleted;
        changed = true;
      }
      if (changed) {
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        console.log("  + removed hooks from .claude/settings.json");
      }
    } catch { /* settings parse error */ }
  }
} else if (platform === "opencode") {
  // Remove plugin file
  const pluginPath = join(CWD, ".opencode", "plugins", "hipocampus.js");
  if (existsSync(pluginPath)) {
    rmSync(pluginPath);
    console.log("  + removed .opencode/plugins/hipocampus.js");
  }
  // Remove from opencode.json
  const ocPath = join(CWD, "opencode.json");
  if (existsSync(ocPath)) {
    try {
      const oc = JSON.parse(readFileSync(ocPath, "utf8"));
      if (Array.isArray(oc.plugin)) {
        oc.plugin = oc.plugin.filter(p => !p.includes("hipocampus"));
        if (oc.plugin.length === 0) delete oc.plugin;
        writeFileSync(ocPath, JSON.stringify(oc, null, 2) + "\n");
        console.log("  + removed plugin from opencode.json");
      }
    } catch { /* parse error */ }
  }
} else if (platform === "openclaw") {
  const ocPath = join(CWD, "openclaw.json");
  if (existsSync(ocPath)) {
    try {
      const oc = JSON.parse(readFileSync(ocPath, "utf8"));
      if (oc.hooks?.internal?.entries?.["hipocampus-compact"]) {
        delete oc.hooks.internal.entries["hipocampus-compact"];
        if (Object.keys(oc.hooks.internal.entries).length === 0) delete oc.hooks.internal;
        writeFileSync(ocPath, JSON.stringify(oc, null, 2) + "\n");
        console.log("  + removed hook from openclaw.json");
      }
    } catch { /* parse error */ }
  }
}

// ─── Step 2: Remove skills ───

const skillNames = ["hipocampus-core", "hipocampus-compaction", "hipocampus-search", "hipocampus-flush"];
const skillsBase = platform === "opencode"
  ? join(CWD, ".opencode", "skills")
  : platform === "openclaw"
    ? join(CWD, "skills")
    : join(CWD, ".claude", "skills");

for (const skill of skillNames) {
  const skillDir = join(skillsBase, skill);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true });
    console.log(`  + removed skill: ${skill}`);
  }
}

// ─── Step 3: Remove protocol block ───

const MARKER_START = "<!-- hipocampus:protocol:start -->";
const MARKER_END = "<!-- hipocampus:protocol:end -->";

const protocolFile = platform === "claude-code"
  ? join(CWD, "CLAUDE.md")
  : join(CWD, "AGENTS.md");

if (existsSync(protocolFile)) {
  let content = readFileSync(protocolFile, "utf8");
  if (content.includes(MARKER_START)) {
    const re = new RegExp(
      MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "[\\s\\S]*?"
      + MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "\\n?"
    );
    content = content.replace(re, "");

    // Remove @import lines (Claude Code)
    if (platform === "claude-code") {
      content = content.replace(/^@memory\/ROOT\.md\n?/gm, "");
      content = content.replace(/^@SCRATCHPAD\.md\n?/gm, "");
      content = content.replace(/^@WORKING\.md\n?/gm, "");
      content = content.replace(/^@TASK-QUEUE\.md\n?/gm, "");
    }

    // Clean up excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim() + "\n";

    writeFileSync(protocolFile, content);
    console.log(`  + removed protocol block from ${platform === "claude-code" ? "CLAUDE.md" : "AGENTS.md"}`);
  }
}

// ─── Step 4: Remove config ───

if (existsSync(configPath)) {
  rmSync(configPath);
  console.log("  + removed hipocampus.config.json");
}

const compactionState = join(CWD, "memory", ".compaction-state.json");
if (existsSync(compactionState)) {
  rmSync(compactionState);
  console.log("  + removed memory/.compaction-state.json");
}

// ─── Step 5: Remove qmd collections ───

try {
  const { execSync } = await import("node:child_process");
  execSync("qmd collection remove memory", { cwd: CWD, stdio: "pipe" });
  execSync("qmd collection remove knowledge", { cwd: CWD, stdio: "pipe" });
  console.log("  + removed qmd collections");
} catch { /* qmd not installed or collections don't exist */ }

// ─── Step 6: Purge (optional) ───

if (purge) {
  const purgeDirs = ["memory", "knowledge", "plans", "tenants"];
  for (const dir of purgeDirs) {
    const p = join(CWD, dir);
    if (existsSync(p)) {
      rmSync(p, { recursive: true });
      console.log(`  + removed ${dir}/`);
    }
  }

  const purgeFiles = ["SCRATCHPAD.md", "WORKING.md", "TASK-QUEUE.md", "MEMORY.md", "USER.md", "HEARTBEAT.md"];
  for (const file of purgeFiles) {
    const p = join(CWD, file);
    if (existsSync(p)) {
      rmSync(p);
      console.log(`  + removed ${file}`);
    }
  }

  // Remove .gitignore hipocampus entries
  const gitignorePath = join(CWD, ".gitignore");
  if (existsSync(gitignorePath)) {
    let gi = readFileSync(gitignorePath, "utf8");
    gi = gi.replace(/\n# hipocampus[^\n]*\n(?:[^\n]*\n)*?(?=\n[^#\n]|\n#[^h]|$)/i, "\n");
    gi = gi.replace(/\n{3,}/g, "\n\n").trim() + "\n";
    writeFileSync(gitignorePath, gi);
    console.log("  + removed hipocampus entries from .gitignore");
  }
}

// ─── Done ───

if (purge) {
  console.log("\n  hipocampus fully removed (all data deleted).\n");
} else {
  console.log(`
  hipocampus uninstalled. Memory data preserved in:
    memory/    — raw logs and compaction tree
    knowledge/ — curated knowledge
    plans/     — task plans

  To also remove memory data: hipocampus uninstall --purge
`);
}
