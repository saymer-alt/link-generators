# Synthetic fieldtest runner

Полностью локальная приёмка v1.11. Владельческие файлы не читаются. Все WG/AWG keys — детерминированные публичные synthetic values (seed `v111-field-20261009`, SHA256, 32 байта); это проверка parse/generation, не handshake. Endpoint TEST-NET, subscriptions/health fixture URLs example.invalid. Дефолтные URL самого генератора не запрашиваются.

## Локальная лаборатория

1. Добавить `/fieldtest-private/` в `.git/info/exclude`.
2. `node tools/synthetic-fieldtest/generate.cjs` создаёт manifest, parameters и 8 смешанных WG/AWG profiles.
3. Установить `NODE_PATH` на transient dependencies Playwright1.55/js-yaml4.1, `JS_YAML_PATH` на js-yaml.min.js; `BROWSER_CHANNEL=msedge` на Windows либо chromium в CI.
4. Установить `FIELDTEST_LAB_DIR` на абсолютный путь локального fieldtest-private; опционально `MIHOMO_BIN` на pinned binary1.19.31/32. Запустить `node tests/field-acceptance-browser.cjs`.
5. Результаты: results/results.json, configs/projects: generated/, rejected inputs: fixtures/invalid/. Не коммитить эти файлы. Перед коммитом `git status --short` и `git check-ignore fieldtest-private/manifest.json`.

Без FIELDTEST_LAB_DIR runner использует отдельный временный каталог и удаляет его после запуска. TEST_OUTPUT_DIR дополнительно получает обезличенный JSON результатов. CI выполняет suite в browser и обеих Mihomo matrix jobs; без MIHOMO_BIN parse checks честно отсутствуют. Subscriptions подменены in-memory fetchSubscription stub; остальные HTTP(S) запросы заблокированы и считаются ошибкой. Это не проверка реального CORS/worker/network.

## Что измеряется

29 positive Builder scenarios +20 negatives. Каждый positive: настоящий Build, WG/AWG UI upload, Save download, новая browser context, Load Cancel/Confirm, полное равенство project fields, repeated Build, Undo; YAML Parse/Preview/Cancel и loss-aware Confirm там, где допустимо. Изменения sources/WG/dialer/TUN/DNS/WebUI и preservation остальных fields проверяются после Project и поддерживаемого Reverse. Для AWL missing fallback применение с выдуманным URL не выполняется; для CONFLICT кнопка Apply заблокирована.

Контролируемая случайность: synthetic keys/inputs фиксированы seed; browser HWID остаётся случайным штатным полем. Byte parity нормализует только hex HWID строки; результаты JSON/логи не содержат ключей или полных YAML. Hash comparisons не печатают project/secret values при ошибке.

Полный сценарий 6+8 →8+7, stale/fault/rapid-action guards и secret editing дополнительно выполняются existing suites qa-reverse-integration, independent-product-browser, independent-boundaries-browser, cs20-ux-browser. Основная suite не выдаёт UNKNOWN/UNSUPPORTED Reverse за parity и не обходит guards.

## Финальная браузерная матрица

Установите браузеры Playwright во внешний cache и зависимости во внешний test runtime (production package.json не нужен). Задайте NODE_PATH, JS_YAML_PATH и PLAYWRIGHT_BROWSERS_PATH. Выполните:

```powershell
node tools/synthetic-fieldtest/browser-matrix.cjs
# Для синхронизированного кандидата с тем же harness:
$env:AUDIT_ROOT = (Resolve-Path ../v111-final-candidate).Path
node tools/synthetic-fieldtest/browser-matrix.cjs fieldtest-private/results/browser-candidate
```

Chromium, Edge, Firefox и WebKit запускаются независимо. Результаты содержат фактическую версию и PASS/FAIL/NOT RUN; проекты фикстур временные, output содержит только metadata/logs. Настоящие клики проверяют 6+8 →8+7, Save/reload/Load Cancel/Confirm, изменения, Studio, Reverse Cancel/Confirm/Undo и 6 разделов на 12 ширинах. Keyboard и 24px targets — отдельные проверки, не полный accessibility audit. DNS проверяется, если target checkout содержит #207. Не публиковать fieldtest-private и не использовать секреты владельца как фикстуры.