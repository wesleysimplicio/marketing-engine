import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const page = resolve("site", "simplex-agent", "index.html");

test("/simplex-agent is a real self-contained page with evidence links", () => {
  assert.equal(existsSync(page), true);
  const html = readFileSync(page, "utf8");
  assert.match(html, /<title>Simplicio Agent/);
  assert.match(html, /DRY_RUN=true/);
  assert.match(html, /AGENTS\.md/);
  assert.match(html, /extensions\/loop\.marketing\/manifest\.json/);
  assert.match(html, /issue-130-low-ticket-workflow\.md/);
  assert.doesNotMatch(html, /(?:googleapis|jsdelivr|unpkg|fonts\.google|plausible|segment\.io)/i);
});

