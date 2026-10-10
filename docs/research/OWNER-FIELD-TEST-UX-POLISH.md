# Owner Field-Test UX Polish — scope and data ownership

Baseline: PR #236 at `59354e883ed1312989fdb4487dc9daf5e119a9be`. Separate stacked candidate; no merge, stable promotion, tag, release or live operations.

## Safe Reset inventory (before implementation)

| Owner / source | Reset scope | Procedure |
|---|---|---|
| Builder project: rbCollectProject / rbApplyProject | sources, WG beans/profile modes/targets, options/DNS/REALITY, policy cards, tier cards, dialer, passthrough | capture canonical new-project defaults once after page initialization; restore through rbApplyProject |
| Profile UI: selectedProfile, effectiveProfile, profileSnapshots | all previous router/VPS snapshots | clear all snapshots after restoring router defaults; no profile history resurrection |
| WG upload: wgUploadSeq/Pending, wgRejected, wgFiles, wgBeans, wgProfileSeq | pending file reads, rejection reports, imported profiles and derived collections | invalidate read generation, clear models and synchronize collections |
| Subscription preview/list: subscriptionPreviewSeq, serverListLoadSeq/state, lastInspected*, lastPreviewSummary, subscriptionList*, subscriptionSelection | pending results, sources, exclusions and summaries | invalidate sequences, canonical clear/render procedures |
| Builder runtime import: rtImportSeq/Abort, runtimeProviderModel, serverListSource/NameOrigins, rtControllerMemory | pending requests, cached minimal nodes, controller credentials and raw paste | cancel import, clear models and controls |
| MagiTrickle: mtPending, mtMappingDraft, DOM preview/result | imported policies and pending mapping | clear model and preview; policy cards restored canonically |
| Builder output: mihomoValidationSeq, lastBuildFingerprint, lastRoutingDoc/HumanNames/MtuPlan, diagnosticActionSeq/PendingOut | YAML, validation, compatibility, Inspector/CDG/VRG/provider/coverage snapshots | invalidate all generations, dispose graph/navigation, clear output; NOT_BUILT |
| Builder load/restore: rbUndoProjectState, rbPendingRestore | old Undo and pending Studio→Builder admission | discard these snapshots; do not clear Studio editor or imported document |
| Builder physical lab: ptLastModel/UnavailableNodes, ptRuntimeProfiles/Evidence/Seq/Abort | project-specific model, credentials, evidence and artifacts | clearPhysicalTopology; no server writes |
| Site/device identity registry | persistent device IDs, selected identity and HWID | preserve registry and identity controls; no storage writes during Reset |
| Config Studio / WARP / site preferences | separate import/editor/undo workflows, WARP inputs, presentation preferences | preserve; Reset targets Builder only |

No Reset Undo: a partial snapshot would falsely promise recovery; sensitive full snapshots are not persisted. The confirmation asks the user to save first if needed. Cancel performs no mutation. Reset never fetches or automatically builds.

## Semantic boundaries

AWG policy and generator remain unchanged. RandomTrailers explanation is grounded in metacubex/amneziawg-go@0c1c6f40ecd7/device/send.go (random trailers added to handshake/transport messages). AWL diagram requires the actual flat GLOBAL fallback/filter/MATCH structure, never Builder checkbox alone. It creates explanatory UI only, no canonical groups/edges or remote provider members.

## v1.12 backlog

Separate guided physical-chain wizard: Add VPS → order → transport → final exit → artifacts. No additional transport support, automatic failover or SSH deployment in this task.

## Results by owner item

Terminology/discoverability changes are acceptance improvements, not claims of pre-existing runtime defects. Behavioral defects have baseline failure evidence.

| UX | Исходная проблема | Root cause | Реализация | Регрессия | Результат |
|---|---|---|---|---|---|
| 01 | Два сообщения keepalive | Engine note + UI policy описывают одно преобразование | Единый план, отдельно фактический YAML | UX19 range/integer/missing × ON/OFF | FIXED |
| 02 | Непонятный «Тест обрывов» | Нет объяснения границ | Описание до раскрытия и внутри, внешний warning | UX20 + awg-stability | FIXED |
| 03 | Три пустых группы | Default templates и терминология | Одна «Приоритет 1», явное добавление; saved names прежние | UX21 + tiered-failover | FIXED |
| 04 | Пустое поле отвергает примеры | Early return | Demo fallback, источник результата, подстановка | UX22 local/no Build + STALE | FIXED |
| 05 | Slider не достигает 900 | Clamp 0.85 × innerHeight | Диапазон 120–900, px отдельно, Expand сохранён | UX23 × Builder/Studio + UX03/11 | FIXED |
| 06 | Непонятна практическая цель лаборатории | Expert JSON — первая точка входа | Демо/анализ перед JSON, 5 шагов и границы | UX24 + physical/artifact suites | FIXED |
| 07 | REALITY спрятан | Нет прямого маршрута к полю | Quick Start link, раскрытие и фокус | UX25 + runtime/whitelist | FIXED |
| 08 | STALE не объясняет disabled export | Нет объяснения и действия | Текст и кнопка существующего Build | UX26 + viewport checks | FIXED |
| 09 | AWL edges одинаковы | Generic CDG uses edges | Доказанная схема выбора + полный CDG | UX27 Builder/Studio/no rewrite | FIXED |
| 10 | Disabled Tiered не свернуть | Plain DIV | Native details, N saved, read-only controls | UX28 view/collapse/unlock | FIXED |
| 11 | Нет нового проекта без reload | Нет canonical reset | Defaults через rbApplyProject, cleanup и поколения async | UX29 variants/cancel/late results/retention | FIXED |

## Validation and intentional differences

UX19–UX29 extend the registry; UX01–UX18 remain. YAML parity compares exact PR #236 baseline with existing HWID normalization. Default Tiered now starts with one empty card and requested names «Приоритет N». Existing saved names, internal group-generation rules and routing algorithms remain unchanged. Empty cards still fail validation; they are not silently dropped.

When the normal graph exceeds the window, pointer probes use its visible intersection. Escape preserves pan within the available normal scroll range; impossible offsets are clamped by the browser. Height and zoom have separate outputs/assertions.

Primary RandomTrailers source: [pinned amneziawg-go send.go](https://github.com/MetaCubeX/amneziawg-go/blob/0c1c6f40ecd7/device/send.go). Consumer policy remains copy-only; engine/runtime are untouched.

## Owner review and limits

Local final results: Owner Experience registry PASS (UX01–UX29); Chromium / Firefox / WebKit each 64/64; exact-baseline YAML parity 10/10; whitelist 266 matrix/baseline cases plus bypass/restoration guards; AWG 12/12; Tiered, Physical Topology browser (10), Config Studio browser (32), release journey (72 layout checks) and Help (16) PASS. Static/core/runtime suites PASS. The 15 added field scenarios fail against the unchanged baseline, while the old control case passes. CI run links and exact candidate SHA are supplied in the final handoff after publication.

Preview: http://127.0.0.1:34225/ serves this candidate checkout. PowerShell: `Start-Process 'http://127.0.0.1:34225/'`. To restart it from the candidate directory: `python -m http.server 34225 --bind 127.0.0.1` (keep that terminal open).

Review Reset ownership/discard of old Undo, one-card defaults and AWL explanatory view before integration. PR #236 remains unmerged. No stable/tag/release or live operations. Actual browser zoom 200%: NOT RUN; viewport checks are not zoom. No packet-path acceptance claimed.

## Short manual acceptance

1. Import AWG range; compare keepalive ON/OFF with actual YAML. Enable RandomTrailers experiment, close details and retain warning.
2. Tiered starts with one card; add/rename. Enable AWL: cancel then accept. Inspect/collapse saved groups; AWL OFF unlocks without auto-enable.
3. Build AWL, switch priorities/dependencies, repeat Parse in Studio. Empty Coverage uses demos; custom input uses only entered domains.
4. Move height to 900, scroll page, Fit/100%/Expand/Escape in both consumers. REALITY link focuses the field.
5. Change settings and explicitly Rebuild. Save a populated project; cancel Reset and compare, confirm and verify NOT_BUILT/disabled export. Studio/HWID remain. Build again.
6. Open physical demo, analyze, inspect route/artifacts and manual/external-contract limits.
