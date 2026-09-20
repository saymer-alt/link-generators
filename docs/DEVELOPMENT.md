# DEVELOPMENT — как разрабатывать и проверять

## Primary/fallback

Дополнительно к командам ниже запускать

```bash
node --test tools/tests/mihomo-priority.test.mjs # в fork
node tests/mihomo-failover.cjs # MIHOMO_BIN + JS_YAML_PATH + TEST_OUTPUT_DIR
node tests/whitelist.cjs # в consumer, окружение Playwright как для browser.cjs
```

Контракт — [AUTO-WHITELIST.md](AUTO-WHITELIST.md). Сначала публикуется source fork
с новым тестом/API, затем consumer; до этого commit/push требует решения владельца.


Практическая инструкция для разработчика/агента. Полный контракт — [AGENTS.md](../AGENTS.md);
здесь — рабочий процесс. Команды ниже используют Node.js для проверок и Python через
`py` для необязательного static server; само приложение не требует npm или сборки.

## Локальный запуск

Сборки нет — репо открывается как статика:

```bash
cd link-generators
py -m http.server 8017 --bind 127.0.0.1     # или любой static server
# открыть http://127.0.0.1:8017/index.html
```

Работает и `file://`-открытие `index.html` напрямую (скрипты классические, не модули);
нужен интернет только для `js-yaml` с jsdelivr CDN. Если `globalThis.web4core` не
загрузился, Builder покажет «web4core.runtime не загружен» — это диагностика, а не баг.

## Как менять код

- Основной файл приложения — `index.html` (handwritten, inline JS/CSS, секции
  `// === … ===`); документация и regression tests обновляются по затронутому контракту.
- `web4core.runtime.js` — generated/vendor из `saymer-alt/web4core@link-generators`.
  Ручные правки запрещены. Изменения парсинга/эмиссии вносятся в исходники fork;
  wrapper в `index.html` остаётся для адаптаций входа/выхода. См. [UPDATES.md](UPDATES.md).

- DOM-id (`mihomoInput`, `cfgLan`, `wgFile`, `copyYamlBtn`, …) — стабильный контракт
  между HTML и JS; не переименовывать в одной половине.
- Стиль: минимальные диффы, не реформатировать чужие участки, русские тексты UI,
  никаких npm/ES-модулей/фреймворков.

## Проверки перед commit

```bash
git status --short                 # только задуманные файлы
git diff --check                   # whitespace чисто
node --check web4core.runtime.js
node tests/runtime.cjs
```

Если runtime изменён, он должен точно воспроизводиться штатной сборкой fork:

```bash
# в соседнем checkout web4core, ветка link-generators
npm ci
node --test tools/tests/mihomo-exclude-filter.test.mjs tools/tests/mihomo-tun-stack.test.mjs
npm run build:web:runtime
# обратно в link-generators
node tests/runtime.cjs ../web4core/src/web4core.runtime.js
cmp ../web4core/src/web4core.runtime.js web4core.runtime.js
# ближайший функциональный baseline перед кандидатом v1.4.0
BASELINE_REF=927c446 node tests/runtime.cjs
```

На Windows checkout может иметь CRLF: сравнивать Git blob (LF) с output сборки,
отдельно подтверждая, что отличие рабочей копии только в переводах строк.
Baseline проверяет 16 API-сценариев, а не механизм удалённого bundle patch.
Основные якоря: `21c3010` — исторический переход consumer на source-level fork;
`927c446` — ближайший функциональный production baseline перед selective
REALITY/static-health кандидатом. В PowerShell, например:
`$env:BASELINE_REF='927c446'`. Полное назначение якорей — в
[TESTING.md](TESTING.md).
Source SHA и SHA-256 бандла фиксировать в review; любые различия объяснить до копирования.

Inline JS извлечь из последнего `<script>` и проверить `node --check`.

Браузерный regression test — `node tests/browser.cjs` с **внешней** установкой Playwright
и браузера; переменные окружения и baseline описаны в [TESTING.md](TESTING.md).
Приложение не получает npm-зависимостей или build step. Доступен и ручной прогон: обе вкладки,
полный сценарий «YAML → Распарсить → Сгенерировать → В Mihomo Builder → Build Config →
валидация → Copy», состояние валидатора при изменении входа.

## Deployment

Постоянные ветки разделены по назначению:

- `main` — integration/development. Все обычные feature/fix/docs PR сначала попадают сюда.
- `stable` — production channel для GitHub Pages. На `stable` не разрабатывают напрямую.
- release tag (`vX.Y.Z`) — неизменяемый снимок проверенного production commit.

Workflow `update-web4core-runtime.yml` запускает read-only build/test для `main` и `stable`,
но автоматический write-back `web4core.runtime.js` разрешён только в `main`. Это специально:
новый runtime сначала должен пройти integration и необходимые ручные/полевые проверки, а уже
затем попасть в production через promotion.

Promotion выполняется только после зелёного CI и нужных функциональных проверок:

1. закончить изменения в `main` и убедиться, что CI зелёный;
2. при изменении поведения пройти релевантный browser/real-Mihomo/field check;
3. открыть promotion PR `main → stable` без дополнительных функциональных правок;
4. после зелёного CI merge в `stable`;
5. проверить https://saymer-alt.github.io/link-generators/;
6. для релиза поставить тег на тот же production commit и опубликовать GitHub Release.

До первого переключения GitHub Pages source в настройках репозитория необходимо вручную выбрать
`stable` / root вместо `main` / root. После этого обычные commits в `main` больше не являются
production deployment.

## Safe change rules (кратко; полная версия — AGENTS.md)

- Не редактировать `web4core.runtime.js` вручную; воспроизводить его из исходников fork.
- Не добавлять backend, npm/билд-систему, ES-модули, телеметрию/аналитику — это
  архитектурные границы проекта.
- Не отправлять proxy-ссылки, конфиги, ключи наружу; не вводить сетевые вызовы с
  пользовательскими данными (текущее исключение — подписки, которые скачивает Mihomo, не
  браузер; `fetchSubscription` не используется).
- `mihomo.html` удалён из репо (2026-09-08) как неиспользуемый артефакт — не
  восстанавливать; исторические ссылки на `/mihomo.html` отдают 404, это ожидаемо.
- Не ослаблять privacy/security-свойства: страница ничего не хранит и не отправляет.
- Не «улучшать» DPI-стратегию генерации ссылок и формат `masque://` без задачи владельца —
  это внешние контракты (см. [AGENTS.md](../AGENTS.md)).
- Не «восстанавливать» сознательно удалённые функции (warpscout, WARP-in-WARP,
  `dialer-proxy`) — удалены владельцем 19.08.2026.
- Известные несостыковки (hint про TUN-дефолт vs `checked`) — не исправлять мимоходом,
  только явным решением владельца.
- Расхождение документации с кодом: источник истины — код; документацию править, код —
  только по задаче.

## Связанные документы

[ARCHITECTURE.md](ARCHITECTURE.md) — общая карта; [TESTING.md](TESTING.md) — как проверять;
[UPDATES.md](UPDATES.md) — рантайм и deployment-нюансы; [VALIDATION.md](VALIDATION.md) —
валидатор.
