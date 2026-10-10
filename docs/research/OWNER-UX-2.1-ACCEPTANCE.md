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
