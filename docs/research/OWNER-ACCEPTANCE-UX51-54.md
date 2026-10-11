# Owner acceptance UX-51–54

Baseline: `36081f9c94cbff2f8a905e32ae809ca9eb9b2624` (main). Реестр UX-01–50 проверен, новые ID 51–54 добавлены без повторов.

## Исправления

- UX-51: все три действия YAML используют `isBuilderYamlReady()`. Защитная проверка handoff сохранена; обычный disabled-click не вызывает toast/Build.
- UX-53: Builder и Studio используют общие примеры. Пустой одиночный ввод — gemini.google.com, эффективный адрес виден отдельно. Поля/YAML не заполняются, сетевые проверки не выполняются.
- UX-52: отдельная операция `add-provider` в `csReplay`; HTTP(S) provider, проверка имени/URL/интервалов/цели/path/health-check. Нет изменения groups/use, загрузки подписки или перезаписи файла. Структурные aliases/неоднозначный YAML отклоняются. Undo/Reset/export используют существующий engine. URL скрыт при вводе и замаскирован в diff/диагностике.
- UX-54: canonical source `saymer-alt/web4core`, commit `fea3cede102ca69137975b31a20317a4c42e052b`: новый implicit default SHARED-DIALER. Явное WARP-DIALER сохранено. Миграция проекта v1 → v2 закрепляет историческое имя при пустом name и заполненных members/providers; targets/beans/passthrough не переименовывает. Пустая неактивная группа не создаётся. YAML миграции не подвергается.

## Воспроизведение baseline

Запустить candidate `tests/owner-ux-browser.cjs` с `OWNER_UX_FILTER=acceptance` и `OWNER_UX_ROOT`, указывающим на checkout baseline. Результат: UX-51/52/53 Studio/54 FAIL, UX-53 Builder PASS (существующая поддержка demos). Эти же сценарии проходят на candidate.

## Локальные проверки

- Chromium/Firefox/WebKit: Owner Gate 106/106 в каждом; GitHub exact-head результаты — в итоговом handoff.
- Config editor 47 групп; source-preserving roundtrip 10; Studio browser 32.
- AWL 266 + restoration/bypass guards; Tiered 18; chaos 21; security/stress browser 59.
- YAML parity: 10 незатронутых сценариев. Runtime с baseline: отдельная проверка intentional delta имени и byte parity явного исторического имени, в том числе provider-backed.
- Реальный Mihomo 1.19.31/1.19.32: по 13 сценариев Studio export/dialer. Несколько WG/AWG, статическая/provider-backed группа, оба имени. `-t` не доказывает handshake/доступность серверов.
- Source: 74 exclude-filter/TUN/dialer/priority tests; Amnezia 12; npm ci/build/runtime syntax/consumer tests. Runtime скопирован после штатной сборки; SHA-256 `fcc74ab1972c1b2a07633d98e7feee8464fce6c1f026ecc0326cacddaa581cc0` (локальные bytes).
- Viewports: 1280×720, 1366×768, 1920×1080, 390×850, 320×850; keyboard, disabled, overflow и сохранение Studio проверяются Owner Gate. Скриншоты формы визуально проверены на desktop/320 px.
- Native browser zoom 200%: NOT RUN (native UI automation недоступна в этой сессии).

Схема provider подтверждена [Mihomo 1.19.31](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/adapter/provider/parser.go) и [1.19.32](https://github.com/MetaCubeX/mihomo/blob/v1.19.32/adapter/provider/parser.go): expected-status поддерживается, path необязателен.

## Границы интеграции

Один consumer PR в main. Candidate source опубликован отдельно; production provenance требует его интеграции в web4core:link-generators, затем удаления временного `.github/web4core-source-ref`. Эта проверка не ослабляется. Merge consumer, main/stable, теги и релизы требуют отдельного Owner GO.
