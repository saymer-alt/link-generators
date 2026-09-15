# UPDATES — жизненный цикл `web4core.runtime.js`

## Исключение: воспроизводимый MIPS TUN patch (2026-09-15)

По запросу владельца добавлен runtime-контракт `options.mihomoTunStack`.
`scripts/patch-mihomo-tun.cjs` делает четыре строго ограниченные замены в чистом
upstream-бандле: нормализация stack, два места эмиссии, передача опции.
Это единственное утверждённое исключение; вручную runtime не править.

```bash
node scripts/patch-mihomo-tun.cjs path/to/unpatched/web4core.runtime.js
node --check path/to/unpatched/web4core.runtime.js
node tests/runtime.cjs path/to/unpatched/web4core.runtime.js
```

Workflow делает эти шаги после сборки upstream и **до** compare/copy/commit.
Скрипт требует ровно одно совпадение каждого участка, сохраняет переводы строк,
записывает результат только после успеха всех замен. При дрейфе или повторном
применении — ошибка без записи и публикации. Если upstream сам добавит поддержку,
нужен review API и удаление/адаптация патча, а не обход проверки.
Приложение по-прежнему работает с `file://`, сборка и новые browser-зависимости ему
не нужны. Regression tests используют Node; браузерный тест — внешнюю установку Playwright.

Как рантайм появляется, обновляется и почему его нельзя править руками. Workflow —
`.github/workflows/update-web4core-runtime.yml` (с maintained MIPS patch, 2026-09-15).

## Откуда берётся рантайм

`web4core.runtime.js` — готовый IIFE-бандл (~4380 строк) сборки апстрим-проекта
**https://github.com/spatiumstas/web4core** (ветка `main`). Апстрим собирает его сам:
Node 22 → `npm ci && npm run build:web:runtime` → артефакт `src/web4core.runtime.js`.
Затем `scripts/patch-mihomo-tun.cjs` строго воспроизводимо адаптирует бандл для MIPS;
после проверки синтаксиса и runtime regression test он сравнивается с локальным файлом.
При отличии коммитится готовый **vendored patched runtime**. Само приложение по-прежнему
не имеет package.json/npm-зависимостей и не требует сборки для запуска.

Экспорт рантайма — один объект `globalThis.web4core` (17 функций): `buildBeansFromInput`,
`validateBean`, `computeTag`, `getAllowedCoreProtocols`, `URLTEST`, `URLTEST_CHOICES`,
`buildSingBoxOutbound`, `buildSingBoxConfig`, `buildXrayOutbound`, `buildXrayConfig`,
`buildMihomoProxy`, `buildMihomoConfig`, `buildMihomoSubscriptionConfig`, `buildMihomoYaml`,
`parseWireGuardConf`, `fetchSubscription`, `buildFromRequest`. Страница использует
`buildFromRequest`, `parseWireGuardConf`, `URLTEST_CHOICES` (см. [ARCHITECTURE.md](ARCHITECTURE.md)).

## Workflow автообновления

`.github/workflows/update-web4core-runtime.yml`, права `contents: write`:

1. чекаут этого репо + чекаут апстрима `spatiumstas/web4core@main`;
2. Node 22 → `npm ci && npm run build:web:runtime` (в каталоге апстрима);
3. `node scripts/patch-mihomo-tun.cjs web4core-upstream/src/web4core.runtime.js`;
4. `node --check web4core-upstream/src/web4core.runtime.js`;
5. `node tests/runtime.cjs web4core-upstream/src/web4core.runtime.js`;
6. `cmp` адаптированного `src/web4core.runtime.js` с локальным;
7. если отличаются — копия поверх, коммит **прямо в `main`** от `github-actions[bot]`
   с сообщением «Update web4core runtime from upstream» и push.

Триггеры: **каждый push в `main`**, еженедельный cron `17 4 * * 1`, ручной dispatch.

Следствия:

- любой твой пуш запускает workflow (если рантайм не изменился — без коммита);
- вскоре после пуша может прилететь бот-коммит, меняющий только `web4core.runtime.js` —
  это нормально; не откатывать, не «чинить»;
- обновление меняет поведение парсинга/сборки **без изменения `index.html`** — после
  бот-коммита стоит перепроверить страницу (в первую очередь allow-lan патч и валидатор).

## Почему руками не редактировать

Ручная правка бандла будет перезаписана автообновлением: файл целиком заменяется
результатом upstream build + maintained MIPS patch. Механизм локальной адаптации —
отдельный `scripts/patch-mihomo-tun.cjs`, а не ручные изменения внутри бандла.
Разрешено только это утверждённое исключение; при дрейфе апстрима скрипт останавливает
обновление до записи/публикации, обходить проверку нельзя.

## Если нужна новая функция или фикс поведения

Для новых изменений общее правило — два пути ниже. Уже утверждённый maintained MIPS
patch — единственное исключение, не разрешение расширять локальную адаптацию произвольно.

1. **Локальный wrapper в `index.html`** — трансформация входа до вызова рантайма или
   пост-обработка его результата. Так работают адаптации страницы:
   - allow-lan регэксп-патч (правка готового YAML);
   - `normalizeWgText` (правка текста .conf до парсинга);
   - `normalizeWgBeans` (правка beans между парсингом и сборкой);
   - `injectWgDns` (правка YAML после сборки: jsyaml.load → правка → jsyaml.dump
     `{ lineWidth: -1 }` — параметр обязателен, иначе переносятся длинные base64-строки AWG).
   Критерий применимости: желаемое выражается трансформацией входа/выхода, без правки
   внутренностей парсера/эмиссии.
2. **PR в апстрим `spatiumstas/web4core`** — если менять надо сам парсинг/эмиссию. После
   мержа рантайм обновится автоматически ближайшим запуском workflow. Известные
   апстрим-проблемы, ожидающие именно такого решения: булевы `random-trailers`/`disable-cookies`
   в значении `on`/`off` (официальный формат литералов AWG 3.1) молча теряются при парсинге
   .conf — с 2026-09-09 компенсируются локально в `normalizeWgText`, но чистый фикс —
   в апстриме; отсутствие `dns`-эмиссии для wireguard (закрыто локальным wrapper'ом,
   но чище — в апстриме).

Категорически нельзя: форкать рантайм внутри этого репо, коммитить вручную
отредактированный `web4core.runtime.js`, «временно» править его в ветке.
Допустим только артефакт upstream build с точно воспроизводимым maintained MIPS patch
после проверок выше; любые другие изменения требуют отдельного решения владельца.

## Связь с index.html и что проверять после обновления

Рантайм — единственный generated-файл; `index.html` (единственная страница приложения)
зависит от него только через публичный API `globalThis.web4core`. Контракты, привязанные
к поведению рантайма, которые надо перепроверять после автообновления:

- **allow-lan патч** — регэксп по текстовому формату YAML; смена формата сломает замену
  молча (строка просто не найдётся, `allow-lan` останется `false`);
- **`injectWgDns`** — ищет `proxies[]` с `type: wireguard` в собранном YAML;
- **enum-списки валидатора** (`MIHOMO_PROXY_TYPES`, `MIHOMO_GROUP_TYPES`, server-based
  набор) — сверять с актуальными исходниками mihomo целевой версии; новые типы из
  web4core/mihomo могут потребовать расширения списков (см. [VALIDATION.md](VALIDATION.md));
- дефолты `buildFromRequest` для mihomo (`webUI=true, addSocks=true, addTun=false`) и
  тексты ошибок («Mihomo: enable at least one inbound…») — используются страницей напрямую.

Проверка после любого обновления — [DEVELOPMENT.md](DEVELOPMENT.md) и [TESTING.md](TESTING.md).
