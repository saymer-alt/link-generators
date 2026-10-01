# MIHOMO — Builder, генерируемый YAML, валидация

## Автоматический режим белых списков (2026-09-15)

Контракт и точная структура YAML: [AUTO-WHITELIST.md](AUTO-WHITELIST.md).
UI передаёт опциональный `fallbackInput`; engine строит один плоский GLOBAL fallback
с конечными узлами primary → fallback, без DIRECT и вложенных групп (#2588). Выключенный режим сохраняет прежний путь.
Опции «на каждый прокси» и VPS исключаются независимо от скрытия UI; существующий validator
проверяет итоговый YAML. Runtime требуется с поддержкой нового generic API.


Факты по коду, включая MIPS TUN (2026-09-15): настройки UI → опции → секции YAML; в конце — краткое
описание pre-copy валидатора (полностью — [VALIDATION.md](VALIDATION.md)).

## VPS Gateway: Domain Detection Package (2026-10-01)

Профиль «VPS Gateway» автоматически генерирует пакет домен-детекта:
`tun.dns-hijack` + `profile.store-fake-ip: true` (вместе с fake-ip DNS,
sub-toggle) и пассивный `sniffer` (TLS/QUIC/HTTP, `override-destination:
false`). Включение автоматическое — без нового toggle (пакет = инвариант
профиля); от DPR не зависит. Инварианты gateway не тронуты; контракт с
`amnezia-mihomo-gateway` (сохранение `store-fake-ip` в патчере
установщика) — ветка `feat/domain-detection-store-fake-ip`. Подробности:
[POLICY-ROUTING.md](POLICY-ROUTING.md), [VPS-GATEWAY.md](VPS-GATEWAY.md).

## Политики по доменам (Domain Policy Routing, Variant B)

Опциональный чекбокс «🚦 Политики по доменам»: карточки «имя + домены» превращаются
в inline `rule-providers` (`policy-<slug>`), категории-группы и `RULE-SET`-правила
перед неизменным `MATCH,GLOBAL`. В режиме URL-подписок категория получает
`NAME-AUTO` (url-test, `use:` на общий provider — несколько групп на один
провайдер) и select `[NAME-AUTO, ⚡ Fastest, GLOBAL, DIRECT]`; без подписок —
select `[⚡ Fastest, GLOBAL, DIRECT]`; в БС-режиме — select `[GLOBAL, DIRECT]`
(плоский fallback не вкладывается, #2588). `proxy: DIRECT` у провайдеров —
обязательный контракт (без него холодный старт дедлочит фетч подписки).
Выключенный режим — byte-parity. Полное описание, ограничения (ECH/DoH/hardcoded IP,
домен-детект для TUN) и PoC-доказательства — [POLICY-ROUTING.md](POLICY-ROUTING.md).

## Настройки вкладки «⚙️ Mihomo Config Builder»

| Элемент UI | id | Опция `buildFromRequest` | Дефолт | Эффект в YAML |
|---|---|---|---|---|
| 🌐 Allow LAN (0.0.0.0) | `cfgLan` | — (пост-патч страницы) | ☑ | `allow-lan: true` + `bind-address: "*"` |
| 🔌 Mixed Port 7890 | `cfgSocks` | `addSocks` | ☑ | `mixed-port: 7890` (или per-proxy listeners) |
| 🖥️ Web UI | `cfgWebUI` | `webUI` | ☑ | `external-controller: 0.0.0.0:9090`, `external-ui: ui`, `external-ui-url` (+URL metacubexd), `secret:` пустой |
| 🎛️ Дашборд Web UI | `webUiSelect` + `webUiCustomUrl` | `webUiDashboard` / `webUiCustomUrl` | MetaCubeXD | MetaCubeXD (tgz, дефолт — byte-parity) / Yacd-meta (gh-pages.zip) / Zashboard (dist.zip) / Custom http(s)-URL; виден при включённом Web UI; URL только генерируется, не проверяется браузером |
| 📡 Использовать URL-подписки | `cfgSubMode` | `mihomoSubscriptionMode` | ☑ | HTTP(S) URL → `proxy-providers`; обычные proxy-ссылки без подписок в стандартном сценарии удобнее обрабатывать с выключенным режимом |
| 🌐 Modern REALITY | `realityModernInput` | `mihomoRealityModernHosts` | пусто | multiline `host` / `host:port` / `[ipv6]:port`: только REALITY-узлы этих серверов получают `support-x25519mlkem768: true` + chrome fp (если не задан) и override-expr у провайдеров; пусто — legacy; только для совместимых серверов: X25519MLKEM768 появился в Xray v25.5.16, но сама версия не гарантирует совместимость (решение владельца A2) |
| 🚫 Exclude Filter | `excludeFilterInput` | `excludeFilter` | пусто | regexp/keyword `exclude-filter` в КАЖДЫЙ http-provider (upstream-паритет); только режим URL-подписок; пусто — поле не добавляется; сериализация цитирования покрыта source-тестами |
| Промежуточный proxy / dialer-proxy | `wgDialerInput` | `wgDialerProxy` | пусто | `dialer-proxy` на всех wireguard-профилях (см. секцию ниже); пусто — поле не добавляется (byte-parity) |
| Транзитные узлы dialer-группы | `wgDialerMembers` | `wgDialerGroupMembers` | пусто | авторская select-группа (имя из `wgDialerInput` или `WARP-DIALER`) перед остальными группами; узлы-участники сами не получают `dialer-proxy` |
| URL-подписки для dialer-группы | `wgDialerProviders` | `wgDialerProviders` | пусто | группа получает `use:` на СУЩЕСТВУЮЩИЕ proxy-providers (URL должен совпадать с одной из URL-подписок); узлы не разворачиваются; режим C ниже |
| 🛡️ TUN Interface | `cfgTun` | `addTun` | ☑ | секция `tun:` (mitun0, default mips / снят чекбокс → gvisor, `auto-route: false`) |
| ⚡ MIPS stack для TUN | `cfgTunMips` | `mihomoTunStack` | ☑ | `stack: mips`; снят → `gvisor`; Mihomo >= 1.19.31 (показывается в Compatibility Summary); требует `cfgTun`; продуктовый дефолт (NIGHT-09) |
| ⚙ Расширенный TUN stack | `cfgTunStackAdvanced` + `cfgTunStackEx` | `mihomoTunStack` | ☐/— | `system`/`mixed` внутри ADVANCED-секции («Расширенные настройки»); override снимает MIPS; невалидное значение → gvisor; Mihomo >= 1.19.31 |
| 🧩 Расширенный режим: отдельный вход | `cfgPerProxyMaster` | — | ☐ | защитная крышка; OFF → оба child выключены и сброшены; скрыт в БС-режиме |
| 🔒 TUN на каждый прокси | `cfgPerProxyTun` | `mihomoPerProxyTun` | ☐ | TUN-листенеры по одному на прокси/группу; требует `cfgPerProxyMaster` + `cfgTun`; скрыт в БС-режиме |
| 🔌 SOCKS-порт на каждый прокси | `cfgPerProxySocks` | `perProxyPort` | ☐ | `listeners: socks-<имя>` на портах 7890+i, `mixed-port` убирается; требует `cfgPerProxyMaster` + `cfgSocks`; скрыт в БС-режиме; static-листья чекаются скрытой группой «🌐 static-health» |
| 🏓 Ping server | `pingSelect` | `urlTest` | Google | `url`/`expected-status` url-test группы и health-check провайдеров |
| 🎯 Профиль развёртывания | `cfgProfile` | — (пост-патч страницы) | Универсальный | при «VPS Gateway» — gateway-постпатч YAML; подробно [VPS-GATEWAY.md](VPS-GATEWAY.md) |

Для Selective Modern REALITY реальная handshake-матрица (Xray + Mihomo + ML-KEM-capable TLS target)
описана в [TESTING.md](TESTING.md#selective-modern-reality-реальный-handshake-e2e--2026-09-18).
Версия Xray сама по себе не считается гарантией совместимости.

### Web UI / external-controller

Штатная схема проекта предполагает, что `external-controller` доступен внутри доверенной
локальной среды роутера. Поэтому пустой `secret:` в генерируемом YAML — намеренная и
допустимая конфигурация проекта. `external-controller: 0.0.0.0:9090` означает bind на
интерфейсы устройства, но сам по себе не доказывает публикацию controller в Интернет:
граница доступа задаётся маршрутизацией/firewall/NAT самого устройства. Если оператор
явно пробрасывает 9090 на WAN, публикует controller через reverse proxy или использует
другую внешнюю топологию, защита этого доступа становится отдельной обязанностью такой
топологии. Генератор не трактует пустой `secret` как ошибку или предупреждение без
доказанной внешней экспозиции.

Зависимости UI (группа «Отдельный вход на каждый прокси»): «⚡ MIPS stack для TUN» и
«🔒 TUN на каждый прокси» включаемы только при `cfgTun`, «🔌 SOCKS-порт на каждый прокси» —
только при `cfgSocks`; выключение родителя отключает и сбрасывает зависимую опцию
(`updateMihomoOptionStates()`). `buildMihomo()` не доверяет DOM и повторно клампит те же
зависимости (fail-safe против прямой подмены DOM): при `addTun=false` — `mihomoPerProxyTun=false`
и `mihomoTunStack=gvisor`, при `addSocks=false` — `perProxyPort=false`.

Дефолты UI после v1.4.0: `cfgTun` и `cfgTunMips` в HTML стоят `checked`, поэтому
обычный пользовательский TUN генерируется со `stack: mips`. Снятие MIPS переключает
его на `gvisor`. Расширенный Per-Proxy master и обе дочерние Per-Proxy опции по умолчанию
выключены; `system`/`mixed` доступны только через отдельную расширенную крышку.

Ограничение рантайма: нужен хотя бы один inbound — при `addSocks=false` и `addTun=false`
ошибка «Mihomo: enable at least one inbound (TUN or SOCKS5)». Пустой ввод без wgBeans —
«No valid links or profiles provided». В обычном Builder режиме URL-подписок без хотя бы одного HTTP(S) URL runtime возвращает
«Provide one or more HTTP(S) URLs…», а UI переводит это в понятную подсказку:
«Режим „URL-подписки“ включён, но URL подписки не найден…». Это важная UX-граница:
режим включён по умолчанию, поэтому при вводе только обычных proxy-ссылок его следует выключить.

## Базовый шаблон YAML

Всегда присутствует (`MIHOMO_DEFAULT_TEMPLATE` рантайма):

```yaml
mixed-port: 7890          # убирается режимом «SOCKS-порт на каждый прокси»
allow-lan: false          # страница патчит на true + bind-address: "*"
tcp-concurrent: true
mode: rule
log-level: warning
ipv6: false
unified-delay: true
profile:
  store-selected: true
  store-fake-ip: true
proxy-groups: …
rules:
  - "MATCH,GLOBAL"        # единственное правило: всё в группу GLOBAL
```

Production-дефолт — `warning`: обычные успешные TCP/UDP-соединения уровня `info` не
записываются, но предупреждения и ошибки остаются видимыми. Это особенно важно для VPS, где
stdout/stderr Mihomo перенаправляется в постоянный файл: `info` может создавать строку на каждое
соединение и без внешней ротации раздувать лог до гигабайтов. Поддерживаемые Mihomo уровни:
`silent`, `error`, `warning`, `info`, `debug`. Для временной диагностики уровень можно
вручную повысить до `info` или `debug`, но production output генератора использует `warning`.

## Proxy-groups (обычный режим, ссылки)

- ≤1 прокси: `GLOBAL` (select) = [прокси, REJECT].
- ≥2 прокси: `"⚡ Fastest"` (url-test: `url` = выбранный health-check, `interval: 300`
  секунд, `expected-status: 204/200`) + `GLOBAL` (select) = ["⚡ Fastest", все прокси, REJECT].
- Режимы «на каждый прокси» («TUN на каждый прокси» и/или «SOCKS-порт на каждый прокси»):
  на каждый прокси — select группа `🔒 <имя>` = [прокси, REJECT]; `GLOBAL` = [все `🔒`-группы, REJECT].

Режим «Использовать URL-подписки» (технически Sub Mode): вместо `proxies` в группах — `use:` на провайдеров; группы `SUB-<провайдер>`
в режимах «на каждый прокси»; `⚡ Fastest` с `tolerance: 50` и `empty-fallback: REJECT`.

## TUN: два режима

С ревизии v1.19.31 checkbox `cfgTunMips` передаёт `options.mihomoTunStack`.
В текущем продукте (v1.4.0+) он **включён по умолчанию**, поэтому UI передаёт `mips`
для обычного TUN, Per-Proxy TUN и VPS Gateway. Снятие checkbox даёт `gvisor`.
**MIPS — TUN stack, не CPU architecture; требуется Mihomo >= 1.19.31.**
На уровне engine API отсутствие значения по-прежнему нормализуется в безопасный
`gvisor`; это fallback API, а не пользовательский UI-default. Явные `mips`,
`gvisor`, `system` и `mixed` принимаются текущим runtime; произвольное неизвестное
значение engine отклоняет как `invalid TUN stack`. UI дополнительно не даёт штатно
передать произвольную строку. Новая опция сама по себе TUN не включает. Прямой `buildMihomoYaml` принимает `opts.tun.stack` с тем же
engine fallback. Обоснование по исходникам — [аудит](AUDIT-MIHOMO-1.19.31.md).

- Обычный (`addTun`): при UI-дефолтах `tun: { enable: true, stack: mips, auto-route: false,
  auto-detect-interface: true, device: mitun0 }`. `auto-route: false` принципиален —
  конфиги вставляются в окружения (роутеры), где захват всех маршрутов недопустим.
  Снятие MIPS checkbox переключает только стек на `gvisor`.
- TUN на каждый прокси (техн. Per-Proxy TUN; `addTun` + `mihomoPerProxyTun`): отдельные
  tun-листенеры в секции `listeners`: `mihomo-tun-N` (device `mitunN`, default mips / снят чекбокс → gvisor,
  `auto-route: false`, `auto-detect-interface: false`, `inet4-address: 198.19.x.y/30`), каждый с
  `proxy:` на свою `🔒`-группу / `SUB-`-группу.
- Профиль VPS Gateway (opt-in, селектор «Профиль развёртывания»): пост-патч поверх
  готового YAML — основная секция `tun:` получает `device: tun-mihomo`, выбранный stack,
  `auto-route: false`, `auto-detect-interface: true`, `mtu` и `gso`; добавляются
  `find-process-mode: off`, `profile.store-*: false` и опциональная секция `dns:` (fake-ip).
  Для целевого Mihomo 1.19.31 top-level `tun.inet4-address` намеренно не генерируется:
  effective IPv4-префикс TUN определяется через `dns.fake-ip-range`. По умолчанию профиль
  выключен и на Generic-вывод не влияет; подробно — [VPS-GATEWAY.md](VPS-GATEWAY.md).

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

## dialer-proxy: туннель в туннеле (WireGuard/WARP через промежуточный proxy)

> Короткая пользовательская инструкция: [GENERATOR-GUIDE.md](GENERATOR-GUIDE.md). Автоматизированные полевые измерения: `tools/warp-dialer-fieldtest/`.

Начиная с этой версии Builder умеет штатное поле Mihomo `dialer-proxy`: WireGuard/WARP-outbound устанавливает своё UDP-соединение с сервером (например, Cloudflare) **через другой proxy или группу**, оставаясь обычным outbound текущего конфига. Это программный аналог WireGuard-over-WireGuard, который уже работает на Keenetic (SE2 → WARP) с MTU ≈ 1200.

```text
Mihomo (VPS SE)
  ├─ WARP (wireguard outbound) ──dialer-proxy──▶ WARP-DIALER (select: VPS-DK / VPS-EE / …)
  └─ обычный трафик ──▶ GLOBAL
WARP-dial → VPS-DK → [сеть DK] → Cloudflare WARP endpoint → Интернет
```

Отличие от обычного multi-hop: при multi-hop трафик идёт `VPS A → VPS B → Mihomo B → WARP B`, а здесь WARP остаётся outbound **текущего** Mihomo, и через промежуточный proxy идёт только его туннельное UDP-соединение. Сайты по-прежнему видят Cloudflare WARP; меняется только сеть, из которой WARP «выходит» на Cloudflare.

### Режимы

- **A — имя proxy/группы**: в поле `wgDialerInput` указывается существующее имя (`VPS-DK` или группа). Значение должно существовать в итоговом YAML — иначе runtime и валидатор отклоняют сборку (зеркалирует статическую проверку Mihomo: `dialer-proxy [Y] not found`).
- **B — авторская группа**: заполняется список транзитных узлов; Builder сам создаёт `select`-группу (имя из поля выше или `WARP-DIALER`) и добавляет `dialer-proxy`. Транспорт WARP меняется выбором в группе/дашборде без пересборки WARP-outbound.
- **C — provider-backed группа (`use:`)**: перечисляются URL уже введённых URL-подписок (строго те же строки) — Builder создаёт `select`-группу с `use:` на соответствующие proxy-providers (например `account.geodema.org`), не разворачивая содержимое подписки. Провайдер-ноды по построению не могут попасть в статические `proxies:` группы, поэтому группа не может содержать сам WARP. **Состав подписки на этапе генерации неизвестен — UDP-совместимость узлов не проверяется и не гарантируется**: для WireGuard dialer пользователь вручную выбирает в группе узел с поддержкой UDP relay; TCP-only узел приводит к ошибке соединения. Валидатор страницы предупреждает об этом для каждой provider-backed dialer-группы.

### Правила применения и защита от циклов (dependency graph)

- `dialer-proxy` получают **все** wireguard-профили, кроме: (1) совпадающих по имени с таргетом (self) и (2) перечисленных в списке участников группы — транзитные узлы обязаны диалить напрямую, иначе возникает dial-цикл, который статический валидатор Mihomo **не** ловит (он проверяет только прямые рёбра `proxy → dialer`).
- **WireGuard-over-WireGuard разрешён**: цепочки `WG-A → WG-B`, `WG-A → WG-B → WG-C`, `WG-A → группа → WG-B → группа → WG-C` валидны, если маршрут хендшейка нигде не возвращается к исходному outbound. Оба WARP-профиля остаются независимыми (свои ключи, endpoint, tunnel IP); `dialer-proxy` ссылается на отдельный полноценный outbound по имени и не смешивает профили.
- **Циклы запрещены (dependency graph)**: сборка и валидатор страницы анализируют полный граф — dialer-рёбра, статическое членство групп и provider `use:` (провайдер с `override.dialer-proxy` даёт ребро; без override — тупик, статически безопасный). Маршрут, возвращающийся к старту (`WG-A → WG-A`, `WG-A → WG-B → WG-A`, `WG-A → группа → WG-A`, цикл через две группы или provider override) — ошибка сборки / `INVALID`. Ядро Mihomo ловит только прямые рёбра — наш детектор строже (fail-closed): например `WG-A → GLOBAL` отвергается, потому что GLOBAL содержит сам WARP.
- Self-reference, неизвестный таргет/участник и конфликт имени группы отклоняются с понятной ошибкой ещё на сборке; валидатор страницы дополнительно помечает `INVALID` таргет-призраки в итоговом YAML (в том числе после ручных правок).
- Таргет `GLOBAL`/`⚡ Fastest` — предупреждение валидатора: эти группы содержат сам WARP, и при выборе WARP внутри группы возникает цикл на dial. Валидатор также предупреждает о TCP-only таргетах (`http`): WireGuard/hy2/tuic через них не работают — UDP-релей у таргета обязателен.

## Конфигурация Mihomo как ориентированный граф (dialer-proxy model)

Модель валидации dialer-конфигураций — не «типы протоколов», а структура зависимостей.
Централизованная реализация — в рантайме (`web4core.analyzeDialerGraph(doc)`); генератор и
валидатор страницы используют один и тот же код (в builder-гейте — fail-closed на сборке,
в валидаторе — ERROR/WARNING по итогам анализа итогового YAML).

- **Вершины**: proxies, proxy-groups, proxy-providers, DIRECT/REJECT.
- **Рёбра**: `dialer-proxy` (proxy → proxy/group); `proxies:` (группа → член); `use:`
  (группа → провайдер); провайдер с `override.dialer-proxy` даёт ребро от себя.
  Смешанная группа (`proxies:` + `use:` одновременно) вносит **обе** категории рёбер.
- **valid path**: любой маршрут хендшейка, не возвращающийся к исходному outbound.
  `WG-A → WG-B → DIRECT`, `WG-A → WG-B → WG-C`, `WG-A → select-group → WG-B`,
  `WG-A → static group → TUIC`, `WG-A → provider-backed group` — всё валидно.
- **cycle**: маршрут, возвращающийся к старту (`WG-A → WG-A`, через прокси-цепочку,
  через одну группу или через две) — ERROR сборки / INVALID валидатора с полным путём
  вида `WG-A → WARP-DIALER → WG-B → WG-A` (не просто «cycle detected»).
- **dynamic provider**: провайдер в dialer-группе без `override.dialer-proxy` не даёт
  статического ребра. Его содержимое на этапе генерации неизвестно, поэтому ветвь
  помечается **dynamic/unknown**: статически цикл не доказан и не исключён. Это
  предупреждение, а не ошибка и не утверждение «cycle impossible»; UDP-совместимость
  удалённых узлов не проверяется в принципе и остаётся полевым тестом.

Предел статической проверки: ядро Mihomo v1.19.31 ловит только прямые dialer-рёбра;
модель проекта строже (ходит по членству групп и провайдерам), но провайдерные ветви
без override принципиально недоказуемы статически — они помечаются, а не разрешаются.
### MTU

Без явного `mtu` Mihomo использует **1408** (wireguard.go v1.19.31). Во вложенном туннеле добавляется overhead промежуточного транспорта, поэтому для WARP-over-dialer рекомендуется явный `MTU = 1200–1280` в .conf (на Keenetic-аналоге используется ≈1200). Генератор MTU не меняет сам — валидатор лишь предупреждает, если у wireguard с `dialer-proxy` MTU не задан или выше 1300.

### Проверено

- Исходники Mihomo **v1.19.31**: `dialer-proxy` — поле `BasicOption`, у wireguard применяется к bind-dialer (`adapter/outbound/base.go:199,212`, `wireguard.go:369`); UDP-хендшейк идёт через `proxyDialer.listenPacket` (UDP-релей таргета); статические проверки — `config/utils.go:148` (существование таргета + DFS по прямым рёбрам).
- `mihomo -t`: позитивы (имя proxy и авторская группа) — successful; негативы (несуществующий таргет) отвергаются ядром — статическая валидация Builder зеркалит ядро.
- `mihomo -t`: provider-backed группа (`use:`, один и два провайдера) — successful; `use:` с несуществующим провайдером отвергается ядром — статическая валидация Builder зеркалит ядро.
- Полевые измерения: `tools/warp-dialer-fieldtest/` — автоматизированный harness (sweep узлов транспортной группы, switchtest, MTU-лестница, WARP-over-WARP); методика, ловушка PIN и ограничения — README инструмента.
- Переключение узла в dialer-группе не пересоздаёт установленный WG-хендшейк немедленно: в поле старый transport path сохранялся более 150 секунд (SE VPS, 2026-10-01). Чистая смена пути — reload конфига (fresh handshake); учтено в harness (`--fresh-handshake`) и в UI-подсказке.
- Живая механическая цепочка двух локальных инстансов v1.19.31 (TARGET/socks5 через dialer-proxy → второй инстанс): сквозной HTTPS-трафик проходит; негативный контроль (dialer на мёртвом порту) блокирует трафик полностью. Полная WARP-цепочка (UDP-хендшейк через удалённый VPS) — полевой тест: см. WARPSCOUT-VPS.md.

## Сводка требований используемых функций

После успешной сборки UI анализирует **финальный YAML** и, если в нём есть функции с
особыми требованиями, показывает отдельный неблокирующий блок
«🧩 Требования используемых функций». Сводка не меняет YAML, не влияет на validator
state и не блокирует Copy. Если специальных требований нет, блок скрыт.

Сейчас определяются:

- `stack: mips` в обычном TUN или TUN-listener → Mihomo >= 1.19.31;
- `amnezia-wg-option.version: 3` → AWG 3.1, Mihomo >= 1.19.30;
- provider `override.override-expr` → Mihomo >= 1.19.29;
- `support-x25519mlkem768: true` в static REALITY или provider override-expr →
  предупреждение о selective Modern REALITY: Xray v25.5.16 является проверенной
  рабочей точкой лаборатории, но версия сама по себе не гарантирует совместимость;
- `mieru` и `trusttunnel` → пометка экспериментального пути генератора.

Сводка строится по фактическому результату, а не по одному состоянию checkbox: поэтому
отключённая/клампнутая функция в неё не попадает. При изменении любого входа блок
сбрасывается вместе с результатом валидации и появляется снова только после Build.
## Выходной YAML и pre-copy валидатор

Поле `Mihomo YAML` — **readonly preview**, а не второй редактор конфигурации. Изменения вносятся только через входные данные и настройки Builder, после чего нужно заново выполнить Build Config. Это сохраняет один источник истины для генерации и валидации.

Полностью о проверке — [VALIDATION.md](VALIDATION.md).

### Pre-copy валидатор

После Build Config финальный YAML автоматически проверяется `validateMihomoYaml()`:

- **успех** → «⚠️ Базовая проверка пройдена. Это не эквивалент проверки mihomo -t.»,
  Copy YAML доступна; UI дополнительно напоминает команду финальной проверки и просит сохранить полный YAML + полный вывод `mihomo -t`, если ядро всё же отвергнет конфиг;
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
