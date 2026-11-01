# DATAFLOW — прохождение данных

## Автоматический режим белых списков (2026-09-15)

Контракт и точная структура YAML: [AUTO-WHITELIST.md](AUTO-WHITELIST.md).
UI передаёт опциональный `fallbackInput`; engine строит один плоский GLOBAL fallback
с конечными узлами primary → fallback, без DIRECT и вложенных групп (#2588). Выключенный режим сохраняет прежний путь.
Опции «на каждый прокси» и VPS исключаются независимо от скрытия UI; существующий validator
проверяет итоговый YAML. Runtime требуется с поддержкой нового generic API.


Описывает фактический путь данных через код, включая MIPS TUN (2026-09-15). Имена функций — из кода;
`web4core.*` означает `web4core.runtime.js`, остальное — `index.html`. Схемы входов — в
[PROTOCOLS.md](PROTOCOLS.md), параметры Builder'а — в [MIHOMO.md](MIHOMO.md).

## Входы вкладки 2 (Mihomo Builder)

Три независимых источника, которые смешиваются при сборке:

| Вход | Как попадает | Куда идёт |
|---|---|---|
| Ссылки (`vmess://`, `vless://`, …) | textarea `#mihomoInput` | `web4core.buildBeansFromInput()` → beans |
| Подписки (HTTP(S) URL) | та же textarea, любой режим | Sub Mode ON → `proxy-providers` (скачивает Mihomo); OFF → браузер читает подписку и встраивает текущие узлы в `proxies` |
| Файлы `.conf` / `.wg` / `.awg` | `<input type="file" id="wgFile">`, multiple | `web4core.parseWireGuardConf()` → `wgBeans` |

В обычном (не Sub) режиме http(s)-URL в textarea раньше трактовался как **ссылка на
http-прокси** (мусор). С subscription-inspection это исправлено: при Build без Sub Mode
страница один раз читает подписку (`web4core.fetchSubscription`, см. ниже), разворачивает
её в обычные proxy-links и передаёт их статическому builder'у — пользователь получает
актуальные `proxies:` вместо мусорного http-прокси. URL **с** кредами и все не-URL строки
парсятся как обычные ссылки. Если подписку прочитать не удалось, сборка в OFF-режиме
падает с понятной ошибкой (молча терять узлы нельзя); в ON-режиме (provider) неудача
preview не мешает сборке.

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
listeners      ← «SOCKS-порт на каждый прокси»: socks-<имя> на портах 7890+i (тогда mixed-port убирается)
mixed-port     ← 7890, если «SOCKS-порт на каждый прокси» выключен
```

Эмиссия YAML — собственный сериализатор рантайма `toYAML` (НЕ jsyaml): накладывает секции
на текстовый шаблон `MIHOMO_DEFAULT_TEMPLATE` (`overlayMihomoYaml`, секции через
`upsertSection`, поддерживает `__comments` → `#`-комментарии). Строковые скаляры
кавычируются выборочно — длинные base64-строки AWG проходят без переносов.

## Sub Mode ON → proxy-providers (обновление делает Mihomo)

`buildMihomoSubscriptionConfig(subUrls, extraBeans, opts)` выдаёт
`proxy-providers`. Для одного локального проекта **v1** выбранное логическое
устройство имеет **один стабильный HWID**, повторно применяемый к каждому
требующему его provider. **Это не новый случайный HWID при каждом Build.**

```yaml
proxy-providers:
  example:
    type: http
    proxy: DIRECT                 # служебная загрузка подписки Mihomo, не user-egress
    header:
      x-hwid:
        - "<стабильный-HWID-устройства>"
    url: "https://example.invalid/subscription"
    interval: 43200
    health-check:
      enable: true
      interval: 300
      url: "https://www.gstatic.com/generate_204"
      expected-status: 204
```

Имя provider может быть задано директивой `# provider-name: Имя` перед его
HTTP(S) URL (пустая/повторная директива ошибочна); без имени применяется
автоимя. При опциональном переносимом проекте **v2** список источников
содержит стабильные `sourceId` и индивидуальные `providerOverrides`:
у каждой подписки свой закреплённый HWID (в заголовке `x-hwid`) или **без
этого заголовка** для открытого источника. Build проверяет соответствие
назначений итоговому YAML и не перезаписывает локальный реестр устройств.
Схемы и пользовательская инструкция: [SUBSCRIPTIONS-AND-HWID.md](SUBSCRIPTIONS-AND-HWID.md).

Группы `"⚡ Fastest"` (url-test) и `GLOBAL` используют providers через
`use:`; в per-proxy режимах создаются группы `SUB-<провайдер>`.
`proxy: DIRECT` нужен для загрузки подписки до поднятия туннелей и
**не является** разрешением на прямой пользовательский egress с публичного VPS
(задача #286 не входит в релиз v1.12.0).

**Когда браузер действительно делает fetch подписки:**

- **Sub Mode ON:** `Build` формирует provider-YAML **без** запроса за списком
  имён. Только явное «📋 Показать серверы подписки» + «📋 Получить список»
  запускает Preview. «⏹ Пропустить»/тайм-аут прекращает цепочку direct/Worker;
  результат UNKNOWN — не ноль, Build не блокируется из-за отсутствия списка.
- **Sub Mode OFF:** при Build браузер должен скачать HTTP(S)-подписку и
  развернуть её узлы в статический `proxies:`. Сбой такого fetch блокирует Build
  с ошибкой: иначе узлы потерялись бы молча.

**Идентичность Preview:** в обычном v1 заголовок `x-hwid` связан с
активным логическим устройством из
`localStorage['link-generators.device-identities.v1']`; прежний ключ
`subscription-preview-hwid.v1` используется лишь для миграции, а не как
отдельный независимый HWID для каждого provider. `x-device-model` —
пользовательское имя или fallback `Saymer Link Generators Preview`.
В переносимом v2 Preview использует HWID соответствующей подписки;
строгий remote Preview требует подтверждённой политики Worker
`strict-same-origin-v1`. На дату выпуска v1.12.0 она ещё не была
развёрнута, поэтому неподтверждённый путь **отказывает fail-closed**.
Сетевые пути, ограничения приватности и ручной импорт имён — ниже.

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

Выбор TUN stack передаётся до сериализации YAML:

```text
cfgTunMips → tunStack → options.mihomoTunStack → buildFromRequest
policyCards → collectPolicyRouting() → options.mihomoDomainPolicy → buildFromRequest (inline rule-providers + policy groups + RULE-SET rules; выключено → byte-parity)
#cfgProfile=vps-gateway + #vpsDnsEnabled → applyDeploymentProfile() → tun.dns-hijack + profile.store-fake-ip + sniffer (VPS Domain Detection Package; router/vps-local не затрагиваются)
          → mihomoTunOpts.stack → opts.tun.stack в buildMihomoYaml
          → normal TUN / Per-Proxy listeners
```

Checkbox MIPS включён по умолчанию (NIGHT-09): `tunStack = 'mips'`; снят — `'gvisor'`.
Расширенные значения `system`/`mixed` — только через крышку `cfgTunStackAdvanced`
(+`cfgTunStackEx`); активный override снимает MIPS-чекбокс, невалидное значение
подменённого DOM откатывается к gvisor/mips.
До сборки `buildMihomo()` клампит опции по UI-зависимостям, не доверяя DOM:
`addTun=false` → `perProxyTun=false` и `tunStack='gvisor'`; `addSocks=false` →
`perProxySocks=false`; БС-режим дополнительно исключает оба режима «на каждый прокси».
Runtime (с NIGHT-02) валидирует стек через `resolveMihomoTunStack`: допустимы
`gvisor|system|mixed|mips`, невалидное значение — ошибка (не silent fallback).
Выбор стека сам по себе TUN не включает.
VPS получает тот же `tunStack` третьим аргументом ниже: штатный UI передаёт
`mips` по умолчанию, а `gvisor` остаётся fallback функции на случай отсутствующего
явного значения.

```text
1. result = web4core.buildFromRequest({ core:'mihomo', input, wgBeans: normalizeWgBeans(wgBeans), options })
2. injectWgDns(result, wgBeans)                       # правка YAML (wireguard dns)
3. applyDeploymentProfile(yaml, profile, tunStack)    # ТОЛЬКО при профиле «VPS Gateway» (vps-gateway):
                                                      #   gateway-постпатч tun/dns/find-process-mode/
                                                      #   profile; при router/vps-local НЕ вызывается —
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

## Вкладка 1: YAML бота → WARP identity → masque://

Здесь намеренно разделены **identity** и **transport**.

`parseYaml()` (`jsyaml.loadAll`, ищет `proxies[0]` или объект с `private-key`, иначе
отказ) читает из YAML Telegram-бота только параметры зарегистрированного WARP-профиля,
которые заполняют форму: `private-key`, `public-key`, `ip`, `ipv6`, `sni`, `dns`.
Поля источника `server`, `port` и `network` не являются входом транспортной стратегии
существующего Telegram-сценария. Это сознательное поведение, а не потеря данных парсером.

Дальше `generateWarp()` сам выбирает transport endpoint'ы и генерирует пары ссылок QUIC+H2
по DPI-стратегии: фиксированный пул QUIC `162.159.198.1/2, 162.159.199.2:443`; H2 — IP
из 198/199-подсетей, взвешенные порты; анти-корреляция IP при совпадении портов;
base64-ключи URL-энкодятся `+ / =` → `%2B %2F %3D`.
`sendToMihomo()` кладёт результат в `#mihomoInput` и вызывает сборку.

Поток данных:

```text
Telegram WARP YAML
        │
        │ identity/tunnel parameters only
        ▼
parseYaml()
        ├─ private-key / public-key
        ├─ ip / ipv6
        ├─ sni
        └─ dns
        │
        │ source server / port / network intentionally do not select transport
        ▼
generateWarp()
        ├─ project QUIC endpoint pool
        ├─ project H2 endpoint selection
        ├─ weighted H2 ports
        └─ anti-correlation
        ▼
masque:// links
```

Если внешний инструмент уже нашёл конкретный рабочий endpoint и его надо сохранить,
это должен быть отдельный явный путь импорта/конвертации, а не изменение семантики
`parseYaml()` или `generateWarp()`.

Формат ссылки — контракт, см. [AGENTS.md](../AGENTS.md), раздел «Input formats and contracts».

## Сеть и приватность

Модель, сверенная с кодом `index.html`, `web4core.runtime.js` и поведением
выпуска v1.12.0; исторические снимки v1.10–v1.11 сохраняются отдельно.

**Без сети (генерация):**

- Разбор ссылок и `.conf`-файлов, сборка YAML, валидация и генерация `masque://`
  выполняются в браузере. Приватные ключи, содержимое WireGuard/AWG-профилей и
  сгенерированный YAML при генерации никуда не отправляются.

**Постоянное хранилище браузера (localStorage, только устройство пользователя):**

- `link-generators.device-identities.v1` — реестр device-identity (feature v1.10):
  случайно сгенерированные идентификаторы и подписи устройств; ключей, паролей и
  содержимого конфигов не содержит.
- `link-generators.subscription-preview-hwid.v1` — legacy значение для миграции
  в реестр устройств; при обычной работе v1 Preview и provider получают HWID
  активного логического устройства из реестра, а не отдельные новые ID.
- В режиме v2 проектные назначения HWID существуют в памяти страницы до
  явного сохранения в `.lgproject.json` (может содержать секреты); импорт
  проекта не заменяет локальный реестр устройств браузера.
- Секрет Mihomo-контроллера в localStorage **не пишется** — он живёт только в памяти
  текущей сессии страницы.

**Сетевые запросы страницы (каждый — только по явному действию пользователя;
фоновых запросов, analytics и телеметрии нет):**

1. **Просмотр подписок и статическое разворачивание** (см. выше):
   - **Sub Mode ON:** только явная кнопка «Получить список» после включения
     переключателя Preview; Build provider-YAML ничего за списком не скачивает.
     «⏹ Пропустить», тайм-аут или изменение ввода прерывают сетевую цепочку;
     количество узлов остаётся **UNKNOWN**, если запрос не завершился.
   - **Sub Mode OFF:** Build делает fetch для разворачивания HTTP(S)-подписки
     в статические узлы. Это нужно для сборки и не зависит от toggle списка.
   - По возможности прямой запрос идёт на URL подписки. При блокировке
     браузера/CORS возможен fallback через принадлежащий проекту
     `sub.saymer-87.workers.dev` (POST `{url, headers}`, затем
     совместимый legacy GET там, где это разрешено установленной политикой).
     Строгий Preview v2 допускается только при доказанной политике Worker
     `strict-same-origin-v1`; при отсутствии доказательства — fail-closed.
   - **Браузер → Worker:** URL подписки (включая токены в URL, если они
     присутствуют) и только allowlist-заголовки `x-hwid`, `x-device-model`.
     Локальный проект, WG/AWG ключи и секрет локального Mihomo Controller не
     посылаются как отдельные поля Worker.
   - **Worker ← upstream подписки:** полный ответ upstream, потенциально с
     адресами, ключами и учётными данными узлов. Поэтому прохождение тела
     через Worker — осознанная граница доверия.
   - **Хранение/логирование на Worker:** клиентский код не может доказать
     отсутствие журналов на развёрнутой инфраструктуре. Не утверждать, что
     Worker гарантированно ничего не сохраняет, без отдельной проверки его
     deployed-кода и конфигурации. Если риск неприемлем, не запускать
     удалённое Preview. Никакая ошибка CORS не доказывает недоступность Mihomo
     или пустую подписку.

2. **Диагностика собственного Mihomo Controller** (runtime import v1.10, PT runtime
   health v1.11): браузер шлёт **только GET** (`/providers/proxies`, `/version`,
   `/proxies`) напрямую на указанный пользователем адрес external-controller.
   Принципиально без fallback-воркеров (security contract #159): адрес, секрет
   (Authorization-заголовок) и ответы не покидают устройство, кроме как на сам
   контроллер; таймауты 8 с, ошибки авторизации (401/403) показываются явно.
3. **CDN jsdelivr** — при **открытии страницы** (тег `<script>` с SRI-проверкой
   целостности) с `cdn.jsdelivr.net` загружается код `js-yaml@4.1.0`; это загрузка
   кода библиотеки, не данных, и она не привязана к нажатию Build.

**Прочее:**

- В Sub Mode ON финальный YAML остаётся provider-based: обновление подписок выполняет
  сам Mihomo на устройстве пользователя (с per-subscription `x-hwid`, который указан
  в самом YAML, а не получен со страницы).
- Явный экспорт возможен через буфер обмена и скачивание локального
  `config.yaml` или `.lgproject.json` (Blob/download). Экспорт проекта v2
  включает HWID/URL и потенциальные секреты; это не автоматическая отправка в сеть.
- `XMLHttpRequest`, `sendBeacon`, EventSource, analytics — не используются.

## Связанные документы

Параметры сборки и структура YAML — [MIHOMO.md](MIHOMO.md); валидация —
[VALIDATION.md](VALIDATION.md); обновления рантайма — [UPDATES.md](UPDATES.md).
