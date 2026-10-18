# No-DIRECT egress invariant (#284, owner decision 2026-10-18)

**P0 / hard invariant / FAIL CLOSED.** Builder не выпускает `config.yaml` с
литеральным токеном `DIRECT` — ни участником группы, ни правилом, ни запасным
выходом, ни автоподстановкой. При исчерпании всех пригодных прокси трафик
блокируется (`REJECT` / отказ дial), но никогда не уходит с публичного IP
хоста. Утверждено владельцем 2026-10-18 (issue #284); конституционная запись —
PR #285 (`AGENTS.md`). Source-preserving Config Studio читает/редактирует
чужой YAML как раньше и не объявляется совместимым с политикой генерации.

## Машинно-проверяемый реестр

| # | Путь DIRECT | Где было | Статус после #284 | Проверка |
|---|---|---|---|---|
| 1 | DPR: категории-группы SELECT, финальный участник `DIRECT` (sub/static/AWL-режимы) | `web4core` `src/core/mihomo.js` → `buildDomainPolicyArtifacts` | финальный слот = `REJECT` во всех трёх вариантах | `mihomo-no-direct.test.mjs`, `mihomo-policy-routing.test.mjs`, `tests/no-direct-egress.cjs` |
| 2 | DPR: фиксированный таргет политики `RULE-SET,<slug>,DIRECT` | `build.js` `normalizePolicyTarget`, `mihomo.js` engine-проверка | отклоняется fail-closed на обоих уровнях движка; UI не предлагает; legacy-карты блокируют Build до явного обновления | `mihomo-policy-targets.test.mjs`, `tests/no-direct-egress.cjs` |
| 3 | `proxy: DIRECT` у proxy-providers подписок (bootstrap скачивания) | `mihomo.js` `buildMihomoSubscriptionConfig` | **документированное исключение уровня движка** (см. ниже); режим Sub Mode ON блокируется гейтом страницы — Builder такой YAML не выпускает | `mihomo-no-direct.test.mjs` (фиксация), гейт + лексический guard на странице |
| 4 | `dialer-proxy: DIRECT` (bean-level и глобальный wgDialer таргет) | `mihomo.js` `buildMihomoProxy`, `yaml.js` `applyMihomoWgDialer` | поле опускается (семантически идентично: WG-хендшейк без dialer-прокси идёт напрямую); токен не эмитится | `mihomo-no-direct.test.mjs`, `tests/no-direct-egress.cjs` |
| 5 | PT-артефакты: exit-узел без исходящего ребра → `MATCH,DIRECT` | `index.html` `ptNodeArtifactYaml` | config.yaml для такого узла не генерируется; блокер `PT-GEN-DIRECT-BAN` (статус `EXTERNAL_CONTRACT_REQUIRED`); нужен final-overlay или явный исходящий транспорт | `tests/per-node-generation.cjs` |
| 6 | UI: пресет «DIRECT-LIST», опции таргетов DPR/MagiTrickle, AWL-ограничение «GLOBAL или DIRECT» | `index.html` `POLICY_PRESETS`, `policyCardDom`, MT-маппинги | пресет заменён на `REJECT-LIST`; DIRECT удалён из опций (для legacy-карт — запрещённая опция только для отображения); AWL = GLOBAL/REJECT | browser-сьюты (policy-routing, owner-ux), `tests/no-direct-browser.cjs` |
| 7 | Legacy-состояния проектов (карты с таргетом DIRECT, WG-профили с dialer-таргетом DIRECT) | project JSON / reverse build | читаются как раньше; Build блокируется с явным перечнем и требованием явного обновления (молчаливая смена маршрутов запрещена) | `tests/no-direct-browser.cjs` |

Магистраль (GLOBAL / ⚡ Fastest / Tiered-fallback / per-proxy группы /
static-health) уже была fail-closed: каждый список заканчивается `REJECT`,
`empty-fallback: REJECT`, у fallback-групп `timeout/max-failed-times` — здесь
изменений нет, только фиксация тестами.

## Задокументированное исключение: bootstrap провайдеров подписок

Mihomo загружает http-провайдера по правилам конфига, если у провайдера нет
явного `proxy`. Без прямого транспорта загрузка невозможна никогда — на
mihomo v1.19.31 проверено локально: `proxy: DIRECT` → провайдер загружается;
поле удалено + `MATCH,GLOBAL` по пустой provider-backed группе → немедленный
EOF, cold-start deadlock. Переименовать direct-outbound («обход через
собственные имена») запрещено поправкой #285. Совместимой альтернативы у
Mihomo сегодня нет, поэтому:

- движок сохраняет документированное download-only поле (никогда не
  referenced из групп/правил, не маршрутизация пользовательского трафика);
- гейт страницы блокирует Sub Mode ON (включая fallback-подписки белых
  списков) с понятным сообщением и указанием на совместимый путь — Sub Mode
  OFF (разворот подписки в статические узлы на Build);
- финальный лексический guard валидатора делает невозможным Copy/Download
  любого YAML с токеном `DIRECT`, даже если будущий код-путь регрессирует.

Варианты решения для v1.12 (на решение владельца): scoped-исключение для
download-only транспорта; генераторная пере-загрузка подписки на стороне
Build; upstream-запрос в Mihomo на bootstrap-транспорт без DIRECT.

## Финальный guard

`validateMihomoYaml` (index.html) завершается лексической проверкой
`/\bDIRECT\b/` по всему итоговому YAML: любое совпадение → `INVALID`
(`no-direct-invariant`), Copy/Download заблокированы (уже существующий гейт
VALID-статуса). Это защита от регрессий и пользовательских имён, содержащих
DIRECT: имя прокси с подстрокой `DIRECT` тоже блокирует сборку — осознанный
fail-closed компромисс.

## Границы гарантии

Отсутствие токена в YAML — это гарантия уровня политики Mihomo. Она НЕ
доказывает отсутствие прямой исходящей связи на уровне ОС: host-side DNS,
IPv6, Linux policy routing, bootstrap-подключения проверяются отдельно
(amnezia-mihomo-gateway: policy routing в таблице 100, `auto-route: false`,
fail-secure watchdog). Не заявлять «хост fail-closed» без полевых проверок.

## Тесты

- движок: `wc tools/tests/mihomo-no-direct.test.mjs` (+ обновлённые
  `mihomo-policy-routing` / `mihomo-policy-targets`);
- consumer-реестр по вендоренному рантайму: `tests/no-direct-egress.cjs`;
- страница (гейты, опции, guard): `tests/no-direct-browser.cjs`;
- PT: `tests/per-node-generation.cjs` (PT-GEN-DIRECT-BAN).
