# No-DIRECT egress policy (#284, owner decision revised 2026-10-18)

**Поведенческая политика, не лексический запрет.** Генератор не создаёт
маршруты, по которым **пользовательский трафик** незаметно выходит напрямую с
публичного IP VPS (или обходит выбранную прокси-политику на роутере). При
отказе всех разрешённых выходов — отказ/REJECT, never хост-IP fallback.
Прежняя редакция (абсолютный запрет литерального токена `DIRECT`) признана
владельцем слишком широкой: она блокировала динамические подписки и сценарии
PT ради прохождения текстового критерия («обезьянья лапка», PR #287).

## Два уровня (обязательное архитектурное разделение)

- **User data plane** — маршрутизация через GLOBAL, MATCH, Tiered, fallback,
  AWL, DPR, per-proxy listeners: никаких неожиданных пользовательских выходов
  через публичный адрес хоста; DIRECT не предлагается как пользовательский
  выход/таргет и не является fallback по умолчанию.
- **Service/control/transport plane** — загрузка и обновление HTTP-подписок
  (`proxy-providers.*.proxy`), DNS/bootstrap, установление соединений к
  удалённым proxy/WG/AWG/MASQUE, служебная диагностика: прямые подключения
  по назначению разрешены и не считаются пользовательским egress.

Router: проксируемый трафик не должен незаметно обходить выбранную политику;
обычная работа устройства/ОС вне Mihomo не является объектом запрета.
Config Studio: source-preserving редактирование чужих YAML сохранено.

## Реестр решений по путям (revised)

| # | Путь | Классификация | Решение |
|---|---|---|---|
| 1 | DPR категории-группы: финальный участник | user data plane (переключаемый пользователем выход) | `REJECT` во всех режимах (sub/static/AWL) |
| 2 | DPR фиксированный таргет `RULE-SET,<slug>,DIRECT` | user data plane | fail-closed rejection на обоих уровнях движка; UI не предлагает; legacy-карты блокируют Build до явного обновления |
| 3 | Магистраль GLOBAL/⚡ Fastest/Tiered fallback/per-proxy | user data plane | уже fail-closed: REJECT-терминаторы, `empty-fallback: REJECT` — зафиксировано тестами |
| 4 | `proxy: DIRECT` у proxy-providers подписок | **service plane** (bootstrap скачивания) | сохранён как штатный служебный транспорт; без него фетч идёт по правилам конфига → пустой GLOBAL → REJECT → immediate EOF (проверено на 1.19.31). Никогда не referenced из групп/правил |
| 5 | `dialer-proxy: DIRECT` (WG handshake) | **service plane** (установление соединения) | эмитится как раньше; пользовательский трафик идёт через туннель |
| 6 | PT: exit-узел без исходящего ребра (`MATCH,DIRECT`) | **user data plane** — артефакт направляет ВЕСЬ пользовательский трафик напрямую с публичного IP VPS | config.yaml не генерируется; блокер `PT-GEN-DIRECT-BAN` (статус `EXTERNAL_CONTRACT_REQUIRED`); безопасные альтернативы: финальный overlay (final-overlay) или явный исходящий транспорт. Цепочки с overlay генерируются полностью |

### Открытый вопрос по PT (варианты владельцу)

Bare-exit артефакт исторически эмитился с `MATCH,DIRECT`. Варианты:
- **A (реализовано)** — блокировать генерацию config.yaml с блокером
  `PT-GEN-DIRECT-BAN`; contract.md объясняет требование. PT-цепочки с
  final-overlay работают полностью.
- B — добавить в PT UI явный выбор транспорта для exit-сегмента (большее
  изменение функциональности, отдельная задача).
- C — оставить bare-exit артефакты с громким предупреждением (отклонено:
  это реальный пользовательский egress через VPS IP, не служебное подключение).

## Semantic validator rule (#284, replaces lexical guard)

`validateMihomoYaml` выполняет **структурную** проверку разобранного документа:
- участник `DIRECT` в любой `proxy-groups[].proxies` → INVALID (`direct-egress`);
- таргет правила `...,DIRECT` → INVALID (`direct-egress`);
- служебные ключи (`proxy-providers.*.proxy`, `dialer-proxy`) **не** проверяются
  (service plane) — Sub Mode ON конфигурации проходят валидацию.

Это не замена end-to-end проверкам: реальный прямой пользовательский egress
обнаруживается runtime-тестом полного отказа прокси (ниже), а не сканированием
текста.

## Outage test (полный отказ всех прокси)

Изолированный runtime-тест: конфиг с двумя мёртвыми прокси + DPR REJECT-карта;
локальный echo-сервер — контролируемый «direct-таргет». Результат: 0 попаданий
на echo, клиент получает 502/REJECT, chains без DIRECT — **fail-closed
подтверждён на уровне политики Mihomo + host-наблюдение**. Граница: это не
доказательство свойств ОС — host-side DNS, IPv6, Linux policy routing
проверяются отдельно (amnezia-mihomo-gateway: таблица 100, `auto-route: false`,
fail-secure watchdog).

## Тесты

- движок: `wc tools/tests/mihomo-no-direct.test.mjs` + обновлённые
  `mihomo-policy-routing` / `mihomo-policy-targets`;
- consumer-реестр: `tests/no-direct-egress.cjs` (семантика по вендоренному
  рантайму + положительные регрессии Sub-ON/dialer);
- страница: `tests/no-direct-browser.cjs` (семантический валидатор, DPR UI,
  legacy-гейт, Sub-ON положительная регрессия, PT-блокер);
- PT: `tests/per-node-generation.cjs`.
