# MIHOMO — Builder, генерируемый YAML, валидация

## Автоматический режим белых списков (2026-09-15)

Контракт и точная структура YAML: [AUTO-WHITELIST.md](AUTO-WHITELIST.md).
UI передаёт опциональный `fallbackInput`; engine строит один плоский GLOBAL fallback
с конечными узлами primary → fallback, без DIRECT и вложенных групп (#2588). Выключенный режим сохраняет прежний путь.
Опции «на каждый прокси» и VPS исключаются независимо от скрытия UI; существующий validator
проверяет итоговый YAML. Runtime требуется с поддержкой нового generic API.


Факты по коду, включая MIPS TUN (2026-09-15): настройки UI → опции → секции YAML; в конце — краткое
описание pre-copy валидатора (полностью — [VALIDATION.md](VALIDATION.md)).

## Настройки вкладки «⚙️ Mihomo Config Builder»

| Элемент UI | id | Опция `buildFromRequest` | Дефолт | Эффект в YAML |
|---|---|---|---|---|
| 🌐 Allow LAN (0.0.0.0) | `cfgLan` | — (пост-патч страницы) | ☑ | `allow-lan: true` + `bind-address: "*"` |
| 🔌 Mixed Port 7890 | `cfgSocks` | `addSocks` | ☑ | `mixed-port: 7890` (или per-proxy listeners) |
| 🖥️ Web UI | `cfgWebUI` | `webUI` | ☑ | `external-controller: 0.0.0.0:9090`, `external-ui: ui`, `external-ui-url` (+URL metacubexd), `secret:` пустой |
| 🎛️ Дашборд Web UI | `webUiSelect` + `webUiCustomUrl` | `webUiDashboard` / `webUiCustomUrl` | MetaCubeXD | MetaCubeXD (tgz, дефолт — byte-parity) / Yacd-meta (gh-pages.zip) / Zashboard (dist.zip) / Custom http(s)-URL; виден при включённом Web UI; URL только генерируется, не проверяется браузером |
| 📡 Sub Mode | `cfgSubMode` | `mihomoSubscriptionMode` | ☑ | URL → `proxy-providers`, см. ниже |
| 🌐 Modern REALITY | `realityModernInput` | `mihomoRealityModernHosts` | пусто | multiline `host` / `host:port` / `[ipv6]:port`: только REALITY-узлы этих серверов получают `support-x25519mlkem768: true` + chrome fp (если не задан) и override-expr у провайдеров; пусто — legacy; только для совместимых серверов: X25519MLKEM768 появился в Xray v25.5.16, но сама версия не гарантирует совместимость (решение владельца A2) |
| 🚫 Exclude Filter | `excludeFilterInput` | `excludeFilter` | пусто | regexp/keyword `exclude-filter` в КАЖДЫЙ http-provider (upstream-паритет); только Sub Mode; пусто — поле не добавляется; сериализация цитирования покрыта source-тестами |
| 🛡️ TUN Interface | `cfgTun` | `addTun` | ☑ | секция `tun:` (mitun0, default mips / снят чекбокс → gvisor, `auto-route: false`) |
| ⚡ MIPS stack для TUN | `cfgTunMips` | `mihomoTunStack` | ☑ | `stack: mips`; снят → `gvisor`; Mihomo >= 1.19.31 (некритичное предупреждение валидатора); требует `cfgTun`; продуктовый дефолт (NIGHT-09) |
| ⚙ Расширенный TUN stack | `cfgTunStackAdvanced` + `cfgTunStackEx` | `mihomoTunStack` | ☐/— | `system`/`mixed` за крышкой; override снимает MIPS; невалидное значение → gvisor; Mihomo >= 1.19.31 |
| 🧩 Расширенный режим: отдельный вход | `cfgPerProxyMaster` | — | ☐ | защитная крышка; OFF → оба child выключены и сброшены; скрыт в БС-режиме |
| 🔒 TUN на каждый прокси | `cfgPerProxyTun` | `mihomoPerProxyTun` | ☐ | TUN-листенеры по одному на прокси/группу; требует `cfgPerProxyMaster` + `cfgTun`; скрыт в БС-режиме |
| 🔌 SOCKS-порт на каждый прокси | `cfgPerProxySocks` | `perProxyPort` | ☐ | `listeners: socks-<имя>` на портах 7890+i, `mixed-port` убирается; требует `cfgPerProxyMaster` + `cfgSocks`; скрыт в БС-режиме; static-листья чекаются скрытой группой «🌐 static-health» |
| 🏓 Ping server | `pingSelect` | `urlTest` | Google | `url`/`expected-status` url-test группы и health-check провайдеров |
| 🎯 Профиль развёртывания | `cfgProfile` | — (пост-патч страницы) | Универсальный | при «VPS Gateway» — gateway-постпатч YAML; подробно [VPS-GATEWAY.md](VPS-GATEWAY.md) |

Зависимости UI (группа «Отдельный вход на каждый прокси»): «⚡ MIPS stack для TUN» и
«🔒 TUN на каждый прокси» включаемы только при `cfgTun`, «🔌 SOCKS-порт на каждый прокси» —
только при `cfgSocks`; выключение родителя отключает и сбрасывает зависимую опцию
(`updateMihomoOptionStates()`). `buildMihomo()` не доверяет DOM и повторно клампит те же
зависимости (fail-safe против прямой подмены DOM): при `addTun=false` — `mihomoPerProxyTun=false`
и `mihomoTunStack=gvisor`, при `addSocks=false` — `perProxyPort=false`.

Дефолты UI (выправлено решением владельца 2026-09-15): hint «TUN включён по умолчанию;
MIPS и опции «на каждый прокси» выключены» соответствует факту — `cfgTun` в HTML стоит
`checked`, остальные опции выключены. Сами дефолты не менялись.

Ограничение рантайма: нужен хотя бы один inbound — при `addSocks=false` и `addTun=false`
ошибка «Mihomo: enable at least one inbound (TUN or SOCKS5)». Пустой ввод без wgBeans —
«No valid links or profiles provided». В Sub Mode без хотя бы одного URL — «Provide one or
more HTTP(S) URLs…» (частая ловушка при тестировании: Sub Mode включён по умолчанию).

## Базовый шаблон YAML

Всегда присутствует (`MIHOMO_DEFAULT_TEMPLATE` рантайма):

```yaml
mixed-port: 7890          # убирается режимом «SOCKS-порт на каждый прокси»
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
- Режимы «на каждый прокси» («TUN на каждый прокси» и/или «SOCKS-порт на каждый прокси»):
  на каждый прокси — select группа `🔒 <имя>` = [прокси, REJECT]; `GLOBAL` = [все `🔒`-группы, REJECT].

Sub Mode: вместо `proxies` в группах — `use:` на провайдеров; группы `SUB-<провайдер>`
в режимах «на каждый прокси»; `⚡ Fastest` с `tolerance: 50` и `empty-fallback: REJECT`.

## TUN: два режима

С ревизии v1.19.31 добавлен checkbox `cfgTunMips` → `options.mihomoTunStack`.
Он выключен: по умолчанию `gvisor`. При включении — `mips` в обоих режимах ниже,
включая VPS Gateway. **MIPS — TUN stack, не CPU architecture; требуется Mihomo >= 1.19.31.**
Runtime разрешает только `mips`/`gvisor`, неизвестное значение даёт безопасный `gvisor`.
Новая опция сама по себе TUN не включает. Прямой `buildMihomoYaml` принимает
`opts.tun.stack` с тем же fallback. Обоснование по исходникам — [аудит](AUDIT-MIHOMO-1.19.31.md).

- Обычный (`addTun`): по умолчанию `tun: { enable: true, stack: gvisor, auto-route: false,
  auto-detect-interface: true, device: mitun0 }`. `auto-route: false` принципиален —
  конфиги вставляются в окружения (роутеры), где захват всех маршрутов недопустим.
  При MIPS (дефолт) меняется только стек: `stack: mips`; снятие чекбокса → `gvisor`.
- TUN на каждый прокси (техн. Per-Proxy TUN; `addTun` + `mihomoPerProxyTun`): отдельные
  tun-листенеры в секции `listeners`: `mihomo-tun-N` (device `mitunN`, default mips / снят чекбокс → gvisor,
  `auto-route: false`, `auto-detect-interface: false`, `inet4-address: 198.19.x.y/30`), каждый с
  `proxy:` на свою `🔒`-группу / `SUB-`-группу.
- Профиль VPS Gateway (opt-in, селектор «Профиль развёртывания»): пост-патч поверх
  готового YAML — основная секция `tun:` приводится к gateway-виду (`tun-mihomo`,
  `inet4-address`, `mtu`, `gso`), добавляются `find-process-mode: off`,
  `profile.store-*: false` и опциональная секция `dns:` (fake-ip). По умолчанию выключен,
  на Generic-вывод не влияет; подробно — [VPS-GATEWAY.md](VPS-GATEWAY.md).

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
