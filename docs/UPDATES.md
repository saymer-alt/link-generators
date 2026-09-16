# UPDATES — жизненный цикл `web4core.runtime.js`

## Источник и воспроизводимость

Карта двух репозиториев и выбор слоя изменения — [WEB4CORE-FORK.md](WEB4CORE-FORK.md).

```text
spatiumstas/web4core:main
→ controlled sync с review и тестами
→ saymer-alt/web4core:link-generators (source-level extensions)
→ npm ci → npm run build:web:runtime
→ src/web4core.runtime.js → проверки → link-generators/web4core.runtime.js
```

`saymer-alt/web4core` — настоящий GitHub fork `spatiumstas/web4core`.
Ветка `main` следует upstream; расширения находятся только в `link-generators`.
MIPS реализован в `src/build.js` (`buildFromRequest`) и `src/core/yaml.js`
(`buildMihomoYaml`, включая вложенный builder listeners). Только точное `mips`
включает MIPS, остальные значения дают `gvisor`. Sing-box/xray не затронуты.

Textual bundle patch удалён: `web4core.runtime.js` никогда не редактируется вручную.
Разрешён только результат штатной сборки fork после проверок. При первоначальном
переносе runtime побайтово совпал с runtime из commit `6b3368e` (см. [TESTING.md](TESTING.md)).
Приложение не имеет package.json/npm dependencies/build step и работает с `file://`;
Node/npm нужны для сборки отдельного source-репозитория и проверок.

Экспорт рантайма — один объект `globalThis.web4core` (18 функций): `buildBeansFromInput`,
`validateBean`, `computeTag`, `getAllowedCoreProtocols`, `URLTEST`, `URLTEST_CHOICES`,
`buildSingBoxOutbound`, `buildSingBoxConfig`, `buildXrayOutbound`, `buildXrayConfig`,
`buildMihomoProxy`, `buildMihomoConfig`, `buildMihomoPriorityConfig`, `buildMihomoSubscriptionConfig`, `buildMihomoYaml`,
`parseWireGuardConf`, `fetchSubscription`, `buildFromRequest`. Страница использует
`buildFromRequest`, `parseWireGuardConf`, `URLTEST_CHOICES` (см. [ARCHITECTURE.md](ARCHITECTURE.md)).

## Workflow автообновления

`.github/workflows/update-web4core-runtime.yml`: push в `main`, cron `17 4 * * 1`,
ручной dispatch. Обновления из проверенной custom branch остаются автоматическими.

1. `build-runtime`, `contents: read`, свежий GitHub-hosted runner, `timeout-minutes: 15`:
   - checkout consumer и `saymer-alt/web4core@link-generators`, оба без сохранения credentials;
   - записать source SHA в лог; Node 22, `npm ci`;
   - `npm run build:worker` — workers/api bundle (gitignored) нужен amnezia-тестам;
   - `node --test tools/tests/*.test.mjs` — автообнаружение всех unit-тестов
     (новый test file подхватывается без правки workflow);
   - штатный build runtime; `node --check`, `node tests/runtime.cjs` на собранном
     файле, SHA-256 в лог;
   - upload единственного runtime artifact текущего run (срок хранения 7 дней).
2. `update-runtime`, отдельный свежий runner, `contents: write`, `timeout-minutes: 10`,
   только для `main`:
   - checkout проверенного consumer SHA, download artifact текущего run;
   - если `origin/main` уже изменился — отказ, нужен повторный запуск;
   - проверить наличие обычного непустого файла, `cmp`, при отличии copy;
   - stage только `web4core.runtime.js`, commit «Update web4core runtime from upstream»;
   - обычный `git push origin HEAD:main`, без force. Конкурентный push отклоняется Git.

В write-job не выполняются npm, source tests или сам artifact. Кэш сборки не переносится
в него. Ошибка build/test прерывает цепочку; publish зависит от успешного build-job.
Workflow runs сериализованы. При одинаковом runtime bot commit не создаётся.
После bot commit проверить страницу, особенно allow-lan и валидатор.

Разделение jobs ограничивает доступ внешнего build-кода к write-token, но не доказывает
безопасность его результата: runtime будет выполняться в браузере пользователей.
Поэтому upstream/package-lock/build scripts требуют review до попадания в custom branch.
Actions пока используют доверенные major tags `@v4`; pin полных SHA и branch protection
с обязательным review — рекомендуемое последующее усиление, здесь настройки не менялись.
Основание: [GitHub: secure use](https://docs.github.com/en/actions/reference/security/secure-use).

## Upstream sync: выбран controlled merge

| Вариант | Свойства | Решение |
|---|---|---|
| Ручной controlled sync | Review исходников и зависимостей до build; конфликты/тесты блокируют публикацию | Основной вариант |
| Scheduled merge + push | Может автоматически внести нежелательный код при зелёных тестах; нужны отдельные права и review | Сейчас не внедрять |
| GitHub fork sync main + merge custom | Удобно обновляет зеркало main, но не переносит изменения в custom branch и не проверяет MIPS | Дополнение к controlled merge |

Не реже еженедельно сопровождающий проверяет upstream (например, перед понедельничным
consumer cron). Это ручная обязанность: consumer cron сам upstream не сливает.
Не синхронизировать custom branch кнопкой с удалением её собственных коммитов.

Процедура (команды выполняются только в чистом checkout fork после отдельного разрешения
на публикацию; ниже инструкция, не автоматически выполняемый сценарий):

```bash
git fetch upstream main
git fetch origin main link-generators
git switch main
git merge --ff-only upstream/main
# обновление зеркала main разрешено только fast-forward; при расхождении остановиться
git switch -c sync/upstream-YYYY-MM-DD origin/link-generators
git merge --no-commit --no-ff upstream/main
# при конфликте STOP; git merge --abort, никаких push
# review: source, package.json, lockfile, build scripts, workflows, лицензии
npm ci
node --test tools/tests/mihomo-exclude-filter.test.mjs tools/tests/mihomo-tun-stack.test.mjs
npm run build:web:runtime
npm run test:amnezia
node --check src/web4core.runtime.js
node ../link-generators/tests/runtime.cjs src/web4core.runtime.js
git diff --check
# затем browser baseline и реальные Mihomo -t, см. TESTING.md
# только после успеха: commit candidate, push candidate и PR → link-generators
# review и обычный merge PR; ни reset custom branch, ни force-push
```

Все команды — шаги с проверкой exit code, не цепочка для слепого запуска.
При test failure ничего не публиковать. Если upstream уже содержит совместимую MIPS
реализацию — отдельно проверить контракт и удалить дублирование source-изменений.

Возможная будущая автоматика: scheduled read-only job fetch/compare → сообщение о новом
upstream SHA; отдельный candidate build/test job без write-token; создание review PR
доверенным job без выполнения upstream-кода. Merge в custom branch остаётся ручным.
Такой workflow стоит вводить отдельной задачей после выбора PR permissions и protections;
в этой миграции его нет. Автоматический upstream merge/rebase/push не включён.

## Порядок публикации миграции

Сначала review, commit и push source-изменений в `saymer-alt/web4core:link-generators`.
Проверить сборку опубликованного SHA. Затем публиковать миграцию consumer workflow.
Пока в удалённой custom branch нет source-изменений и MIPS test, новый workflow
завершится ошибкой — это ожидаемый fail-closed барьер, не повод пропускать тест.

## Если нужна новая функция или фикс поведения

- Wrapper в `index.html` подходит для адаптации входа/выхода: allow-lan,
  `normalizeWgText`, `normalizeWgBeans`, `injectWgDns` (обязательно `lineWidth: -1`).
- Изменение парсинга/эмиссии — в исходниках fork с тестами и review, в отдельном
  согласованном scope. Общие исправления желательно отправлять upstream PR;
  после upstream merge требуется controlled sync custom branch.
- Bundle руками не править и textual patch заново не вводить.
- Создание fork не разрешает добавлять новые протоколы без отдельной задачи.

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
