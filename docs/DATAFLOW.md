# DATAFLOW — прохождение данных

Описывает фактический путь данных через код (commit `f5ea0a3`). Имена функций — из кода;
`web4core.*` означает `web4core.runtime.js`, остальное — `index.html`. Схемы входов — в
[PROTOCOLS.md](PROTOCOLS.md), параметры Builder'а — в [MIHOMO.md](MIHOMO.md).

## Входы вкладки 2 (Mihomo Builder)

Три независимых источника, которые смешиваются при сборке:

| Вход | Как попадает | Куда идёт |
|---|---|---|
| Ссылки (`vmess://`, `vless://`, …) | textarea `#mihomoInput` | `web4core.buildBeansFromInput()` → beans |
| Подписки (HTTP(S) URL) | та же textarea, **только в Sub Mode** | `proxy-providers` в YAML (браузером не скачиваются) |
| Файлы `.conf` / `.wg` / `.awg` | `<input type="file" id="wgFile">`, multiple | `web4core.parseWireGuardConf()` → `wgBeans` |

В обычном (не Sub) режиме http(s)-URL в textarea трактуется как **ссылка на http-прокси**
(проверено: `https://sub.example.com/list` даёт прокси `type: http, name: proxy`) — то есть
мусор. Подписки имеют смысл только в Sub Mode: там URL без кредов уходит в провайдеры, а
URL **с** кредами и все не-URL строки парсятся как обычные ссылки
(`splitMihomoSubscriptionInput`).

## Beans — внутреннее представление

Каждая распарсенная ссылка/файл → bean (plain object):

```text
bean = {
  proto: 'vless' | 'vmess' | 'trojan' | 'ss' | 'http' | 'socks' | 'hy2' | 'tuic'
       | 'anytls' | 'wireguard' | 'mieru' | 'masque' | 'trusttunnel' | 'sdns',
  name, host, port,
  auth: { uuid | password | … },
  stream: { security, sni, alpn, fp, reality{pbk,sid,spx,pqv}, ech{…}, packet_encoding, … },
  <proto-specific>: wireguard{…} | mieru{…} | masque{…} | trusttunnel{…} | ss{…} | socks{…} | hysteria2{…} | tuic{…}
}
```

Перед сборкой каждый bean проходит `web4core.validateBean()` (наличие host/port,
корректность reserved и т.п.) и `assertCoreSupports(…, 'mihomo')` — проверку, что proto
входит в базовый набор mihomo (`vmess, vless, trojan, anytls, ss, socks, http, hy2, tuic,
wireguard, masque, mieru, trusttunnel`; `sdns` не входит → ошибка).

## Ссылка → bean → Mihomo proxy

`web4core.buildMihomoProxy(bean)` по `proto` строит узел `proxies` (полная таблица — в
[PROTOCOLS.md](PROTOCOLS.md)). Общие применения: `udp`/`udp-over-tcp`/`ip-version`,
TLS-блок (`tls`, `servername`/`sni`, `alpn`, `skip-cert-verify`, `client-fingerprint`,
`reality-opts`), `network`-транспорт. Дубликаты прокси дедуплицируются
(`deduplicateProxies`), коллизии имён гасятся суффиксами `-2`, `-3` (поэтому в
сгенерированном YAML дублей имён не бывает — валидатор ловит их только в ручных правках).

## Ссылки → YAML (обычный режим)

`buildMihomoConfig(beans, opts)` + `buildMihomoYaml(...)`:

```text
proxies        ← beans → buildMihomoProxy
proxy-groups   ← ≤1 прокси: GLOBAL select [прокси, REJECT]
                 ≥2:      "⚡ Fastest" url-test (url=urlTest, interval 300, expected-status)
                          + GLOBAL select ["⚡ Fastest", все прокси, REJECT]
                 per-proxy режим: "🔒 <имя>" select на каждый прокси + GLOBAL из них
rules          ← [ "MATCH,GLOBAL" ]   (единственное правило)
listeners      ← Per-Proxy SOCKS: socks-<имя> на портах 7890+i (тогда mixed-port убирается)
mixed-port     ← 7890, если Per-Proxy SOCKS выключен
```

Эмиссия YAML — собственный сериализатор рантайма `toYAML` (НЕ jsyaml): накладывает секции
на текстовый шаблон `MIHOMO_DEFAULT_TEMPLATE` (`overlayMihomoYaml`, секции через
`upsertSection`, поддерживает `__comments` → `#`-комментарии). Строковые скаляры
кавычируются выборочно — длинные base64-строки AWG проходят без переносов.

## Sub Mode → proxy-providers (подписки браузером НЕ скачиваются)

`buildMihomoSubscriptionConfig(subUrls, extraBeans, opts)`: для каждого URL создаётся
провайдер:

```yaml
proxy-providers:
  <имя-хоста>:
    type: http
    proxy: DIRECT
    header: { x-hwid: [<случайный hex32>] }   # generateSecretHex32, на каждую сборку новый
    url: <URL подписки>
    interval: 43200                            # 12 часов
    health-check: { enable: true, interval: 300, url: <urlTest>, expected-status: 204 }
```

Группы: `"⚡ Fastest"` (url-test) и `GLOBAL` ссылаются на провайдеров через `use:`; при
per-proxy режимах — группы `SUB-<провайдер>`. Скачивание подписки выполняет **сам Mihomo**
на устройстве пользователя, а не страница. Функция `web4core.fetchSubscription()` (браузерный
fetch с CORS-фолбэком через сторонний `sub.web2core.workers.dev`) в текущем UI **не
вызывается** — это важно для приватности, см. раздел «Сеть и приватность» ниже.

## WireGuard / AmneziaWG → YAML

Локальный конвейер (всё в `index.html`, шаги 1–2 и 4 — собственные патчи этого репо):

```text
1. normalizeWgText(text)          Реальные AWG-конфиги нескалярны: PersistentKeepalive
                                  = 25-35 (Premium и self-hosted 3.1) и булевы
                                  RandomTrailers/DisableCookies = on/off (официальный
                                  формат литералов AWG 3.1), а парсер рантайма понимает
                                  только скаляры и 1/true/yes-булевы → диапазон
                                  сворачивается к нижней границе, on/off → 1/0 ДО
                                  парсинга; заодно снимается UTF-8 BOM.
2. web4core.parseWireGuardConf()  [Interface]/[Peer] → bean proto 'wireguard':
                                  privateKey/publicKey/addresses/dns/mtu/persistentKeepalive,
                                  amnezia-wg-option (Jc…H4, I1–I5, version,
                                  header-protection-key, random-trailers, …),
                                  peers (endpoint→server:port, allowed-ips, reserved).
                                  IPv6: без IPv6-адреса AllowedIPs с «:» отбрасываются
                                  (ipVersion: 'ipv4') — поведение рантайма, намеренное.
3. normalizeWgBeans(wgBeans)      ЛОКАЛЬНЫЙ ПАТЧ, два правила:
                                  а) range-строки («10-20») на int-полях mihomo
                                     (jc/jmin/jmax/s1-s4/itime — AWG_INT_KEYS)
                                     сворачиваются к нижней границе: иначе weakly-typed
                                     декодер mihomo уронил бы декодирование ВСЕГО
                                     конфига;
                                  б) если в amnezia-wg-option есть любой 3.x-ключ
                                     (header-protection-key, content-padding-addition,
                                     rekey-*, random-trailers, …) и нет version →
                                     version: 3. Без этого mihomo ≥1.19.30 выбирает
                                     legacy-движок и 3.x-поля молча не работают.
4. buildMihomoProxy(wireguard)    type: wireguard + private-key/public-key/ip/ipv6/
                                  allowed-ips/mtu/persistent-keepalive/peers[+reserved]/
                                  amnezia-wg-option (passthrough).
5. injectWgDns(result, wgBeans)   ЛОКАЛЬНЫЙ ПАТЧ, после buildFromRequest: если задан
                                  #wgCustomDns — jsyaml.load YAML, всем wireguard-прокси
                                  ставится dns (+remote-dns-resolve), пустое поле — dns
                                  удаляется; повторный dump ОБЯЗАТЕЛЬНО с
                                  { lineWidth: -1 }, иначе jsyaml переносит длинные
                                  base64 I1–I5/H-строки и портит их.
```

DNS-перехват (16690f2): при загрузке файла, если в конфиге найден `100.64.0.1` (нестабильный
DNS Amnezia Premium), поле подставляет `1.1.1.1, 8.8.8.8` и показывает красное
предупреждение; иначе поле заполняется DNS из конфига. Без DNS в конфиге поле пустое →
шаг 5 удалит `dns` из прокси.

## Post-processing: точный порядок в `buildMihomo()`

```text
1. result = web4core.buildFromRequest({ core:'mihomo', input, wgBeans: normalizeWgBeans(wgBeans), options })
2. injectWgDns(result, wgBeans)                       # правка YAML (wireguard dns)
3. applyDeploymentProfile(yaml, profile)              # ТОЛЬКО при профиле «VPS Gateway» (opt-in):
                                                      #   gateway-постпатч tun/dns/find-process-mode/
                                                      #   profile; при generic НЕ вызывается —
                                                      #   см. VPS-GATEWAY.md
4. allow-lan патч: регэксп allow-lan: false → true
   + вставка bind-address: "*" сразу после            # привязан к текстовому формату рантайма:
   allow-lan: true (если bind-address ещё нет)        # смена формата ломает его молча — проверять
5. #mihomoOutput.value = yaml                          # итог показан
6. runMihomoValidation(yaml)                           # валидатор, см. VALIDATION.md
```

Валидатор работает **только с финальной строкой YAML после шагов 1–5**, а не с beans:
ошибка может появиться именно на этапе генерации (реальный кейс — `transport: TPC` у
Mieru, пришедший из пользовательской ссылки).

## Вкладка 1: YAML бота → masque://

`parseYaml()` (`jsyaml.loadAll`, ищет `proxies[0]` или объект с `private-key`, иначе
отказ) → поля формы → `generateWarp()` генерирует пары ссылок QUIC+H2 по DPI-стратегии
(фиксированный пул QUIC `162.159.198.1/2, 162.159.199.2:443`; H2 — IP из 198/199-подсетей,
взвешенные порты; анти-корреляция IP при совпадении портов; base64-ключи URL-энкодятся
`+ / =` → `%2B %2F %3D`) → `sendToMihomo()` кладёт их в `#mihomoInput` и вызывает сборку.
Формат ссылки — контракт, см. [AGENTS.md](../AGENTS.md) («Форматы входных данных и контракты»).

## Сеть и приватность

- Страница (`index.html`) не содержит `fetch`/`XMLHttpRequest`/`sendBeacon` и не пишет в
  localStorage/sessionStorage. Ключи, ссылки и сгенерированный YAML никуда не отправляются.
- С CDN jsdelivr грузится только `js-yaml@4.1.0` (код библиотеки, не данные).
- Подписки скачивает Mihomo на устройстве пользователя (proxy-providers), не браузер.
  `web4core.fetchSubscription()` — единственная функция рантайма, способная скачать текст
  подписки из браузера, и при неудаче прямого fetch она использует публичный CORS-прокси
  `sub.web2core.workers.dev` (инфраструктура апстрима web4core) — **в текущем UI не
  вызывается**. Если когда-нибудь понадобится клиентский fetch подписок — сначала решить,
  допустимо ли отдавать URL подписки стороннему воркеру.
- Буфер обмена (`navigator.clipboard.writeText`) — единственный «экспорт» данных.

## Связанные документы

Параметры сборки и структура YAML — [MIHOMO.md](MIHOMO.md); валидация —
[VALIDATION.md](VALIDATION.md); обновления рантайма — [UPDATES.md](UPDATES.md).
