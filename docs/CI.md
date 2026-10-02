# CI — автоматические regression gates

Этот документ разделяет детерминированные проверки, которые обязан выполнять GitHub Actions, и полевые проверки, которые намеренно остаются ручными.

Цель — не повторять одну и ту же тестовую батарею агентом/локально после каждого косметического изменения. Успешный CI относится только к **точному commit SHA**, на котором он был запущен.

## Generator CI

Workflow: `.github/workflows/generator-ci.yml`.

Запускается на:

- Pull Request в `main` и `stable`;
- push в `main` и `stable`;
- ручной `workflow_dispatch`.

### `deterministic / static + node`

Проверяет:

- `.nojekyll` и отсутствие package/build-system в корне;
- отсутствие merge markers;
- синтаксис всех `tests/*.cjs`, включая manual-файлы только как syntax check;
- HTML duplicate IDs и контракт публичных ссылок (`index.html`, `quick-start.html`);
- consumer runtime regression (`tests/runtime.cjs`);
- Domain Policy Routing regression (`tests/policy-routing.cjs`);
- offline unit tests `tools/warp-dialer-fieldtest`;
- secret scan fieldtest harness;
- запрет запуска live/mutating fieldtest modes из GitHub Actions.

### `deterministic / browser`

Playwright и `js-yaml` ставятся только во временную директорию GitHub runner. Репозиторий остаётся статическим и не получает `package.json`.

Проверяются:

- `tests/browser.cjs`;
- `tests/help-ux-browser.cjs`;
- `tests/masque-dpi-regression.cjs`;
- `tests/policy-routing-browser.cjs`;
- `tests/vps-detection-browser.cjs`;
- `tests/wg-profiles-browser.cjs`;
- `tests/whitelist.cjs`.

### `mihomo compat / 1.19.31` и `mihomo compat / 1.19.32`

GitHub Actions скачивает exact pinned official Mihomo binary, проверяет SHA-256 и запускает:

- Auto-Whitelist browser/build regression с реальным Mihomo core;
- `tests/mihomo-failover.cjs`;
- `tests/mihomo-awl-priority.cjs`.

Compatibility versions соответствуют продуктовому контракту проекта:

- minimum supported: `1.19.31`;
- recommended/current tested: `1.19.32`.

## Runtime provenance

Отдельный существующий workflow `.github/workflows/update-web4core-runtime.yml` остаётся источником проверки provenance:

- checkout `saymer-alt/web4core:link-generators`;
- source tests web4core;
- reproducible runtime build;
- consumer `tests/runtime.cjs`;
- tracked-runtime match для PR/stable.

Generator CI не заменяет provenance workflow, а дополняет его.

## Что НЕ запускается в CI

Следующие проверки намеренно остаются manual/live:

- `tests/mihomo-reality-handshake.manual.cjs` — реальный Xray/REALITY/OpenSSL E2E;
- `tests/mihomo-awl-soak.manual.cjs` — длительный production-interval soak;
- реальные `fieldtest.mjs sweep/switchtest/mtusweep`;
- реальные WG/AWG keys/configs владельца;
- реальные subscription URL/token/HWID/UUID;
- реальные provider/WARP/network acceptance tests.

Причины: секреты, внешняя сеть, mutable/live инфраструктура и флаки, не связанные с детерминированной корректностью генератора.

## Правило для AI-агентов

Если exact проверяемый commit SHA уже имеет зелёные соответствующие Generator CI checks и зелёный runtime-provenance check, эти детерминированные suites **не нужно повторно гонять вручную**.

Повторный локальный запуск нужен только когда:

1. изменён сам тест или workflow и требуется отладка;
2. CI красный/недоступен и нужно найти причину;
3. изменён live/network contract, для которого нужен manual acceptance;
4. owner явно запросил повторную полевую проверку.

Green run другого SHA не переносится на текущий SHA.

Перед merge/release агент должен сверять именно checks текущего audited head / production candidate, а не просто ссылаться на старый зелёный прогон.
