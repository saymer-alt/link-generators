# PROTOCOLS — протоколы: вход → bean → Mihomo

Актуальная таблица по фактическому коду (commit `f5ea0a3`). Источники: `SUPPORTED_SCHEMES`
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
  отбрасываются — поведение рантайма), DNS, MTU;
- `[Peer]` (берётся первый): PublicKey, PresharedKey, AllowedIPs, Endpoint → server:port,
  PersistentKeepalive (диапазоны сворачивает локальный `normalizeWgText`), Reserved
  (csv-числа 0–255 или строка);
- AmneziaWG-параметры → `amnezia-wg-option` (passthrough в YAML): `jc, jmin, jmax, s1–s4,
  h1–h4, i1–i5, j1–j3, itime, version, header-protection-key, content-padding-addition,
  rekey-after-time, rekey-timeout, reject-after-time, keepalive-timeout,
  max-handshake-attempts, random-trailers, disable-cookies`. Числовые ключи парсятся как
  int (включая `version`), булевы (`random-trailers`, `disable-cookies`) — только
  `1/true/yes/0/false/no`: **написание `= on` (его генерирует веб web4core) молча
  теряется** — известный gap апстрима, чинить только через upstream, не локально;
- `version` в `.conf` не бывает: локальный `normalizeWgBeans` проставляет `version: 3`,
  если есть 3.x-поля (иначе mihomo включает legacy-движок и поля молча не работают);
- `dns`/`remote-dns-resolve` в wireguard-прокси добавляет локальный `injectWgDns` из поля
  «WireGuard DNS» (детали — [DATAFLOW.md](DATAFLOW.md)).

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
