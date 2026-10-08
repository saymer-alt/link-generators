# Per-node generation: transport registry и контракт артефактов (#187, v1.11)

Документ цикла v1.11 (#177; primary capability — #187). Дата: 2026-10-08.
Базис: main после NIGHT-02 (`dd271de`). Evidence-метки как в PHYSICAL-MULTIHOP-ARCHITECTURE.md.

## 1. Upstream research (P1.1) — SOURCE-PROVEN по тегу v1.19.32

Все проверки 2026-10-08, raw-fetch из `MetaCubeX/mihomo` **на теге `v1.19.32`** (не Alpha — релизная ветка совместимости; ядро проекта живёт на Alpha, релизы — теги).

### 1.1 Server-side (inbound) capabilities: `listener/parse.go`

Дисклеймер из исходника (`listener/parse.go`, v1.19.32) — поддерживаемые типы `listeners:`:

```text
socks, http, tproxy, redir, mixed, tunnel, tun,
shadowsocks, snell, vmess, vless, trojan,
hysteria2, hysteria2-realm, tuic, shadowquic, anytls,
mieru, sudoku, trusttunnel
```

Старые relay-предположения не используются (relay удалён из ядра — см. PHYSICAL-MULTIHOP-ARCHITECTURE.md §2.2). Каждый тип — свой `IN.*Option` + конструктор; поля (port/password/cipher/…) декодируются строгим декодером, отсутствие обязательных полей = ошибка разбора конфига.

### 1.2 Client-side (outbound): `adapter/outbound`

`mieru.go`, `shadowsocks.go`, `socks5.go` и др. присутствуют на v1.19.32 — outbound-транспорты для межузловых подключений SOURCE-PROVEN.

### 1.3 Первоклассный набор генератора (first class)

Полная пара «Mihomo-outbound → Mihomo-listener» — SOURCE-PROVEN и покрыта шаблонами генератора:

| transport | outbound (`proxies`) | listener (`listeners`) | password | cipher |
|---|---|---|---|---|
| `ss` | `ss` | `shadowsocks` | да | aes-128-gcm (фиксированный) |
| `socks` | `socks5` | `socks` | нет | — |
| `http` | `http` | `http` | нет | — |

Вне набора (`wireguard`-сервер, `mieru`-пара, vmess/vless/trojan-инбаунды и т.д.) — **не** генерируются как конфиги: узел получает `EXTERNAL_CONTRACT_REQUIRED` + `contract.md` с честным перечнем требований. Причина: генерировать YAML по неподтверждённым полям опций (IN.*Option различаются по типам) = выдумывать серверную семантику. Расширение набора — отдельная задача с тестом на каждый тип.

## 2. Модель (P1.4): минимальное расширение PT

Существующая модель (nodes/links/roles) не меняется. Генерационные данные — в raw spec (валидатор их игнорирует, строит только цепочку):

```text
links[i].transport = { kind, endpoint: 'ep-ref', credentialRef: 'cred-ref' }
clientLink         = { transport: { kind, endpoint, credentialRef } }   // клиент → ENTRY
endpoints          = { 'ep-ref': 'host:port' }                          // не секреты (RFC5737 в фикстурах)
credentials        = { 'cred-ref': value }                              // СЕКРЕТЫ: память вкладки, в manifest НЕ попадают
```

Local failover (кандидаты в `localPolicies`) остаётся локальной политикой: три кандидата Estonia→Sweden = ОДНО физическое ребро (тест 8).

## 3. Артефакты и статусы (P1.3/P1.12/P1.13)

| статус | что значит | mihomo -t |
|---|---|---|
| `READY` | полный первоклассный контракт, креды резолвлены | RUN и обязан проходить (compat-сюита в CI-матрице 1.19.31/1.19.32) |
| `PLACEHOLDERS_REQUIRED` | конфиг сгенерирован, но кред-рефы без значений → `<CS-PLACEHOLDER:cred-ref>` | NOT_RUN — плейсхолдеры должны быть заменены владельцем |
| `EXTERNAL_CONTRACT_REQUIRED` | серверная часть вне первоклассного набора / нет контракта | NOT_RUN — config.yaml НЕ генерируется (fallback в DIRECT де-анонимизировал бы цепочку — намеренно не эмитим) |

FINAL OVERLAY (WARP) — attachment, не узел: узла-артефакта не создаёт; ребро exit→overlay обслуживается EXIT-узлом (при wireguard — external contract).

## 4. Выход генерации (P1.9/P1.10)

- `topology.json` — детерминированный manifest (schemaVersion, topologyId = `pt-<ids>`, nodes/links с transport-метаданными, статусы артефактов, `evidence: NOT_MEASURED`); секрета не содержит; байт-стабилен (тест).
- `deployment-map.md` — человекочитаемый слой; только intended-формулировки, NOT_MEASURED, никаких «сейчас идёт» (тест).
- Скачивание — пофайловое (topology.json, deployment-map.md, per-node config.yaml/contract.md). ZIP-зависимость сознательно не вводится (P1.16: security > convenience).

## 5. DNS / MTU / failure (P1.14/P1.15/P1.13)

- DNS: артефакт не претендует на сквозной DNS-path; статическая валидация PASS — только про структуру. DNS-expectation по звеньям — будущая работа (UNKNOWN).
- MTU: auto-MTU по-прежнему запрещён; ничего не считаем по цепочке.
- Failure: CHAIN_UNAVAILABLE при отказе узла — семантика what-if (PT-CORE) не изменилась; артефакты описывают intended-топологию и не перестраиваются под альтернативную физику (automatic topology failover — not promised).

## 6. Тесты (P1.17)

`tests/per-node-generation.cjs` (16 групп: 2/3-hop, overlay-contract, два transit, loop-отказ, missing contract, external inbound, candidates=одно ребро, детерминизм manifest/map, no-secrets, unsupported transport, placeholders, parity-guard, trace-согласованность, intended-not-runtime) + `tests/per-node-mihomo-compat.cjs` (READY-артефакты ss/socks/http против реального mihomo 1.19.31/1.19.32 в CI-матрице; EXTERNAL_CONTRACT — NOT_RUN и без config.yaml). Browser-часть — в `tests/config-studio-browser.cjs` (генерация из demo, честные статусы, per-file downloads, mobile 360).
