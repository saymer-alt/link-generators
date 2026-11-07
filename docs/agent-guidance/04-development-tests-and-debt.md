# Development, test, release and technical-debt rules

> **Relocated source guidance (2026-11-07).** Read for code, test, CI, release and debt-related work. Paths written in backticks are relative to the repository root.
> This is **task-scoped reference material**, not the unconditional agent startup file. Binding safety rules in [root AGENTS.md](../../AGENTS.md) and [CONSTITUTION.md](../../CONSTITUTION.md) still apply. The material below preserves all original sections in their former order (except that Markdown relative link targets are rebased for this directory); "this file" in old prose means the former root AGENTS.md.

---

## Change rules

1. Before changing generation logic (links, YAML, parsing), first understand the
   existing format and contracts above; do not change behavior "for improvement" without
   a task for it. Users paste generated link/YAML formats into their routers —
   silent changes break other people's configs.
2. Edit `index.html` — the main application page (`quick-start.html` is a static
   help page; if a user-facing feature set changes, update it in the same task).
3. Never edit `web4core.runtime.js` by hand (auto-update will overwrite it).
4. Keep diffs minimal; do not reformat untouched sections; preserve the existing
   inline style and Russian UI text. Do not introduce a build system, npm, ES modules,
   or frameworks — classic `<script>` and `file://` operation are features.
5. Do not change DOM element IDs (`mihomoInput`, `cfgLan`, `pingSelect`, …) without
   updating JS at the same time — all bindings are by ID.
6. New build functionality must use public `globalThis.web4core` API or result
   post-processing; runtime changes belong in fork sources within approved scope.
7. Commit only targeted changes; before committing, check `git status` / `git diff`:
   the diff must contain nothing except the intended change (especially no accidental
   changes to `web4core.runtime.js`).

## Deployment profiles test contract

Mandatory profile/regression contract: [docs/DEPLOYMENT-PROFILES-TEST-CONTRACT.md](../../docs/DEPLOYMENT-PROFILES-TEST-CONTRACT.md).

## Checks after changing HTML/JS

Automated regressions: `node tests/runtime.cjs` and the external Playwright run
`tests/browser.cjs` (details: docs/TESTING.md). Additional checks:

1. JS syntax: extract the inline script from `index.html` (contents of the last
   `<script>…</script>` tag) and run it through a parser; on hosts with Node use
   `node --check` (including for `web4core.runtime.js`).
2. Manual browser run (opening `index.html` directly via `file://` works;
   js-yaml from CDN requires Internet): both tabs; full flow — paste YAML →
   "Parse" → "Generate" → "To Mihomo Builder" → "Build Config" → validation →
   Copy; verify the expected options (allow-lan, mixed-port, TUN) are reflected.
3. Validator regression minimum: `transport: TPC` → INVALID and Copy blocked,
   `TCP` → VALID; AWG 3.1 `.conf` → VALID (`version: 3` in YAML); any input change
   resets validation state.
4. After push: check the live page https://saymer-alt.github.io/link-generators/ and
   (if a runtime bot commit arrived) repeat the manual run — especially the allow-lan
   patch and validator enum lists (docs/UPDATES.md).

## Technical debt

- Treat technical debt as a separate engineering risk, but do not confuse it with cosmetics, personal style preferences, or merely "ugly" working code.
- For each debt item, provide evidence first and classify its impact: **High** (breakage/security/data-loss risk or blocks operation), **Medium** (impedes development, creates duplication or logic divergence, or materially increases maintenance cost), **Low** (local complexity with little current risk).
- Do not refactor for cleanliness alone. Pay down debt when the benefit and risk reduction justify the change; do not rewrite stable, verified code without a concrete reason.
- Debt fixes must keep minimal scope, preserve existing safety boundaries, and pass the project's normal regression/safety checks. If the fix creates greater risk or new debt, stop and propose a safer alternative.
- If debt is discovered outside the current task, do not silently expand scope: record the finding and recommendation, and implement it only when it is in scope or explicitly approved by the operator.
- If debt is discovered outside the current task, do not change code or documentation solely to record the finding. In the final report, state the location, brief description, evidence, **High / Medium / Low** level, risk, and recommended action. If the finding deserves separate tracking, propose creating a GitHub Issue. Create an Issue, add a `TODO`, or change files to record debt only with explicit operator permission. `TODO (TechDebt ...)` is acceptable when such a comment is within the approved scope and is genuinely needed next to the code.
