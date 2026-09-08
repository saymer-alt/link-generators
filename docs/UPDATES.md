# UPDATES — жизненный цикл `web4core.runtime.js`

Как рантайм появляется, обновляется и почему его нельзя править руками. Workflow —
`.github/workflows/update-web4core-runtime.yml` (факты из файла, commit `f5ea0a3`).

## Откуда берётся рантайм

`web4core.runtime.js` — готовый IIFE-бандл (~4380 строк) сборки апстрим-проекта
**https://github.com/spatiumstas/web4core** (ветка `main`). Апстрим собирает его сам:
Node 22 → `npm ci && npm run build:web:runtime` → артефакт `src/web4core.runtime.js`.
В этом репо НЕТ ни npm, ни сборки — файл коммитится как есть, поэтому страница работает
без билд-шага.

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
3. `cmp` свежего `src/web4core.runtime.js` с локальным;
4. если отличаются — копия поверх, коммит **прямо в `main`** от `github-actions[bot]`
   с сообщением «Update web4core runtime from upstream» и push.

Триггеры: **каждый push в `main`**, еженедельный cron `17 4 * * 1`, ручной dispatch.

Следствия:

- любой твой пуш запускает workflow (если рантайм не изменился — без коммита);
- вскоре после пуша может прилететь бот-коммит, меняющий только `web4core.runtime.js` —
  это нормально; не откатывать, не «чинить»;
- обновление меняет поведение парсинга/сборки **без изменения `index.html`** — после
  бот-коммита стоит перепроверить страницу (в первую очередь allow-lan патч и валидатор).

## Почему руками не редактировать

Любая локальная правка будет молча перезаписана ближайшим автообновлением, которое
перепишет файл целиком из апстрима. Не существует механизма «наш патч поверх рантайма» в
самом файле.

## Если нужна новая функция или фикс поведения

Два пути, по возрастанию стоимости:

1. **Локальный wrapper в `index.html`** — трансформация входа до вызова рантайма или
   пост-обработка его результата. Так работают все текущие адаптации:
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
   в значении `on` молча теряются при парсинге .conf; отсутствие `dns`-эмиссии для
   wireguard (закрыто локальным wrapper'ом, но чище — в апстриме).

Категорически нельзя: форкать рантайм внутри этого репо, коммитить отредактированный
`web4core.runtime.js`, «временно» править его в ветке.

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
