# Owner Acceptance Round 2 — 13 UX Findings

База: PR #238 `7062b15a38875fa15b744fab666dff456143085a`. Дата: 2026-10-10.
Один stacked PR поверх `feat/owner-field-polish`; merge и release не входят в задачу.
Exact candidate SHA, ссылки CI и результаты immutable head фиксируются в итоговом
handoff после push. Этот документ описывает scope и воспроизводимые доказательства.

## Таблица приёмки

| Пункт | Причина | Исправление | Тест | Статус |
|---|---|---|---|---|
| 1. Reset | Native confirm не описывал retention и default choice | Accessible dialog, cancel default, Escape/focus trap, Save; одна canonical cleanup | UX30 + UX29 cancel/reset/races/retention | FIXED |
| 2. К YAML | Ссылка не воспринималась как действие | Настоящая кнопка, раскрытие/прокрутка/фокус без Build | UX31 empty/current/stale, YAML+seq invariant | FIXED |
| 3. Coverage | Лишняя кнопка подстановки | Кнопка/handler удалены; пустое поле — demo, введённое — только user domains | UX32, source label/no mutation | FIXED |
| 4. PT steps | Недостаточный локальный отступ ol | Public UI удалён; internal list padding 28px | UX33 + UX42 | FIXED (UI) |
| 5. PT generation | Смешивались manifest/config/contracts и уровни evidence; lab inputs влияли на Builder freshness | Product Review с artifact/status/runbook; lab subtree исключён из fingerprint/events | UX34, per-node-generation, pt-runtime-evidence | FIXED (explanation/UI); недостающие transports/live acceptance DEFERRED |
| 6. Fullscreen graph | Внутри fullscreen отсутствовал доступ к focus/search | Общая canonical focus model, sidebar/search/categories/reset/indicator; collapse focus return, scale/scroll сохранены; Fit центрирует | UX35 Builder+Studio, UX03/11 navigation/pan/privacy/mobile | FIXED |
| 7. MagiTrickle | SELECT destination и независимость категорий неясны; имена правились после импорта | Явные labels, per-category editable preview names, atomic admission до replace, AWL GLOBAL/DIRECT | UX36 duplicate/empty/reserved/existing/replace/roundtrip/rules/AWL; magitrickle-import | FIXED; category merge не поддерживается |
| 8. WG/AWG | Технический отчёт занимал карточку | Compact controls и endpoint; technical details с сохранением open; warnings снаружи | UX37 WG/legacy/modern + UX19/20 keepalive/RandomTrailers + wg suites | FIXED |
| 9. Tiered add | После подтверждённого select требовался второй клик; registry зависел от наличия WG | Change сразу добавляет, reset select, dedup, ↑/↓/×; common registry доступен без WG | UX38 + tiered-failover validation/guards/old-project tests | FIXED |
| 10. Terminology | English/эшелоны/повтор номера в UI | Приоритетные группы серверов, plural forms, readable strategies; redaction прежде cosmetics | UX39 + P2 secret regression; Tiered YAML parity | FIXED |
| 11. Inspector | `lastRoutingDoc` и summary обновлялись, `rdResult` сохранял результат предыдущего Build | Новый Build очищает rdResult/effective input/Coverage; probe читает финальный doc | UX40 normal/Tiered/DPR+Tiered/AWL/fallback/STALE/Studio | FIXED; runtime member не определяется офлайн |
| 12. Проверка YAML | Неочевидный переход к результатам | Настоящая keyboard button и отдельная Studio action, без Build | UX41 + UX31 | FIXED |
| 13. Public PT | Не нужен в текущей owner workflow, отдельная experimental model усложняла основной GUI | Удалены nav/catalog/help entry points; hidden+inert OFF gate; code/model/tests сохранены | UX42 public absence, 4 areas, viewports, no page errors; internal PT suites | FIXED (product removal), algorithm expansion DEFERRED |

## Причина Inspector: воспроизведение

На exact #238: обычный Build → Inspector неизвестного домена → `MATCH → GLOBAL`;
включить заполненную Tiered карточку → Build. Summary уже описывает корневую
Tiered группу, но `rdResult` сохраняет прежний `MATCH → GLOBAL`, пока пользователь
не запустит probe снова. Ошибка находится в жизненном цикле отображения, не в
выборе YAML target. Исправление очищает старый результат после принятия нового
финального документа. Исходная маршрутизация и `MATCH,🪜 TIERED-AUTO` сохраняются.

## Baseline / candidate

Новые UX30–42 дают 14 checks (UX35 выполняется для обоих consumers). Запуск
той же suite с `OWNER_UX_ROOT` на exact #238 дал 0 PASS / 14 FAIL.
Первый candidate дал 14 PASS / 0 FAIL в Chromium; затем усилены keyboard,
Fit, legacy AWG и atomic replace проверки, добавлен focus return для WebKit.
Полные конечные результаты трёх браузеров публикуются в handoff/CI.

Baseline FAIL для требований убрать кнопку/публичный модуль означает отсутствие
новой продуктовой приёмки в старом UI, а не доказанный прежний алгоритмический
дефект. UX04/05 решены удалением публичной функции, локальным internal spacing,
freshness fix и документацией; WARP compiler/physical failover не реализованы.

## Проверки и границы

- Owner Experience registry UX01–29 сохранён; добавлены UX30–42. Gate проверяет регистрацию, фактические результаты — browser jobs.
- Owner viewports: 1280×720, 1366×768, 1920×1080, 390 и 320 px; release journey дополнительно проверяет 12 ширин.
- UI-only YAML parity против #238: default/WG/AWL/Tiered/advanced; нормализуется HWID и существующие узкие contract deltas suite, не произвольные различия.
- AWL baseline: 266 matrix/baseline cases с `BASELINE_REF=7062b15a38875fa15b744fab666dff456143085a`.
- Runtime file SHA-256: `eff176358a2fea08e921c58d7551f05b7f4e3aeac859d79c361864494c22b58b`, байты runtime не менялись.
- PT-CORE/PT-GEN/PT-RUNTIME/PT-DIAG совпадают с базой побайтно. 22/18/18/20 pure groups соответственно; internal browser coverage сохранено.
- Реальные Mihomo 1.19.31/1.19.32, static/node/browser/runtime provenance проверяются существующими read-only CI jobs. READY parse не считается field acceptance.
- NOT RUN: native browser zoom 200% (CSS zoom/viewport не выдаются за него); live VPS/Keenetic, реальные subscriptions/credentials, packet path/UDP/DNS/MTU/recovery acceptance.

## Локальное воспроизведение

Внешние test dependencies, не зависимости приложения: Playwright 1.55.0 и js-yaml 4.1.0.

```powershell
$env:NODE_PATH = (Resolve-Path '..\testdeps\node_modules').Path
$env:JS_YAML_PATH = (Resolve-Path '..\testdeps\node_modules\js-yaml\dist\js-yaml.min.js').Path
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path '..\browser-cache').Path
$env:BROWSER_CHANNEL = 'chromium'
python tools/owner-experience-gate.py
foreach ($engine in 'chromium','firefox','webkit') {
  $env:OWNER_UX_BROWSER = $engine
  node tests/owner-ux-browser.cjs
}
$env:BASELINE_REF = '7062b15a38875fa15b744fab666dff456143085a'
node tests/whitelist.cjs
node tests/parity.cjs ..\owner-field-polish .
```

Для baseline новых checks: `OWNER_UX_ROOT` указывает на checkout #238,
`OWNER_UX_FILTER=' R2 '`. Для полного candidate удалить эти env-переменные.

## Manual acceptance

1. Reset: прочитать retention; Escape/«Нет, оставить»; Save; затем подтвердить очищение. Studio/device registry сохранены.
2. Кнопками перейти к YAML и проверке; убедиться, что Build не запускается.
3. Coverage: пустое поле и свой домен; источник виден, подстановки нет.
4. Graph Builder/Studio: fullscreen → поиск/фокус → масштаб/панель/Fit → Escape; 320 px.
5. MagiTrickle: две категории SELECT, разные имена, invalid replace, успешный import, Save/Load.
6. WG/AWG: controls/endpoint/warnings видны, «Подробнее» раскрывается и сохраняет состояние.
7. Tiered: выбор сразу добавляет, повтор не дублирует; стрелки/удаление; readable labels.
8. Inspector: normal probe → Tiered Build → старый probe очищен; повтор соответствует YAML. Затем STALE.
9. Нет Physical Topology, JSON/demo/runtime/artifacts или пустой лаборатории в публичном GUI.

## Physical Topology: продуктовый итог

[Полный Product Review](PHYSICAL-TOPOLOGY-PRODUCT-REVIEW.md) содержит историю
#149/#177/#187/#188, PR/commit evidence, схему Москва→Эстония→Швеция→WARP,
назначение artifacts, пределы наблюдений и стоимость сопровождения. Решение:
сохранить в резерве. Возврат только после новой практической задачи и Owner GO;
автоматического мастера v1.12 нет. Скрытие UI не выдано за изменение алгоритма.
