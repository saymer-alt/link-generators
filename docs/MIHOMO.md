# MIHOMO — Builder, генерируемый YAML, валидация

Факты по коду (commit `f5ea0a3`): настройки UI → опции → секции YAML; в конце — краткое
описание pre-copy валидатора (полностью — [VALIDATION.md](VALIDATION.md)).

## Настройки вкладки «⚙️ Mihomo Config Builder»

| Элемент UI | id | Опция `buildFromRequest` | Дефолт | Эффект в YAML |
|---|---|---|---|---|
| 🌐 Allow LAN (0.0.0.0) | `cfgLan` | — (пост-патч страницы) | ☑ | `allow-lan: true` + `bind-address: "*"` |
| 🔌 Mixed Port 7890 | `cfgSocks` | `addSocks` | ☑ | `mixed-port: 7890` (или per-proxy listeners) |
| 🖥️ Web UI | `cfgWebUI` | `webUI` | ☑ | `external-controller: 0.0.0.0:9090`, `external-ui: ui` (+URL metacubexd), `secret:` пустой |
| 📡 Sub Mode | `cfgSubMode` | `mihomoSubscriptionMode` | ☑ | URL → `proxy-providers`, см. ниже |
| 🛡️ TUN Interface | `cfgTun` | `addTun` | ☑ | секция `tun:` (mitun0, gvisor, `auto-route: false`) |
| 🔒 Per-Proxy TUN | `cfgPerProxyTun` | `mihomoPerProxyTun` | ☐ | TUN-листенеры по одному на прокси/группу |
| 🔌 Per-Proxy SOCKS | `cfgPerProxySocks` | `perProxyPort` | ☐ | `listeners: socks-<имя>` на портах 7890+i, `mixed-port` убирается |
| 🏓 Ping server | `pingSelect` | `urlTest` | Google | `url`/`expected-status` url-test группы и health-check провайдеров |

Известная несостыковка UI: hint «TUN и Per-Proxy опции отключены по умолчанию» противоречит
факту — `cfgTun` в HTML стоит `checked`. Это зафиксировано в [AGENTS.md](../AGENTS.md) как
существующее поведение; менять только по явному решению владельца.

Ограничение рантайма: нужен хотя бы один inbound — при `addSocks=false` и `addTun=false`
ошибка «Mihomo: enable at least one inbound (TUN or SOCKS5)». Пустой ввод без wgBeans —
«No valid links or profiles provided». В Sub Mode без хотя бы одного URL — «Provide one or
more HTTP(S) URLs…» (частая ловушка при тестировании: Sub Mode включён по умолчанию).

## Базовый шаблон YAML

Всегда присутствует (`MIHOMO_DEFAULT_TEMPLATE` рантайма):

```yaml
mixed-port: 7890          # убирается при per-proxy SOCKS
allow-lan: false          # страница патчит на true + bind-address: "*"
tcp-concurrent: true
mode: rule
log-level: info
ipv6: false
unified-delay: true
profile:
  store-selected: true
  store-fake-ip: true
proxy-groups: …
rules:
  - "MATCH,GLOBAL"        # единственное правило: всё в группу GLOBAL
```

## Proxy-groups (обычный режим, ссылки)

- ≤1 прокси: `GLOBAL` (select) = [прокси, REJECT].
- ≥2 прокси: `"⚡ Fastest"` (url-test: `url` = выбранный health-check, `interval: 300`
  секунд, `expected-status: 204/200`) + `GLOBAL` (select) = ["⚡ Fastest", все прокси, REJECT].
- Per-proxy режимы (`Per-Proxy TUN` и/или `Per-Proxy SOCKS`): на каждый прокси — select
  группа `🔒 <имя>` = [прокси, REJECT]; `GLOBAL` = [все `🔒`-группы, REJECT].

Sub Mode: вместо `proxies` в группах — `use:` на провайдеров; группы `SUB-<провайдер>`
в per-proxy режимах; `⚡ Fastest` с `tolerance: 50` и `empty-fallback: REJECT`.

## TUN: два режима

- Обычный (`addTun`): секция `tun: { enable: true, stack: gvisor, auto-route: false,
  auto-detect-interface: true, device: mitun0 }`. `auto-route: false` принципиален —
  конфиги вставляются в окружения (роутеры), где захват всех маршрутов недопустим.
- Per-Proxy TUN (`addTun` + `mihomoPerProxyTun`): отдельные tun-листенеры в секции
  `listeners`: `mihomo-tun-N` (device `mitunN`, gvisor, `auto-route: false`,
  `auto-detect-interface: false`, `inet4-address: 198.19.x.y/30`), каждый с `proxy:` на
  свою `🔒`-группу / `SUB-`-группу.

## Health-check endpoints (`web4core.URLTEST_CHOICES`)

Google (`google.com/generate_204`, 204), Cloudflare (`cp.cloudflare.com`, 204), Apple
(`captive.apple.com`, 200), Microsoft (`msftconnecttest.com`, 200), Ubuntu, Fedora.
Выбор пользователя попадает в `url` url-test группы и health-check провайдеров.

## Особенности сгенерированного YAML

- Правка Allow LAN — **регэксп по тексту** после сборки: `allow-lan: false` → `true` и
  вставка `bind-address: "*"` после строки `allow-lan:` (если её ещё нет). Патч привязан к
  текущему формату вывода рантайма: после обновления рантайма проверять, что замена
  находит свои строки (см. [UPDATES.md](UPDATES.md)).
- YAML сериализует собственный `toYAML` рантайма (не jsyaml); `__comments` → `#`-комментарии
  (встречаются в sub-mode секциях провайдеров).
- Имена групп содержат emoji: `⚡ Fastest`, `🔒 <прокси>` — норма, не баг.
- Правила: всегда ровно `MATCH,GLOBAL` — разделение трафика делает не конфиг, а
  потребитель (на роутере — MagiTrickle и т.п.).

## Pre-copy валидатор (кратко; полностью — [VALIDATION.md](VALIDATION.md))

После Build Config финальный YAML автоматически проверяется `validateMihomoYaml()`:

- **успех** → «⚠️ Базовая проверка пройдена. Это не эквивалент проверки mihomo -t.»,
  Copy YAML доступна;
- **уверенная ошибка** → «❌ Ошибка базовой проверки» + Proxy/Field/Value/причина,
  Copy YAML заблокирована (disabled + guard в `copyMihomo()`);
- **предупреждения** — показываются, Copy не блокируют;
- изменение любого входа сбрасывает статус (`NOT_BUILT`) — нужно пересобрать.

ERROR ловят только то, что mihomo гарантированно отвергнет: битый YAML, обязательные поля
(name/type/server/port), неизвестный тип прокси/группы (списки сверены с исходниками mihomo
v1.19.x), дубликаты имён, битые ссылки групп, `mieru.transport ∉ {TCP,UDP}` (кейс
`transport: TPC`), некорректные порты.

### Почему это не `mihomo -t` и почему не настоящий Mihomo в браузере

Настоящего Mihomo WASM не существует: официальные релизы mihomo (проверен v1.19.30 — 128
ассетов) не содержат wasm/wasip1-таргетов; `config.Parse` тянет всё ядро; обязательная
зависимость quic-go собирается под WASM только с host-сокетами (в браузере UDP нет);
официальный дашборд metacubexd валидирует только через живое ядро по REST API. Поэтому
валидатор — архитектурное ограничение, а не недоделка: он структурный и **не гарантирует**,
что Mihomo примет конфиг. Авторитетная проверка — на целевой машине:

```bash
mihomo -t -f /opt/etc/mihomo/config.yaml
```

## Связанные документы

Данные и пост-обработка — [DATAFLOW.md](DATAFLOW.md); протоколы — [PROTOCOLS.md](PROTOCOLS.md);
полное описание валидатора — [VALIDATION.md](VALIDATION.md); тесты — [TESTING.md](TESTING.md).
