# Owner UX 2.1 — acceptance evidence

## Scope and baseline

Baseline: `b111f01a738efe37315ebc6d17acd308bc9a49b0` (current main; owner reference 9358ff4 is its ancestor). UI changes preserve generation options and internal group names. Routing compatibility is reviewed separately before merge.

## UI evidence

New automated regressions UX13–UX17 fail on baseline (5/5), pass on candidate (5/5); existing UX01–UX12 retained. Chromium full suite: 41/41. YAML byte parity against baseline: all scenarios, including AWL, Tiered, WG and advanced. Subscription preview: 17/17. Firefox/WebKit and full CI results are recorded in PR checks at exact head.

Viewport matrix: 1280×720, 1366×768, 1920×1080, 390 and 320 px, all five workspaces. Browser zoom 200%: **NOT RUN**; headless viewport resizing is not browser zoom.

## Owner acceptance

1. Open Builder; AWL follows profile and reveals reserve input. List controls are beside the main input.
2. Build, visit each workspace, use the pinned actions. Edit an input: status becomes stale and Copy/Download are blocked until Build succeeds.
3. Create SELECT cards AI and YouTube; rename AI, Build, inspect RULE-SET references; save and reload.
4. Disable Web UI: dashboard selection remains visible and retained. WG DNS/keepalive are beside upload; diagnostic RandomTrailers remains explicit.
5. Inspect priority groups in graph and Inspector: readable display, unchanged YAML names.

Synthetic fixtures only. No live router, VPS, user subscription or packet-path acceptance is claimed. No stable/tag/release/Owner GO promotion.

## Routing compatibility (separate owner-review PR)

Baseline probe: AWL+Tiered previously produced VALID YAML but changed the final MATCH to Tiered. Per-Proxy+Tiered remained valid and is not newly blocked. UX18 baseline: five failures and one existing compatible scenario passes; candidate: six passes. Final exact-head CI records all three browsers and real Mihomo versions. Complete compatibility matrix and source boundary: [AUTO-WHITELIST.md](../AUTO-WHITELIST.md).

Guards cover manual switch, profile return, Load, Undo, Reverse Restore, Save, Build and direct Tiered override. Accepted conflicts deactivate modes while preserving data. Cancel precedes mutation. AWL+DPR SELECT and synthetic URL subscriptions ON/OFF preserve MATCH,GLOBAL. Runtime is generated and unchanged; Tiered guards belong to the consumer postprocessor.

YAML parity for valid existing scenarios remains byte-identical to the UI PR. Intentional changes: conflicting AWL+Tiered/Per-Proxy states now fail Build instead of silently rewriting/clamping; accepted old projects deactivate conflicts; new tier cards have neutral names. Existing names and internal group syntax are not migrated. Health-check semantics are unchanged.

### PowerShell preview

From the routing candidate checkout, run:

```powershell
python -m http.server 34224 --bind 127.0.0.1 --directory .
```

Open `http://127.0.0.1:34224/index.html` in a browser. Preview routing candidate separately from main. It requires owner review before merge.

Manual acceptance: configure Tiered; enable AWL and cancel, compare fields; accept and inspect disabled controls and retained cards; Build and verify MATCH,GLOBAL; disable AWL and verify Tiered stays off; load an old conflicting project and repeat cancel/accept; create two SELECT cards, rename one and inspect group/rule references.
