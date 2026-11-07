# AGENTS.md — link-generators agent startup contract

This file is the **small, unconditional** contract for coding agents (ZCode, Codex and others).
**Do not preload entire `docs/`, old PRs, release reports or the relocated guides on every task.**
Read the task-scoped guide linked below only when the change touches that area.
**Read only the relevant guide(s)** for the files and behavior affected by the task; do not read every guide by default.
Detailed guidance was moved without dropping original sections; see [guidance index below](#read-only-what-the-task-needs).

## Mission and authoritative sources

This repository is a static, client-side WARP MASQUE link generator and Mihomo YAML Builder (`index.html`), with static user help (`quick-start.html`). No app backend, `package.json`, application npm build system or JS framework. Classic scripts and `file://` support are intentional.
The protocol engine lives in `saymer-alt/web4core` branch `link-generators`; `web4core.runtime.js` is a **generated, provenance-checked artifact: never hand-edit it**. Change core parser/emitter behavior in the approved fork source, UI-specific behavior here.
Current code and verified tests outrank dated notes. [CONSTITUTION.md](CONSTITUTION.md) defines binding owner principles; [README.md](README.md) is user-facing. Do not "restore" historical functionality based on a stale README.

## Authority, release and safety — mandatory on every task

- **`main` is development/integration; `stable` is the production GitHub Pages channel.** Work on a separate task branch / Draft PR. Never edit `stable` directly, merge/promote, tag, publish a release, change live VPS/routers, or mutate production without explicit owner GO for that action. A request to fix code or prepare a PR is not release authorization.
- **Release sequence:** reviewed code into `main` → green exact-SHA CI + required browser/Mihomo/field evidence → dedicated `main → stable` promotion PR (no new functionality) → green `stable` CI and Pages verification → tag/release only from the tested production commit. Never tag an unpromoted `main` commit.
- Preserve functioning generation, existing user options, input/output compatibility, fail-closed/no-silent-DIRECT routing, manual overrides, autonomous VPS tiers, service/bootstrap exceptions and intended fallbacks. Do not delete working behavior as a shortcut to satisfy a literal requirement. Changes to routing or default output require owner intent review and regression evidence.
- **Privacy:** WARP/WG private keys, subscription URLs, subscription bodies, proxy/controller credentials and imported config data are sensitive. No telemetry, background subscription polling, secret logging or unintended persistence. Do not paste secrets into issues, PRs, logs or examples. Existing user-triggered subscription inspection and the separately documented opt-in proxy fallback must not be broadened without approval.
- No unreviewed changes to `web4core.runtime.js`, `.nojekyll`, license/NOTICE obligations, supply-chain integrity gates, CI safety gates, or cross-repository deployment contracts. A verified *specific* licensing conflict blocks the affected distribution, not unrelated approved work; do not reopen a generic licensing audit for every task.
- Do not weaken DOM/input sanitization, validation state resets, output correctness, device identity/HWID consistency, private controller fetch boundaries or error handling. Unknown/failed subscription reads are **not** proof of zero nodes.

## Owner intent and minimal-change discipline

Preserve the intended user outcome, not a harmful literal interpretation ("monkey paw"). For complex tasks follow the [common task contract](https://github.com/saymer-alt/saymer-alt/blob/main/AGENT-TASK-CONTRACT.md): checked base SHA, real goal, scoped non-goals, protected state, permissions, negative tests and Definition of Done. Small obvious fixes use proportional process.
For new systems or major architecture use [Proof Before Build](https://github.com/saymer-alt/saymer-alt/blob/main/PROOF-BEFORE-BUILD.md): compare no change / smallest safe solution / larger design, evaluate evidence, maintenance cost and STOP criteria. Avoid speculative platforms and broad refactors.
**Composition-first:** the owner intentionally uses independent VPS, transports and failover tiers to survive different failures. Do not replace their separate roles with a monolith or simplify away useful redundancy. If a required trade-off remains ambiguous, stop that unsafe change and ask for owner GO; continue safe read-only investigation. Read [owner rationale](docs/agent-guidance/01-owner-decisions-and-scope.md) only for architecture/profile work.

## Focused workflow

1. Verify repository, exact branch/HEAD, task scope, existing code/PRs and relevant tests. Read this file and **only the relevant** guide(s) below; for cross-fork runtime changes also read the other repository's AGENTS and [WEB4CORE-FORK.md](docs/WEB4CORE-FORK.md).
2. Identify protected behavior, smallest reversible change, negative test and positive regression before implementation. Do not silently change UI defaults, input contracts, output routing or generated artifacts.
3. Edit only targeted files. Keep Russian UI/help wording, inline JS/classic `<script>`, existing DOM IDs and `file://` working. Update `quick-start.html` / README if the actual user-facing behavior changes. Avoid speculative refactoring and incidental formatting.
4. Run checks matched to the diff, not the entire expensive test catalog by default. For HTML/JS or generated YAML follow [scoped tests](docs/agent-guidance/04-development-tests-and-debt.md), [TESTING.md](docs/TESTING.md), and [profile test contract](docs/DEPLOYMENT-PROFILES-TEST-CONTRACT.md). Prefer exact-SHA green CI evidence; manual/live tests are not CI PASS.
5. Before reporting, inspect final diff and exact commit SHA; state PASS / FAIL / BLOCKED / NOT TESTED accurately. No automatic merge, release, Pages production promotion or live infrastructure changes.

## Load guides on demand — not every session

- **Owner policy, dated decisions, autonomy, whitelist:** [01 — decisions and scope](docs/agent-guidance/01-owner-decisions-and-scope.md). Read for major behavior/architecture/owner-intent changes, not a small typo.
- **UI/engine boundaries, functions, generated runtime, historical feature state:** [02 — architecture and runtime](docs/agent-guidance/02-architecture-and-runtime.md). Read for `index.html`, shared web4core source or runtime work.
- **MASQUE link encoding, subscriptions, HWID, AWG/WG, VPS deployment profiles, Mihomo version:** [03 — formats and profiles](docs/agent-guidance/03-input-formats-and-profiles.md). Read for link/YAML generation, parsing, profile/compatibility changes. Format, port and DPI strategies are deliberate contracts, never "improve" silently.
- **Development workflow, release details, tests, technical debt:** [04 — development and tests](docs/agent-guidance/04-development-tests-and-debt.md). Read for implementation, CI/test or release work; do not add debt tracking outside scope without permission.
- **Privacy, subscription-proxy boundaries, controller access and regression traps:** [05 — security and regressions](docs/agent-guidance/05-privacy-and-regressions.md). Read for user-data, input, identity, routing or security-sensitive changes.

Past experiments, removed tabs, previous runtime versions, dated PR/issue decisions and measured outcomes are **historical evidence**, not assumed current HEAD or live server state. They remain in the scoped guides and existing `docs/research/` and release documents; load only when directly relevant.
