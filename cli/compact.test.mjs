/**
 * Tests for hipocampus compact — secret scanning.
 * Run: node hipocampus/cli/compact.test.mjs
 */

import { strict as assert } from "node:assert";

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}/i,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  /(?:token)\s*[:=]\s*['"]?[A-Za-z0-9_\-\.]{20,}/i,
  /(?:sk-|pk_live_|pk_test_|ghp_|gho_|github_pat_)[A-Za-z0-9_\-]{20,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /(?:Bearer\s+)[A-Za-z0-9_\-\.]{20,}/i,
];

const scanLine = (line) => SECRET_PATTERNS.some(p => p.test(line));
const redactLine = (line) => scanLine(line) ? "[REDACTED: secret detected]" : line;
const scanSecrets = (content) => content.split("\n").map(redactLine).join("\n");

// ─── Positive cases — should detect ───

assert.ok(scanLine('api_key = "sk-abc123def456ghi789jkl012"'), "should detect api_key");
assert.ok(scanLine("API-KEY: ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "should detect API-KEY");
assert.ok(scanLine('password = "mysecretpassword123"'), "should detect password");
assert.ok(scanLine('secret: "verylongsecretvalue123"'), "should detect secret");
assert.ok(scanLine("sk-proj-abcdefghijklmnopqrstuvwxyz"), "should detect sk- prefix");
assert.ok(scanLine("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZab"), "should detect ghp_ prefix");
assert.ok(scanLine("github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZab"), "should detect github_pat_");
assert.ok(scanLine("-----BEGIN RSA PRIVATE KEY-----"), "should detect RSA private key");
assert.ok(scanLine("-----BEGIN PRIVATE KEY-----"), "should detect private key");
assert.ok(scanLine("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"), "should detect Bearer token");
assert.ok(scanLine("pk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZab"), "should detect pk_live_ prefix");

// ─── Negative cases — should NOT detect ───

assert.ok(!scanLine("## API Design Discussion [project]"), "should not flag topic headings");
assert.ok(!scanLine("- decided to use API key rotation"), "should not flag discussion of keys");
assert.ok(!scanLine("password policy requires 12 characters"), "should not flag password policy discussion");
assert.ok(!scanLine("token count: 3500"), "should not flag token count");
assert.ok(!scanLine("the secret to good compaction is..."), "should not flag prose use of 'secret'");
assert.ok(!scanLine(""), "should not flag empty lines");

// ─── Redaction ───

assert.equal(
  redactLine('api_key = "sk-abc123def456ghi789jkl012"'),
  "[REDACTED: secret detected]",
  "should redact entire line"
);
assert.equal(
  redactLine("normal line about compaction"),
  "normal line about compaction",
  "should preserve normal lines"
);

// ─── Full content scan ───

const testContent = `## Session Notes
- discussed API architecture
- api_key = "sk-abc123def456ghi789jkl012"
- decided on rotation policy`;

const redacted = scanSecrets(testContent);
assert.ok(redacted.includes("[REDACTED: secret detected]"), "should redact secret line in content");
assert.ok(redacted.includes("discussed API architecture"), "should preserve normal lines in content");
assert.ok(redacted.includes("decided on rotation policy"), "should preserve normal lines in content");

console.log("  + All secret scanner tests passed");
