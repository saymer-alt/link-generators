# Политики по доменам (Domain Policy Routing, Variant B)

Опциональный режим Mihomo Builder (чекбокс «🚦 Политики по доменам»): домены
пользователя направляются в разные логические группы выхода, не привязываясь
к конкретным серверам подписки.

```text
DOMAIN / RULE-SET
        ↓ rules (RULE-SET,…) — стабильные имена
POLICY GROUP (select)   ← пользователь переключает в дашборде
        ↓
POLICY-AUTO (url-test)  ← use: на provider подписки
        ↓
PROXY-PROVIDER (http)   ← платная HTTP(S)-подписка
        ↓
CURRENT LIVE NODE       ← состав меняет сам провайдер
```

Реализация: эмиссия — `web4core:link-generators`
(`src/core/mihomo.js`, `src/build.js`, `src/core/yaml.js`); UI-карточки,
валидатор и предупреждения — `index.html`. Контракт проверен живым PoC на
Mihomo **v1.19.31 и v1.19.32** (2026-10-01, тестовый VPS): маршрутизация
`DOMAIN → POLICY → PROVIDER → LIVE NODE` доказана journal-строками и
`/connections` chains; динамика провайдера (добавление/удаление/сбой
обновления) пережита без изменения правил.

## Что генерируется

Для каждой политики `NAME` со списком доменов:

```yaml
rule-providers:
  policy-<slug>:
    type: inline
    behavior: classical
    format: yaml
    payload:
      - "DOMAIN-SUFFIX,openai.com"
      - "DOMAIN-SUFFIX,chatgpt.com"

proxy-groups:
  - name: NAME-AUTO        # только в режиме URL-подписок
    type: url-test
    use: [<все proxy-providers подписок>]
    url: <выбранный health-check URL>
    interval: 300
    tolerance: 50
    expected-status: 204
    empty-fallback: REJECT
  - name: NAME             # select над AUTO
    type: select
    proxies: [NAME-AUTO, ⚡ Fastest, GLOBAL, DIRECT]

rules:
  - "RULE-SET,policy-<slug>,NAME"   # по одной на политику, в порядке карточек
  - "MATCH,GLOBAL"                  # неизменное DEFAULT-правило, всегда последнее
```

### Режимы Builder

| Режим | Группы категории |
|---|---|
| URL-подписки | `NAME-AUTO` (url-test над общим provider) + `NAME` (select `[NAME-AUTO, ⚡ Fastest, GLOBAL, DIRECT]`) |
| Только proxy-ссылки | `NAME` = select `[⚡ Fastest, GLOBAL, DIRECT]` — AUTO-групп без подписок нет (честное ограничение UI) |
| Автоматический режим белых списков | `NAME` = select `[GLOBAL, DIRECT]` — политика указывает на существующий плоский fallback; вложенность `fallback → url-test` не создаётся (контракт #2588) |
| «На каждый прокси» (per-proxy) | несовместимо: чекбокс блокируется в UI и отклоняется движком |

### Разбор пользовательских строк

- голый домен `example.com` → `DOMAIN-SUFFIX,example.com` (с поддоменами);
- `*.example.com` → `DOMAIN-SUFFIX,example.com`;
- явные формы: `DOMAIN,`, `DOMAIN-SUFFIX,`, `DOMAIN-KEYWORD,`, `DOMAIN-WILDCARD,`, `DOMAIN-REGEX,` (значение);
- `GEOSITE,<категория>` — готовые категории v2fly (`youtube`, `telegram`, `openai`, `category-ai-!cn`, …); сам механизм GEOSITE опционален для пользователя, архитектура от него не зависит;
- CIDR `192.0.2.0/24` (голый или `IP-CIDR,…`) → `IP-CIDR,…,no-resolve`;
- `#`-комментарии и пустые строки пропускаются; нераспознанные строки
  пропускаются с **неблокирующим предупреждением** после сборки;
- имена политик: непустые, без запятых, уникальные, не из зарезервированных
  (`GLOBAL`, `DIRECT`, `REJECT`, `⚡ Fastest`, …) — дубликаты и конфликты
  отклоняются при сборке.

## Почему правила не зависят от серверов подписки

Правила ссылаются на **имена групп**; группы получают узлы через `use:` — это
ссылка на provider, а не копия списка. Провайдер может добавлять, удалять,
переименовывать серверы: состав групп обновляет сам Mihomo при очередном
обновлении подписки (12 ч; либо вручную из дашборда), правила остаются
байтово теми же. Поэкспериментально подтверждено (PoC 2026-10-01): add/remove
узлов, удаление выбранного узла (автовыбор первого живого), недоступный и
битый провайдер (работает последний хороший список), пустое обновление
(отклоняется ядром), пустой фильтр (`empty-fallback: REJECT`) — во всех
случаях `rules` не менялись.

## Контракт провайдера: `proxy: DIRECT`

Каждый HTTP-провайдер подписки обязан сохранять `proxy: DIRECT` (скачивание
подписки напрямую). Без него фетч подписки идёт через собственные правила
инстанса (`[TCP] mihomo --> <provider-host> match Match using GLOBAL[…]`),
и на холодном старте возникает deadlock: группа пуста → REJECT → провайдер
не может загрузиться. Зафиксировано regression-тестами движка и consumer-набора.

## Ограничения (честно)

- **Домен нужно сначала увидеть.** В режиме URL-подписок + mixed-port (SOCKS)
  домен приносит сам клиент. Для TUN-трафика без секций `dns`/`sniffer`
  (обычный вывод генератора) Mihomo видит только IP: классификация работает
  для клиентов, передающих имя, и не работает для чистых IP-потоков. Полный
  пакет домен-детекта (`tun.dns-hijack`, `sniffer`, fake-ip persistence)
  уже реализован как инвариант профиля vps-gateway — см. раздел
  «VPS Gateway: Domain Detection Package» ниже и [VPS-GATEWAY.md](VPS-GATEWAY.md).
- TLS ECH скрывает SNI, клиентский DoH/DoT проходит мимо hijack,
  hardcoded-IP приложения не классифицируются доменными правилами — это
  ограничения механизма Mihomo, не генератора.
- Названия категорий — пользовательские имена групп; они видны в дашборде
  как обычные группы.
- Внешние HTTP rule-providers в этой арке сознательно не реализованы
  (приватность: пользовательские списки не покидают устройство).

## Взаимодействие с AUTO-WHITELIST

Разрешённая схема: `RULE-SET → политика (select) → GLOBAL → существующий
плоский fallback PRIMARY→FALLBACK`. Категорийные AUTO-группы в режиме БС не
создаются; `url-test` никогда не вкладывается в `fallback` (issue mihomo
#2588, воспроизведён на v1.19.31). Существующий контракт БС не меняется;
покрыто regression-тестами (`tests/policy-routing.cjs`, `mihomo-priority.test.mjs`).

## VPS Gateway: Domain Detection Package (реализовано)

Профиль **vps-gateway** (после арки deployment profiles `router / vps-local /
vps-gateway`) автоматически включает пакет домен-детекта (PoC 2026-10-01,
production-like стенд, Mihomo 1.19.31; recommended/current — 1.19.32).
Профили `router` и `vps-local` пакет НЕ получают: router — обычный контракт
Keenetic, vps-local — локальный SOCKS-режим без TUN (hijack/fake-ip там
семантически неприменимы):

```yaml
profile:
  store-fake-ip: true      # при включённом fake-ip DNS (sub-toggle); false без него
tun:
  dns-hijack: [any:53, tcp://any:53]   # только при включённом fake-ip DNS
sniffer:
  enable: true
  parse-pure-ip: true
  force-dns-mapping: true
  override-destination: false   # hostname только для матчинга, dial-цель не меняется
  sniff: {TLS: [443, 8443], QUIC: [443, 8443], HTTP: [80, 8080-8880]}
```

Режим включения — автоматический, без нового UI-toggle: пакет является
инвариантом профиля (как `auto-route: false`); де-факто отказ возможен
выключением fake-ip DNS (`vpsDnsEnabled`), тогда hijack и persistence
семантически не имеют смысла. От DPR пакет не зависит (полезен и без политик).
Live-проверено: hijack внешнего :53 DNS, DoH/pure-IP/HTTP-host/QUIC
классификация, рестарт с восстановлением fake-ip mapping без мисатрибуции,
cold-start провайдера. Инварианты (`auto-route: false`, `device`,
`fake-ip-range`, MIPS/gVisor, mixed-port/controller) не тронуты.

**Межпроектный контракт:** `amnezia-mihomo-gateway` до PR #33
(`feat/domain-detection-store-fake-ip`, `8f41759`, merged в `main` gateway
2026-10-01) принудительно переписывал
`profile.store-fake-ip` в `false` при установке (патчер §2.7) — PR
меняет патчер на сохранение значения генератора (при отсутствии ключа
по-прежнему дописывается `false`); в stable-канал установщика попадёт после
promotion в том репозитории. Неизвестные ключи (`tun.dns-hijack`,
`sniffer`) патчер и раньше пропускал дословно — покрыто его тестом.
Восстановление fake-ip маршрута после рестартов принадлежит gateway
(`check-warp-routing.timer` ≤1 мин, `routing_ok` проверяет
`ip route show <fake-ip-range> dev tun-mihomo`) и не меняется.

## Security / privacy

- Пользовательские домены и подписки никуда не отправляются: страница по-
  прежнему без `fetch`/XHR/telemetry; inline rule-providers живут только в
  сгенерированном YAML.
- Валидатор не выводит URL подписок и заголовки в диагностике.
- Публичные списки шаблонов (AI/Media/Telegram/Google/Direct) содержат
  только публичные домены и лишь заполняют textarea.

## Связанные документы

Параметры Builder — [MIHOMO.md](MIHOMO.md); поток данных — [DATAFLOW.md](DATAFLOW.md);
тесты — [TESTING.md](TESTING.md); PoC-отчёт и исследование — журнал задач
владельца (2026-10-01).
