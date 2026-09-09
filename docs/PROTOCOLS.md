# PROTOCOLS — протоколы: вход → bean → Mihomo

Актуальная таблица по фактическому коду `main` (существенно пересмотрена 2026-09-09: форматы AWG 1.5/2.0/3.1, матрица версий mihomo). Источники: `SUPPORTED_SCHEMES`
и `CORE_PROTOCOL_SUPPORT.mihomo.base` в `web4core.runtime.js`, парсеры/строители там же,
проверки живым прогоном (`buildFromRequest`, core mihomo). Различать два уровня
поддержки:

- **парсится рантаймом** (`SUPPORTED_SCHEMES`, 20 схем): ссылка превращается в bean;
- **принимается ядром mihomo** (`CORE_PROTOCOL_SUPPORT.mihomo.base`, 13 proto): bean может
  попасть в mihomo-YAML. Между списками есть зазор — см. «Зазор SUPPORTED ↔ CORE».

## Таблица: схема входа → bean.proto → mihomo `type`

| Схема входа | bean.proto | mihomo `type` | Ключевые поля вывода / особенности |
|---|---|---|---|
| `vless://` | `vless` | `vless` | uuid, `encryption: none`, flow; flow=vision → `udp: true`; TLS/Reality (`reality-opts`), transport (`network`) |
| `vmess://` | `vmess` | `vmess` | uuid, `cipher` (дефолт auto), `alterId: 0`; `packet-addr` при packet-encoding |
| `trojan://` | `trojan` | `trojan` | password, TLS (обязателен по природе), `sni`+`servername` |
| `ss://` | `ss` | `ss` | cipher+password, plugin/plugin-opts, smux |
| `anytls://` | `anytls` | `anytls` | password, `idle-session-*`, `disable-reuse`; в UI-хинте не упомянут, но поддерживается |
| `hy2://`, `hysteria2://` | `hy2` | `hysteria2` | password, obfs(+password), hop-порты (`ports`, `hop-interval`), `bbr-profile`, `udp-mtu` |
| `tuic://` | `tuic` | `tuic` | uuid+password или token; `congestion-controller`, `udp-relay-mode`, `reduce-rtt` |
| `socks://`, `socks5://`, `socks5h://`, `socks4a://` | `socks` | `socks5` | username/password. **`socks4://` → ошибка «Mihomo does not support: socks4»** (проверено) |
| `http://`, `https://` | `http` | `http` | username/password; `https` → TLS-поля. ⚠️ тот же синтаксис, что у подписок — см. ниже |
| `mieru://`, `mierus://` | `mieru` | `mieru` | **обязателен userinfo** (`user:pass@`, иначе «mieru: missing username/password»); `transport` (дефолт TCP, только TCP/UDP — кейс `TPC`), `port-range` из `server_ports`, multiplexing/handshake-mode/traffic-pattern |
| `masque://` | `masque` | `masque` | private-key/public-key, `ip`, sni, `udp`, `remote-dns-resolve`+`dns`, `network: h2`; формат — контракт этого же генератора (вкладка 1) |
| `tt://` (TrustTunnel) | `trusttunnel` | `trusttunnel` | ссылка = `tt://?<base64-payload>[&query]`; username/password, ECH (`ech-opts`), `quic`, `congestion-controller`, bbr |
| `sdns://` | `sdns` | — | парсится, но **mihomo: «Mihomo does not support: sdns»** (sing-box extended-only); в mihomo-YAML не попадает никогда |
| `socks4://` | — | — | парсится, отклоняется на этапе сборки (см. выше) |
| `hysteria://` (v1) | — | — | **не поддерживается нигде**: схемы нет в `SUPPORTED_SCHEMES` → «Unknown link: hysteria» (проверено) |
| `.conf` / `.wg` / `.awg` (файлы) | `wireguard` | `wireguard` | см. отдельный раздел ниже |

## HTTP(S) URL: ссылка против подписки

Один и тот же синтаксис означает разное в зависимости от режима:

- **Sub Mode** (по умолчанию включён): URL **без** user:password → подписка →
  `proxy-providers` (скачивает Mihomo, не браузер); URL **с** кредами и все не-URL строки →
  обычные ссылки. Без хотя бы одного URL — ошибка «Provide one or more HTTP(S) URLs…».
- **обычный режим**: http(s)-URL парсится как ссылка на http-прокси (проверено:
  `https://sub.example.com/list` → `type: http, name: proxy`) — т.е. мусор. Подписки
  имеет смысл вставлять только в Sub Mode.

## WireGuard / AmneziaWG

Файлы `.conf`/`.wg`/`.awg` → `parseWireGuardConf()` → bean `wireguard` → `type: wireguard`:

- `[Interface]`: PrivateKey, Address (IPv4/IPv6 разделяются; без IPv6-адреса IPv6-AllowedIPs
  отбрасываются, прокси получает `ip-version: ipv4` — поведение рантайма, намеренное: без
  IPv6-адреса в туннеле маршрут `::/0` всё равно нерабочий), DNS, MTU; структурные ключи
  wg-quick (`ListenPort`, `Table`, `PreUp/PostUp`, `SaveConfig`, …) игнорируются сознательно;
- `[Peer]` (берётся первый): PublicKey, PresharedKey, AllowedIPs, Endpoint → server:port,
  PersistentKeepalive (диапазоны сворачивает локальный `normalizeWgText`), Reserved
  (csv-числа 0–255 или строка);
- AmneziaWG-параметры → `amnezia-wg-option` (passthrough в YAML): `jc, jmin, jmax, s1–s4,
  h1–h4, i1–i5, j1–j3, itime, version, header-protection-key, content-padding-addition,
  rekey-after-time, rekey-timeout, reject-after-time, keepalive-timeout,
  max-handshake-attempts, random-trailers, disable-cookies`;
- `dns`/`remote-dns-resolve` в wireguard-прокси добавляет локальный `injectWgDns` из поля
  «WireGuard DNS» (детали — [DATAFLOW.md](DATAFLOW.md)).

### Форматы значений AWG (1.5 / 2.0 / 3.1)

Актуальная версия протокола — 3.1 (docs.amnezia.org, «AmneziaWG 3.1»); поле `Version` в
`.conf` не пишется. Реальные self-hosted-конфиги двух семейств: **Amnezia Premium** —
`H1–H4` диапазонами + `I1–I5` (CPS-теги `<b 0x…><rc n><t><r n>`), без 3.1-полей;
**Amnezia self-hosted 3.1** — одиночные `H1–H4` + `HeaderProtectionKey` + диапазонные
таймеры + `RandomTrailers`/`DisableCookies`.

- Диапазоны `lo-hi` легальны для `H1–H4` и шести параметров 3.x: `content-padding-addition`,
  `rekey-after-time`, `rekey-timeout`, `reject-after-time`, `keepalive-timeout`,
  `max-handshake-attempts`. Mihomo держит эти ключи строками, v3-движок парсит их как
  UintRange — passthrough без преобразований;
- `random-trailers`/`disable-cookies` — булевы. Официальный формат литералов — `on`/`off`,
  парсер рантайма принимает только `1/true/yes/0/false/no`: локальный `normalizeWgText`
  сводит `on`/`off` к `1`/`0` до парсинга (до 2026-09-09 поля молча терялись; gap остаётся
  в апстриме — чистый фикс там);
- `PersistentKeepalive = 25-35` и range-значения int-полей mihomo (`jc/jmin/jmax/s1–s4/
  itime`, список `AWG_INT_KEYS`) сворачиваются к нижней границе: keepalive — односторонний
  тайминг, любая точка диапазона валидна; range-строка в int-поле уронила бы декодирование
  всего конфига mihomo (weakly-typed парсер читает только числа);
- `HeaderProtectionKey` (base64-ключ, mihomo сам переводит в hex) и `RandomTrailers` —
  «двусторонние» параметры: сервер с включённым HP/trailers отклоняет клиентов без них,
  поэтому потеря этих полей = нерабочий туннель.

### Требования к версии mihomo

| Набор в amnezia-wg-option | mihomo ≤ 1.19.29 | mihomo ≥ 1.19.30 (первая с AWG 3.1) |
|---|---|---|
| `jc…h4`, `i1–i5` (1.5/2.0 — Premium) | работает (legacy-движок) | работает: без 3.1-полей `version` не проставляется → legacy-движок |
| `version: 3` + HP/таймеры/булевы (3.1 self-hosted) | **все 3.1-ключи молча игнорируются** — туннель с HP/trailers не поднимется | работает (v3-движок `amneziav3`) |

Уровень уверенности этой таблицы — **совместимость по исходникам** (wireguard.go
v1.19.27/v1.19.30/Alpha + uapi.go/amneziawg-go: состав полей, типы, выбор движка), не
runtime-факт: фактический AWG-хендшейк против реального 3.1-сервера отдельно не
подтверждён (см. «Что не тестируется» в [TESTING.md](TESTING.md)).

`version: 3` в `.conf` не бывает: локальный `normalizeWgBeans` проставляет его при наличии
любого 3.x-поля (на mihomo ≤1.19.29 поле игнорируется безвредно). Импорт 3.1-конфига на
ядро старше 1.19.30 генератором не чинится — это свойство конкретной инсталляции.
Production runtime (официальный релиз MetaCubeX; на роутерах владельца v1.19.30) 3.1
поддерживает. Не смешивать три уровня версии: пакетная версия opkg (в entware-go
закоммичен `PKG_VERSION` последнего апстрим-синка, 1.19.27; CI при сборке подставляет
актуальную релизную версию эфемерно — релизные `.ipk` уже 1.19.30-1), источник
`keenetic-auto-setup` (install.sh берёт `.ipk` из релиза entware-go, update-mihomo.sh —
официальный бинарник MetaCubeX напрямую, мимо opkg) и фактический бинарник на устройстве
(`mihomo -v`) — после обновления через update-mihomo.sh opkg может показывать старую
версию пакета.

## Зазор SUPPORTED ↔ CORE (и UI-хинт)

- `SUPPORTED_SCHEMES` (парсится, 20): `vmess, vless, trojan, anytls, ss, socks, socks4,
  socks4a, socks5, socks5h, http, https, hy2, hysteria2, tuic, tt, mieru, mierus, sdns, masque`.
- `CORE_PROTOCOL_SUPPORT.mihomo.base` (попадает в mihomo-YAML, 13): `vmess, vless, trojan,
  anytls, ss, socks, http, hy2, tuic, wireguard, masque, mieru, trusttunnel`.
- Хинт в UI («Поддерживает: vless, vmess, trojan, ss, hy2, tuic, masque, mieru, tt, WG,
  HTTP(S) подписки») — сокращённый; фактический набор шире (anytls, socks-варианты, sdns
  с отказом и т.д.). При расхождении хинта с рантаймом источник истины — рантайм.
- Ядра sing-box/xray рантаймом поддерживаются (`buildSingBox*`, `buildXray*`), но UI
  собирает только `core: 'mihomo'` — это не «поддержка страницы».

## Через UI недоступно (возможности рантайма, не используемые страницей)

`fetchSubscription` (клиентское скачивание подписок с CORS-фолбэком), `validateBean`,
`computeTag`, `getAllowedCoreProtocols`, `buildBeansFromInput`, `buildMihomoProxy`,
`buildMihomoConfig`, `buildMihomoSubscriptionConfig`, `buildMihomoYaml`,
`buildSingBoxOutbound/Config`, `buildXrayOutbound/Config`, `URLTEST`. Не считать их
«фичами генератора», пока они не подключены в `index.html`.

## Связанные документы

Путь данных каждого входа — [DATAFLOW.md](DATAFLOW.md); параметры сборки — [MIHOMO.md](MIHOMO.md);
валидация типов/полей — [VALIDATION.md](VALIDATION.md).
