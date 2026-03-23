// hipocampus — OpenCode plugin for event-driven memory compaction
// Equivalent to Claude Code's PreCompact + TaskCompleted hooks.
// Plugin API: https://opencode.ai/docs/plugins/
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const HipocampusPlugin = async ({ project, $, directory, worktree }) => {
  const root = worktree || directory;

  // Resolve hipocampus binary: local node_modules or global
  const localBin = join(root, "node_modules", "hipocampus", "cli", "init.mjs");
  const useLocal = existsSync(localBin);

  const runCompact = async () => {
    try {
      if (useLocal) {
        execSync(`node "${localBin}" compact`, { cwd: root, stdio: "pipe" });
      } else {
        execSync("hipocampus compact", { cwd: root, stdio: "pipe" });
      }
    } catch {
      // Compaction is best-effort — don't crash the plugin
    }
  };

  return {
    event: async ({ event }) => {
      // session.idle fires when the agent finishes a turn
      // Equivalent to Claude Code's TaskCompleted hook
      if (event.type === "session.idle") {
        await runCompact();
      }

      // session.compacted fires after OpenCode's own context compression
      // Equivalent to Claude Code's PreCompact hook
      // Note: unlike Claude Code's PreCompact, OpenCode does not pipe
      // transcript via stdin, so compaction is purely mechanical.
      if (event.type === "session.compacted") {
        await runCompact();
      }
    },
  };
};
