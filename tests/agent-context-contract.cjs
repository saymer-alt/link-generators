'use strict';

// Read-only documentation contract. No application code or networks are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentPath = path.join(root, 'AGENTS.md');
const agent = fs.readFileSync(agentPath, 'utf8');
const size = Buffer.byteLength(agent, 'utf8');
const hardLimit = 12 * 1024;
const softTarget = 8 * 1024;
assert(size <= hardLimit, `AGENTS.md startup text is too large: ${size} bytes (limit ${hardLimit})`);
if (size > softTarget) console.warn(`AGENTS.md above soft target ${softTarget} bytes: ${size}; preserve safety rules`);

for (const anchor of [
  'main', 'stable', 'owner GO', 'fail-closed', 'DIRECT',
  'web4core.runtime.js', 'subscription', 'Privacy',
  'Draft PR', 'Mihomo', 'CONSTITUTION.md', 'Proof Before Build',
  'read only the relevant', 'Loop Guard', 'Evidence Reuse',
]) {
  assert(agent.toLowerCase().includes(anchor.toLowerCase()), `AGENTS.md missing required guard: ${anchor}`);
}

const guides = [
  'docs/agent-guidance/01-owner-decisions-and-scope.md',
  'docs/agent-guidance/02-architecture-and-runtime.md',
  'docs/agent-guidance/03-input-formats-and-profiles.md',
  'docs/agent-guidance/04-development-tests-and-debt.md',
  'docs/agent-guidance/05-privacy-and-regressions.md',
];
for (const file of guides) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  assert(content.includes('Relocated source guidance'), `missing scope/provenance in ${file}`);
  assert(agent.includes('](' + file + ')'), `root index does not link ${file}`);
}

const economyPath = 'docs/agent-token-efficiency.md';
const measurementPath = 'docs/agent-token-measurement-protocol.md';
assert(agent.includes('](' + economyPath + ')'), 'root must link to on-demand economy guide');
const economy = fs.readFileSync(path.join(root, economyPath), 'utf8');
const measurement = fs.readFileSync(path.join(root, measurementPath), 'utf8');
for (const marker of ['## 1. Loop Guard', '## 2. Evidence Reuse', '## 3. Tool Calls', '## 4. Один активный цикл', '## 5. Сессионный бюджет', '## 6. Краткий handoff']) {
  assert(economy.includes(marker), `economy guide lost required section: ${marker}`);
}
for (const marker of ['NO_COMPARABLE_BASELINE', 'CONTAMINATED', 'NOT_AVAILABLE']) {
  assert(economy.includes(marker) && measurement.includes(marker), `measurement guard missing: ${marker}`);
}
assert(economy.includes('](' + measurementPath.split('/').pop() + ')'), 'economy guide must link measurement protocol');
const scopedSectionAnchors = ["## Owner decision — WORKING-FIRST, bounded licensing review (11.10.2026)","## Owner-wide design gate — SIMPLICITY-FIRST (2026-10-24)","## Owner intent — why four VPS and multiple Mihomo tiers exist (2026-10-25)","## Owner composition principle and agent intent algorithm (18.10, consolidated 31.10)","## Addendum: automatic whitelist mode","## What this is","## Repository contents (all files)","## Architecture: where each piece of logic lives","## web4core.runtime.js — generated file, never edit by hand","## GitHub Actions: runtime auto-update","## README and code: source of truth","## Input formats and contracts","## Change rules","## Deployment profiles test contract","## Checks after changing HTML/JS","## Privacy and security","## Common dangerous regressions","## Technical debt"];
const corpus = guides.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
for (const heading of scopedSectionAnchors) {
  assert(corpus.includes(heading), `relocated source section missing: ${heading}`);
}

// Only validate Markdown relative links (not root-relative paths shown in code ticks).
for (const file of ['AGENTS.md', ...guides, economyPath, measurementPath]) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:|\/)/i.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(file), target);
    assert(resolved.startsWith(root + path.sep), `link escapes repository: ${file} -> ${target}`);
    assert(fs.existsSync(resolved), `broken link: ${file} -> ${target}`);
  }
}
console.log(`agent context contract: PASS (${size} bytes root; ${guides.length} scoped guides; economy + measurement; ${scopedSectionAnchors.length} source headings)`);
