/**
 * hipocampus compact — Mechanical compaction of the memory tree.
 *
 * Runs as a pre-compaction hook (before platform context compression).
 * Handles below-threshold cases (copy/concat) without LLM.
 * Above-threshold cases are marked needs-summarization — the agent hook handles those.
 *
 * Transcript source (checked in order):
 *   1. --stdin flag: read JSON from stdin (PreCompact hook passes { transcript_path, ... })
 *   2. TRANSCRIPT_PATH env var (legacy)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CWD = process.cwd();
const MEMORY = join(CWD, "memory");
const args = process.argv.slice(2);

// Use local date (not UTC) to match the user's calendar day
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// ─── Transcript backup ───

let transcriptPath = process.env.TRANSCRIPT_PATH;

// --stdin: read transcript_path from PreCompact hook JSON on stdin
if (args.includes("--stdin")) {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const stdinData = JSON.parse(Buffer.concat(chunks).toString());
    if (stdinData.transcript_path) transcriptPath = stdinData.transcript_path;
  } catch { /* stdin not available or not JSON — fall through to env var */ }
}

if (transcriptPath && existsSync(transcriptPath)) {
  const ext = transcriptPath.endsWith(".jsonl") ? "jsonl" : "bak";
  const backupPath = join(MEMORY, `.session-transcript-${today}.${ext}`);
  mkdirSync(MEMORY, { recursive: true });
  copyFileSync(transcriptPath, backupPath);
}

// ─── Load config ───

let config = {};
const configPath = join(CWD, "hipocampus.config.json");
if (existsSync(configPath)) {
  try { config = JSON.parse(readFileSync(configPath, "utf8")); } catch { /* use defaults */ }
}

const DAILY_THRESHOLD = 200;
const WEEKLY_THRESHOLD = 300;
const MONTHLY_THRESHOLD = 500;

// ─── Helper: count lines ───

const countLines = (filePath) => {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, "utf8").split("\n").length;
};

// ─── Helper: list dated files ───

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const listRawDates = () => {
  if (!existsSync(MEMORY)) return [];
  return readdirSync(MEMORY)
    .filter(f => DATE_RE.test(f))
    .map(f => f.match(DATE_RE)[1])
    .sort();
};

// ─── Helper: ISO week ───

const isoWeek = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00Z");
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

// ─── Helper: month from date ───

const monthOf = (dateStr) => dateStr.slice(0, 7);

// ─── Helper: days since date ───

const daysSince = (dateStr) => {
  const then = new Date(dateStr + "T00:00:00Z");
  const now = new Date(today + "T00:00:00Z");
  return Math.floor((now - then) / 86400000);
};

// ─── Step 1: Raw → Daily ───

const dailyDir = join(MEMORY, "daily");
mkdirSync(dailyDir, { recursive: true });

const rawDates = listRawDates();
let dailyUpdated = false;

for (const date of rawDates) {
  const rawPath = join(MEMORY, `${date}.md`);
  const dailyPath = join(dailyDir, `${date}.md`);
  const isToday = date === today;
  const status = isToday ? "tentative" : "fixed";

  // Skip if daily node already exists and is fixed (no need to rewrite)
  if (existsSync(dailyPath)) {
    const existing = readFileSync(dailyPath, "utf8");
    if (existing.includes("status: fixed")) continue;
  }

  const rawLines = countLines(rawPath);

  if (rawLines === 0) continue;

  if (rawLines <= DAILY_THRESHOLD) {
    // Below threshold — copy verbatim
    const rawContent = readFileSync(rawPath, "utf8");
    const frontmatter = `---\ntype: daily\nstatus: ${status}\nperiod: ${date}\nsource-files: [memory/${date}.md]\ntopics: []\n---\n\n`;
    writeFileSync(dailyPath, frontmatter + rawContent);
    dailyUpdated = true;
  } else if (!existsSync(dailyPath) || isToday) {
    // Above threshold — mark for agent processing
    const placeholder = `---\ntype: daily\nstatus: needs-summarization\nperiod: ${date}\nsource-files: [memory/${date}.md]\nlines: ${rawLines}\n---\n\nThis daily node exceeds ${DAILY_THRESHOLD} lines and needs LLM summarization.\nRun hipocampus-compaction skill to generate the summary.\n`;
    writeFileSync(dailyPath, placeholder);
    dailyUpdated = true;
  }
}

// ─── Step 2: Daily → Weekly ───

const weeklyDir = join(MEMORY, "weekly");
mkdirSync(weeklyDir, { recursive: true });

// Group daily files by ISO week
const dailyFiles = existsSync(dailyDir)
  ? readdirSync(dailyDir).filter(f => DATE_RE.test(f)).map(f => f.match(DATE_RE)[1]).sort()
  : [];

const weekGroups = {};
for (const date of dailyFiles) {
  const week = isoWeek(date);
  if (!weekGroups[week]) weekGroups[week] = [];
  weekGroups[week].push(date);
}

let weeklyUpdated = false;

for (const [week, dates] of Object.entries(weekGroups)) {
  const weeklyPath = join(weeklyDir, `${week}.md`);

  // Determine status: fixed if week ended + 7 days, otherwise tentative
  const allPast = dates.every(d => d < today);
  const oldestDate = dates[0];
  const isFixed = allPast && daysSince(oldestDate) >= 7;
  const status = isFixed ? "fixed" : "tentative";

  // Skip if already fixed
  if (existsSync(weeklyPath)) {
    const existing = readFileSync(weeklyPath, "utf8");
    if (existing.includes("status: fixed")) continue;
  }

  // Combine daily contents
  let combined = "";
  let totalLines = 0;
  for (const date of dates) {
    const dailyPath = join(dailyDir, `${date}.md`);
    if (existsSync(dailyPath)) {
      const content = readFileSync(dailyPath, "utf8");
      // Skip files that need LLM summarization
      if (content.includes("needs-summarization")) continue;
      combined += `\n\n# ${date}\n\n` + content;
      totalLines += countLines(dailyPath);
    }
  }

  if (totalLines === 0) continue;

  if (totalLines <= WEEKLY_THRESHOLD) {
    // Below threshold — concat
    const frontmatter = `---\ntype: weekly\nstatus: ${status}\nperiod: ${week}\ndates: ${dates[0]} to ${dates[dates.length - 1]}\nsource-files: [${dates.map(d => `memory/daily/${d}.md`).join(", ")}]\ntopics: []\n---\n`;
    writeFileSync(weeklyPath, frontmatter + combined);
    weeklyUpdated = true;
  } else if (!existsSync(weeklyPath) || status === "tentative") {
    // Above threshold — mark for agent
    const placeholder = `---\ntype: weekly\nstatus: needs-summarization\nperiod: ${week}\ndates: ${dates[0]} to ${dates[dates.length - 1]}\nlines: ${totalLines}\n---\n\nThis weekly node exceeds ${WEEKLY_THRESHOLD} lines and needs LLM summarization.\nRun hipocampus-compaction skill to generate the summary.\n`;
    writeFileSync(weeklyPath, placeholder);
    weeklyUpdated = true;
  }
}

// ─── Step 3: Weekly → Monthly ───

const monthlyDir = join(MEMORY, "monthly");
mkdirSync(monthlyDir, { recursive: true });

const WEEK_RE = /^(\d{4}-W\d{2})\.md$/;
const weeklyFiles = existsSync(weeklyDir)
  ? readdirSync(weeklyDir).filter(f => WEEK_RE.test(f)).map(f => f.match(WEEK_RE)[1]).sort()
  : [];

// Group weekly files by month (approximate — use first date of week)
const monthGroups = {};
for (const week of weeklyFiles) {
  // Parse week to get approximate month
  const [yearStr, weekNumStr] = week.split("-W");
  const year = parseInt(yearStr);
  const weekNum = parseInt(weekNumStr);
  // Approximate: week 1 = Jan, week 5 = Feb, etc.
  const approxDate = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
  const month = `${year}-${String(approxDate.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!monthGroups[month]) monthGroups[month] = [];
  monthGroups[month].push(week);
}

let monthlyUpdated = false;

for (const [month, weeks] of Object.entries(monthGroups)) {
  const monthlyPath = join(monthlyDir, `${month}.md`);

  // Determine status: fixed if month ended + 7 days, otherwise tentative
  const monthEnd = new Date(Date.UTC(parseInt(month.slice(0, 4)), parseInt(month.slice(5)) , 0));
  const monthEndStr = monthEnd.toISOString().slice(0, 10);
  const isFixed = daysSince(monthEndStr) >= 7;
  const status = isFixed ? "fixed" : "tentative";

  // Skip if already fixed
  if (existsSync(monthlyPath)) {
    const existing = readFileSync(monthlyPath, "utf8");
    if (existing.includes("status: fixed")) continue;
  }

  // Combine weekly contents
  let combined = "";
  let totalLines = 0;
  for (const week of weeks) {
    const weeklyPath = join(weeklyDir, `${week}.md`);
    if (existsSync(weeklyPath)) {
      const content = readFileSync(weeklyPath, "utf8");
      if (content.includes("needs-summarization")) continue;
      combined += `\n\n# ${week}\n\n` + content;
      totalLines += countLines(weeklyPath);
    }
  }

  if (totalLines === 0) continue;

  if (totalLines <= MONTHLY_THRESHOLD) {
    // Below threshold — concat
    const frontmatter = `---\ntype: monthly\nstatus: ${status}\nperiod: ${month}\nweeks: [${weeks.join(", ")}]\nsource-files: [${weeks.map(w => `memory/weekly/${w}.md`).join(", ")}]\ntopics: []\n---\n`;
    writeFileSync(monthlyPath, frontmatter + combined);
    monthlyUpdated = true;
  } else if (!existsSync(monthlyPath) || status === "tentative") {
    // Above threshold — mark for agent
    const placeholder = `---\ntype: monthly\nstatus: needs-summarization\nperiod: ${month}\nlines: ${totalLines}\n---\n\nThis monthly node exceeds ${MONTHLY_THRESHOLD} lines and needs LLM summarization.\nRun hipocampus-compaction skill to generate the summary.\n`;
    writeFileSync(monthlyPath, placeholder);
    monthlyUpdated = true;
  }
}

// ─── Step 4: Update ROOT.md + sync to MEMORY.md ───

if (dailyUpdated || weeklyUpdated || monthlyUpdated) {
  const rootPath = join(MEMORY, "ROOT.md");
  if (existsSync(rootPath)) {
    let rootContent = readFileSync(rootPath, "utf8");
    // Update last-updated date
    rootContent = rootContent.replace(/last-updated:.*/, `last-updated: ${today}`);
    writeFileSync(rootPath, rootContent);

    // Sync ROOT.md content to MEMORY.md's Compaction Root section (for OpenClaw)
    const memoryMdPath = join(CWD, "MEMORY.md");
    if (existsSync(memoryMdPath)) {
      const memContent = readFileSync(memoryMdPath, "utf8");
      if (memContent.includes("## Compaction Root")) {
        // Extract ROOT.md body (skip frontmatter)
        const rootBody = rootContent.replace(/^---[\s\S]*?---\n*/, "")
          .replace(/^## /gm, "### "); // demote headings to fit inside MEMORY.md
        const updated = memContent.replace(
          /## Compaction Root[\s\S]*?(?=\n## |$)/,
          `## Compaction Root\n<!-- Auto-synced from memory/ROOT.md by hipocampus compact -->\n\n${rootBody}\n`
        );
        writeFileSync(memoryMdPath, updated);
      }
    }
  }

  // Re-index qmd (if available)
  try {
    const { execSync: exec } = await import("node:child_process");
    exec("qmd update", { cwd: CWD, stdio: "pipe" });

    // Update vector embeddings if enabled
    if (config.search?.vector !== false) {
      exec("qmd embed", { cwd: CWD, stdio: "pipe" });
    }
  } catch { /* qmd may not be installed */ }
}

// ─── Summary ───

const actions = [];
if (transcriptPath) actions.push("transcript backed up");
if (dailyUpdated) actions.push("daily nodes updated");
if (weeklyUpdated) actions.push("weekly nodes updated");
if (monthlyUpdated) actions.push("monthly nodes updated");

if (actions.length > 0) {
  console.log(`  hipocampus compact: ${actions.join(", ")}`);
} else {
  console.log("  hipocampus compact: nothing to do");
}
