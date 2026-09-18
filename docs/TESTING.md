# TESTING — реальная тестовая стратегия

## MASQUE/DPI генератор: детерминированная регрессия — 2026-09-18

`tests/masque-dpi-regression.cjs` (Playwright, env как у `browser.cjs`): `Math.random`
подменяется только в тесте (очередь граничных значений через `addInitScript`,
продакшн-рандомность не трогается) — детерминированно закрывает каждый взвешенный
бакет портов (границы включительно-по-верхнему краю: 0.7 → 443, 0.700001 → 8443,
0.9 → 8443, 0.900001 → 4443, 0.95 → 4443, 0.950001 → 8095), полный режим (500/1701/4500),
фиксированный QUIC-пул и порт 443, диапазоны H2-IP (октеты 1–254), анти-корреляционную
ветку (форсированная коллизия с QUIC-IP + escape-hatch attempts>18), `urlEncodeKey`
(%2B/%2F/%3D сквозь ссылку), дефолты (SNI/DNS/туннельный IP/профиль) и имена
`PROFILE-QUIC[-N]`/`PROFILE-H2-<port>[-N]`; сгенерированные ссылки прогоняются через
парсер рантайма (round-trip ключей, sni, network=h2, dns). Смыслость проверена мутацией
(нейтрализация исключения в `getRandomH2Ip` ломает тест), 5 повторов подряд — без
флаковости; CI-воркфлоу этот файл не запускает (ручной/локальный запуск).

## Selective Modern REALITY: реальный handshake E2E — 2026-09-18

`tests/mihomo-reality-handshake.manual.cjs` — ручной интеграционный тест (никогда не CI):
реальный Xray-core сервер + реальный mihomo v1.19.31, конфиг которого собран нашим
рантаймом из vless-ссылки; dest — локальный `openssl s_server` (TLS 1.3, группы
`X25519MLKEM768:X25519`), то есть ML-KEM-способная цель, как в предупреждении
release notes Xray v25.5.16. Трафик доказывается HTTP-запросом через mihomo →
xray → локальную цель; `mihomo -t` доказательством не считается.
Бинарники в репозиторий не входят; фиксированные URL — в шапке теста.
Требования: OpenSSL ≥ 3.5 в PATH, `XRAY_DIR`, `MIHOMO_BIN`, `JS_YAML_PATH`, `TEST_OUTPUT_DIR`.

Замеренная матрица (mihomo v1.19.31, синтетические эфемерные ключи, 2026-09-18):

| Xray | selective (match) | legacy / non-match / plain-TLS |
|---|---|---|
| v25.3.6 + ML-KEM dest | **FAIL** — xray «processed invalid connection», REALITY auth нет | OK, ML-KEM не используется |
| v25.5.16 + ML-KEM dest | **OK — сквозное ML-KEM-согласование** (mihomo: «is using X25519MLKEM768 …: true») | OK, legacy |
| v26.7.11 | FAIL (весь REALITY mihomo v1.19.31, верхняя граница) | FAIL |

Выводы: граница совместимости v25.5.16 реальна и воспроизведена — на старом сервере
клиентский hello с ML-KEM key share отвергается только тогда, когда цель поддерживает
ML-KEM (при цели без ML-KEM старый сервер терпит тот же hello — потому формулировка
продукта «только для совместимых серверов» точнее любого версионного порога).
`support-x25519mlkem768` проставляется только совпавшему узлу; `client-fingerprint:
chrome` только при отсутствии своего; plain VLESS/TLS не затронут; provider-выражения
scoped через `has("reality-opts")` с `additional-prefix` поверх (проверено генерацией).
Словесные формулировки UI (A2) не расширялись.

## AWL-приоритет и production-интервалы — 2026-09-18

`tests/mihomo-awl-priority.cjs` (быстрые интервалы 2s, детерминированный) фиксирует
семантический контракт AWL против обычного url-test на одинаковых листьях: медленный,
но живой primary удерживается приоритетом; восстановившийся, но всё ещё медленный
primary возвращает трафик (url-test не возвращается); пассивное обнаружение смерти
primary без трафика укладывается в один-два интервала проверок. Запуск в том же
стиле, что и `mihomo-failover.cjs`:

```bash
MIHOMO_BIN=/absolute/mihomo JS_YAML_PATH=/absolute/js-yaml.min.js \
TEST_OUTPUT_DIR=/absolute/out node tests/mihomo-awl-priority.cjs
```

Варианты провайдеров B/C/D и сосуществование `override-expr` + `additional-prefix`
(ветка reality-selective-v2, `mihomo -t` + живой прогон) проверены отдельными
лабораторными прогонами NIGHT-24A; артефакты — вне репозитория.
`tests/mihomo-awl-soak.manual.cjs` — ручной soak на generated-интервалах
(300s/60000ms), ~25 минут, в CI не ставится: активный failover на dial-ошибках,
автоматический failback по сетке планировщика, чисто пассивное обнаружение
(трафик затихает за 60 с до kill, дальше только read-only API-опросы), поведение
«все узлы мертвы» и восстановление. Запускать эксклюзивно, без параллельных
Mihomo-лабораторий.

## Дополнительный runtime review #2588

Подробно: [FALLBACK-REVIEW.md](FALLBACK-REVIEW.md). На v1.19.31 баг воспроизведён
локальными HTTP-пробами: dead wrapper + alive child → трафик ошибочно уходит на БС.
После замены nested-групп плоским GLOBAL тест `tests/mihomo-failover.cjs`
доказывает реальный PRIMARY → FALLBACK → PRIMARY для static/providers/mixed.
Проверяется полный health-check providers, continued probes без primary-трафика
и effective порядок узлов. Тестовый interval=1s; generated default=300s.
`--nested-repro` самодостаточно реконструирует отвергнутую схему.

## Автоматический режим белых списков — 2026-09-15

- Source (web4core, `tools/tests/*.test.mjs`, автообнаружение): сейчас 8 файлов /
  71 тест — exclude-filter, priority, tun-stack, port-validation, per-proxy-health,
  webui-select, small-regressions, и `amnezia.test.mjs` (требует
  `npm run build:worker` — workers/api/dist/worker.mjs, gitignored).
- Runtime: `tests/runtime.cjs` — 65 проверок с `BASELINE_REF=21c3010`
  (число растёт вместе с контрактами; исторические 45/61 относились к v1.3.0-эре).
- Существующий browser suite: обе вкладки, AWG, VPS, MIPS, baseline; validator — 47 cases.
  Тестовый текст AWG нормализуется LF для одинаковой работы regex на Windows/Linux.
- Новый `tests/whitelist.cjs`: 10 YAML-сценариев (1+1, несколько+несколько,
  subscription+subscription, mixed+mixed, links с Sub Mode; каждый gVisor/MIPS).
  Проверены скрытие, восстановление, подмена запрещённых DOM-значений, отсутствие
  поддержки в старом runtime, пустой резерв и блокировка Copy; плюс зависимости UI
  реальными кликами (TUN → MIPS и «TUN на каждый прокси», Mixed Port → «SOCKS-порт на
  каждый прокси»: disable+reset)
  и fail-safe клампы сборки при подмене DOM (в т.ч. Mixed off + «SOCKS-порт на каждый
  прокси», которого
  нет в 256-матрице, и fail-closed «нет ни одного inbound»).
- 256 сравнений UI-output с исходным `21c3010`: Sub Mode, TUN, «TUN/SOCKS на каждый
  прокси»,
  MIPS, LAN, Web UI, generic/VPS. RNG стабилизирован только в тесте; маска нормализуется
  по реальным UI-зависимостям перед выставлением DOM на обеих сторонах (VPS → TUN=true;
  TUN=false → MIPS=false и «TUN на каждый прокси»=false), невозможные состояния в baseline не
  участвуют и проверяются отдельными bypass-тестами. Выключенный режим byte-for-byte.
- Официальный Mihomo v1.19.31 windows amd64 (Go 1.26.8, with_gvisor): `-t` прошёл
  для 17 файлов — 10 новых и 7 прежних (обычный TUN/«на каждый прокси»/VPS/AWG).
  Это проверка конфигураций, не сетевого failover или handshake.

Новый browser test использует те же `NODE_PATH`, `JS_YAML_PATH`, `BROWSER_CHANNEL`,
`TEST_OUTPUT_DIR`, `BASELINE_REF`, что и существующий suite:

```bash
BASELINE_REF=21c3010 JS_YAML_PATH=/absolute/js-yaml.min.js \
TEST_OUTPUT_DIR=/absolute/yaml node tests/whitelist.cjs
mihomo -t -d /absolute/isolated-test-home -f /absolute/yaml/whitelist-mixed-mips.yaml
```

Для каждого YAML использовать отдельный тестовый home; реальные подписки и
credentials не нужны. Workflow автообновления теперь: `npm run build:worker`
(артефакт для amnezia-тестов) → `node --test tools/tests/*.test.mjs`
(автообнаружение всех unit-тестов) → runtime smoke test нового API до
копирования артефакта; оба job ограничены `timeout-minutes`.


С 2026-09-15 доступны автоматические регрессии `tests/runtime.cjs` (только Node,
без npm install) и `tests/browser.cjs` (внешняя установка Playwright и браузер).
Workflow автообновления запускает runtime-тест до замены бандла.
Исторические ручные прогоны и матрицы ниже сохранены с их датами.

## Воспроизводимый прогон v1.19.31

```bash
node --check web4core.runtime.js
node tests/runtime.cjs
# Необязательный baseline старого кода и проверка воспроизводимости патча:
BASELINE_REF=fb285850bae09ba2f2336993e6b34fc2318a23af node tests/runtime.cjs
# Playwright установлен вне репозитория; его node_modules доступны через NODE_PATH.
JS_YAML_PATH=/absolute/path/js-yaml.min.js TEST_OUTPUT_DIR=/absolute/path/yaml \
BASELINE_REF=fb285850bae09ba2f2336993e6b34fc2318a23af node tests/browser.cjs
```

В PowerShell задавать переменные через `$env:NAME='value'`. `JS_YAML_PATH` — локальная
копия **js-yaml 4.1.0**, того же файла, который загружает страница; с baseline обязательна,
без baseline может быть опущена (тогда используется CDN страницы).
`BROWSER_CHANNEL` по умолчанию `msedge`, можно выбрать установленный `chrome`.
`TEST_OUTPUT_DIR` опционален, должен находиться вне репозитория.
Inline JS отдельно извлечь из последнего `<script>` и проверить `node --check`.

Runtime: 43 проверки без baseline / 59 с baseline. Обычный TUN, все Per-Proxy listeners,
Sub Mode, no-TUN, explicit gvisor, invalid values, прямой buildMihomoYaml, неизменность
байтов исходного вывода в 16 комбинациях. Случайный subscription x-hwid фиксируется
только внутри тестового VM. Три проверки textual patch удалены вместе со скриптом; все функциональные проверки сохранены.

Browser: UI default/off/on, инвалидирование Copy, обычный/per-proxy MIPS, VPS с обеими
формами TUN и DNS toggle, generic→VPS→generic, AWG .conf upload со всеми девятью 3.1
полями и проверкой промежуточных стадий, on/off и альтернативные booleans, scalar/range,
false-only auto-version, plain WG, int-range; baseline generic/VPS × links/AWG,
TPC→INVALID / TCP→VALID и обе вкладки (WARP YAML→MASQUE→Builder→Copy).
Clipboard в тесте подменён тестовым адаптером; вызов и guard страницы остаются реальными.
Дополнительно в браузере выполнены 47 структурных cases валидатора: 17 позитивных типов,
порты, обязательные поля, YAML/секции, listeners, группы/ссылки, Mieru port-range.

### Результат проверки ядром 2026-09-15

Официальный `mihomo-windows-amd64-v1-v1.19.31.zip`, вывод `-v`:
`Mihomo Meta v1.19.31 windows amd64 with go1.26.8`, build `2026-09-14`, tag `with_gvisor`.
Команда: `mihomo -t -d <isolated-test-home> -f <generated-file>`.
Успешно прошли **7 файлов**: default gvisor, MIPS, Per-Proxy MIPS, VPS MIPS,
VPS + Per-Proxy MIPS, AWG 3.1, AWG 3.1 + VPS MIPS. Никаких пользовательских credentials.
Это реальная проверка ядром, но не запуск TUN и не handshake AWG-сервера.

### Воспроизводимость source-level runtime

Runtime собирается штатно из `saymer-alt/web4core@link-generators`; команды —
[DEVELOPMENT.md](DEVELOPMENT.md). Перед миграцией сборка на базе upstream `8998983`
с MIPS в `src/build.js`/`src/core/yaml.js` побайтово совпала с runtime из commit `6b3368e`:
193683 байта, SHA-256 `b445d1884c819f9a6da49c57d30ddb67e5d8b5cd01f9ca5412f7e0555f68fa1e`.
Windows checkout отличается только CRLF. Runtime руками не редактируется.
В fork добавлены source tests на базе существующего `node:test`; старые тесты сохранены.
Ниже датированные прогоны 2026-09-08/09 — исторические результаты.

## Инфраструктура прогона

```bash
cd link-generators
py -m http.server 8017 --bind 127.0.0.1
# открыть http://127.0.0.1:8017/index.html (in-app browser или обычный браузер)
```

Юнит-кейсы валидатора вызываются прямо на странице (`validateMihomoYaml(yaml)` — глобальная
функция; состояние — `MIHOMO_VALIDATION_STATE`); e2e — через UI или те же evaluate-вызовы
(`buildMihomo()`, `copyMihomo()`). Файлы WG подсовываются через `DataTransfer` + событие
`change` на `#wgFile` (нативный file-пикер не автоматизируется). Все фикстуры —
синтетические (фейковые base64-ключи); реальные конфиги пользователя в тестах не
использовать никогда.

Гочаи прогона:

- после правок обновлять вкладку (`reload`) — свежий page build может закэшироваться;
- **Sub Mode включён по умолчанию**: `buildMihomo` отвергает не-URL ввод («Provide one or
  more HTTP(S) URLs…») — для ссылок выключать `#cfgSubMode` (это не баг патчей);
- mieru-ссылка требует userinfo: `mieru://user:pass@host:port?transport=…`, иначе
  «mieru: missing username/password»;
- клик по Build в evaluate — через `#tab-mihomo button[onclick="buildMihomo()"]`
  (первая `.btn` вкладки — кнопка загрузки WG-файла).

## Юнит-матрица валидатора (42 кейса, все зелёные на 2026-09-08)

Функция `validateMihomoYaml(yaml)`:

- **TPC-регресс**: `mieru` c `transport: TPC` → INVALID, ошибка содержит
  Proxy=`Sweden Mieru`, Field=`transport`, Value=`"TPC"`; с `TCP` → VALID (0 ошибок);
- **mieru port-range (регресс 2026-09-09)**: `mieru` c `port-range: "20000-22000"` без
  `port` → VALID (ошибка «порт должен быть целым числом» здесь запрещена — mihomo
  принимает `port-range` вместо `port`, взаимоисключимо); `port` + `port-range`
  одновременно → INVALID; `port-range: "20000"` (без дефиса) → INVALID;
  `"70000-80000"` → INVALID; `"22000-20000"` (begin > end) → INVALID;
  `"20000,21000"` (список — mihomo `Sscanf("%d-%d")` не парсит) → INVALID;
- неизвестный `type` (`vles`) → INVALID; отсутствующий `server` → INVALID; порты
  `0`, `70000`, `"abc"`, `443.5` → INVALID;
- битый YAML → INVALID с сообщением о синтаксисе; корень-список → INVALID; `dns` не
  словарь → INVALID;
- неизвестное дополнительное поле → **VALID** (намеренно не проверяется);
- группы: битая ссылка на несуществующий прокси → INVALID; неизвестный тип группы
  (`fallback2`) → INVALID; forward-ссылка на группу → VALID; все 5 типов групп → VALID;
  пустой `proxies` группы → VALID + 1 warning;
- listeners: порт `0` → INVALID; дубликат имени → INVALID; дубликат имени прокси → INVALID;
- AWG 3.1 фикстура (wireguard + `amnezia-wg-option` с `version: 3`, header-protection-key,
  диапазоны) → **VALID** — валидатор не должен ломать AWG;
- 17 позитивов: ss, ssr, vmess, vless, trojan, hysteria2, tuic, ssh, anytls, masque,
  trusttunnel, mieru (TCP), http, socks5, hysteria (`type: hysteria` в YAML — v1 ядро
  поддерживает, хотя ссылки `hysteria://` не парсятся, см. [PROTOCOLS.md](PROTOCOLS.md)),
  snell, direct (без server) → VALID;
- коллизия «имя группы = имени прокси» → VALID + warning.

## Браузерные e2e (выполнены 2026-09-08)

| Сценарий | Ожидание | Статус |
|---|---|---|
| VLESS-ссылка → Build Config | state `VALID`, бокс «⚠️ Базовая проверка пройдена. Это не эквивалент проверки mihomo -t.», Copy включена | ✅ |
| изменение input после VALID (событие input) | state `NOT_BUILT`, Copy выключена | ✅ |
| `mieru://…?transport=TPC` → Build | state `INVALID`, Copy выключена, бокс с Proxy/Field/Value; `TPC` реально в готовом YAML (валидация пост-билд) | ✅ |
| та же ссылка с `TCP` → Build | state `VALID`, Copy включена | ✅ |
| `copyMihomo()` в INVALID | toast «Копирование заблокировано…», clipboard не тронут (guard) | ✅ |
| AWG 3.1 `.conf` (фейковые ключи, `PersistentKeepalive = 25-35`, `HeaderProtectionKey`) через DataTransfer → Build | state `VALID`; в YAML `version: 3`, `persistent-keepalive: 25`, `amnezia-wg-option` на месте — AWG-слой не задет | ✅ |
| захват фактических YAML (links / per-proxy SOCKS / per-proxy TUN / sub-mode / mieru / masque / socks5 / WG) | сверка структуры с документацией (`docs/`) | ✅ |
| отказы рантайма: `sdns://`, `socks4://`, `hysteria://` | «Mihomo does not support: sdns/socks4», «Unknown link: hysteria» | ✅ |

## Браузерные e2e — mieru port-range (2026-09-09, все зелёные)

Полный round-trip через UI (`#mihomoInput` → Build Config → валидатор), синтетические
креды (`203.0.113.0/24`, testuser/testpass):

| Сценарий | Ожидание | Статус |
|---|---|---|
| `mierus://testuser:testpass@203.0.113.10:20000-22000?protocol=TCP#…` → Build | state `VALID`; в YAML прокси: `port-range: "20000-22000"`, поля `port` нет | ✅ |
| `mieru://…@203.0.113.11:20000?protocol=TCP` → Build | state `VALID`; в YAML `port: 20000` (обычный одиночный Mieru не сломан) | ✅ |
| `mieru://…@203.0.113.12:70000-80000?protocol=TCP` → Build | state `INVALID`; ошибка на `port-range` (границы вне 1–65535) | ✅ |
| регресс `mieru … transport=TPC` → Build | state `INVALID` на `transport` (прежнее поведение сохранено) | ✅ |
| регресс: `vless` → VALID; `ss` без `port` → INVALID | прежнее поведение сохранено | ✅ |

## Проверка runtime перед commit

```bash
git status --short
git diff --check
node --check web4core.runtime.js
node tests/runtime.cjs
```

Изменённый runtime должен воспроизводиться сборкой fork; сравнение и baseline —
[DEVELOPMENT.md](DEVELOPMENT.md).

## Регрессионный минимум перед любым пушем

1. Обе вкладки: полный сценарий «YAML бота → ссылки → Builder → Build → Copy».
2. Валидатор: TPC → INVALID + Copy заблокирована; TCP → VALID; изменение input сбрасывает.
3. AWG 3.1 `.conf` → VALID (`version: 3` в YAML, булевы `random-trailers`/`disable-cookies`
   из `on`/`off` присутствуют как booleans).
4. Allow LAN: `allow-lan: true` + `bind-address: "*"` в выводе (регэксп-патч не сломан).
5. `web4core.runtime.js` воспроизводится сборкой fork; функциональные регрессии проходят.
6. Профиль развёртывания: generic-вывод посимвольно равен эталону; при vps —
   контракт из раздела «Профиль VPS Gateway» (auto-route false, dns-тумблер,
   find-process-mode, store-*).

## Профиль VPS Gateway (opt-in; добавлен 2026-09-09)

Селектор «Профиль развёртывания» (`#cfgProfile`), дефолт `generic`. Реализация —
`applyDeploymentProfile()` в `index.html`, вызывается **только** при `vps` (после
`injectWgDns`, до allow-lan патча). Прогон 2026-09-09 (базовый HEAD `b7af2b1`, до
коммита): **все проверки зелёные**.

Фикстуры: синтетическая vless-ссылка, trojan-ссылка, URL подписки, синтетический AWG 3.1
`.conf` (длинные base64 I1/I5/HeaderProtectionKey по 140+ символов, `PersistentKeepalive
= 25`, `RandomTrailers = 1`). Baseline Generic-вывода снят до правок и сохранён вне
репозитория.

### Generic-инвариант (byte-for-byte)

- 5 эталонных входов (ссылки+дефолты; Sub Mode URL; Per-Proxy SOCKS ×2 ссылки;
  allow-lan off; AWG файл) → вывод после добавления профиля **посимвольно равен
  baseline** — ✅
- повторная generic-сборка после цикла generic→vps→generic — посимвольно равна
  baseline (мусор не остаётся) — ✅
- профильная функция при generic не вызывается (guard `if (deploymentProfile ===
  'vps')` в `buildMihomo()`; инспекция кода) — ✅
- AWG DNS injection (`injectWgDns`) и allow-lan патч работают как раньше — входят
  в эталоны — ✅
- Sub Mode: сравнение с нормализацией случайного `x-hwid` (генерируется заново на
  каждую сборку — поведение рантайма, НЕ регресс) — ✅

### VPS-контракт

- все fixed-поля: `tun.{enable, device: tun-mihomo, stack: gvisor, auto-route: false,
  auto-detect-interface: true, inet4-address: 10.255.255.1/30, mtu: 1420, gso: true}` — ✅
- `endpoint-independent-nat` отсутствует; при ручной инъекции в YAML удаляется
  (юнит-прогон `applyDeploymentProfile`) — ✅
- `find-process-mode: 'off'` в корне (jsyaml квотит строку `off` — YAML 1.1 bool
  protection; для mihomo/yaml.v3 это строка `"off"`, семантика верна) — ✅
- `profile.store-selected/store-fake-ip = false`, merge без замены секции — ✅
- `auto-route: false` в выводе; `auto-route: true` нигде; в DOM нет контрола
  управления auto-route — ✅
- passthrough редактируемых полей: device / inet4-address / mtu / fake-ip-range /
  listen реально пробрасываются в YAML — ✅
- DNS sub-toggle: off → `dns` отсутствует целиком (без частичных остатков) — ✅
- пустые поля → боевые дефолты (device=tun-mihomo, nameserver=1.1.1.1/8.8.8.8) — ✅
- Sub Mode + VPS: `proxy-providers` на месте + gateway-tun — ✅
- AWG + VPS (двойной jsyaml-roundtrip): `amnezia-wg-option` (включая I1/I5 по 140
  символов, `version: 3`) идентичен generic-сборке — ✅
- allow-lan патч на VPS-выводе: `allow-lan: true` + `bind-address: "*"` — ✅
- валидатор: все VPS-сборки → VALID; регресс `transport: TPC` → INVALID — ✅

### Переключение

- generic → vps → generic: панель скрывается, `cfgTun` разблокируется и
  восстанавливается в прежнее состояние, вывод чистится от VPS-значений — ✅

## AWG self-hosted 3.1 импорт (добавлен 2026-09-09)

Production-case: реальный self-hosted AWG 3.1 `.conf` (Amnezia, `HeaderProtectionKey` +
диапазонные таймеры + `RandomTrailers`/`DisableCookies = on|off`) импортировался с потерей
полей. Прогон фикса (все проверки выполнены в браузере, синтетические fixture с нулевыми
ключами — реальные ключи в репозиторий не попадают): **все зелёные**.

Baseline ДО фикса (зафиксирован тем же прогоном на неизменённом коде):
`RandomTrailers/DisableCookies = on|off` молча пропадали из `amnezia-wg-option`
(официальный формат литералов 3.1 не входил в набор парсера); range-значения int-полей
(`S1 = 100-200`, `Itime = 10-16`) уходили в YAML строками → mihomo не декодировал бы весь
конфиг. Range-строки легальных полей (`h1-h4`, шесть таймеров 3.x) и так проходили
корректно — passthrough не менялся.

### Матрица fixture (после фикса)

- `user31` (форма production-конфига: HP + 6 диапазонов + `RandomTrailers = on`,
  `DisableCookies = off`, `PersistentKeepalive = 25-35`, `AllowedIPs = 0.0.0.0/0, ::/0`):
  `random-trailers: true`, `disable-cookies: false` (booleans), `version: 3`,
  `header-protection-key` на месте, все 6 таймеров — range-строками («3-7», «100-120»,
  «150-180», «5-15», «15-20», «10-100»), `persistent-keepalive: 25`, `allowed-ips:
  ['0.0.0.0/0']` + `ip-version: ipv4`, DNS `100.64.0.1` → `1.1.1.1, 8.8.8.8` — ✅
- `fi31` (та же форма без булевых строк, диапазоны «3-8»/«7-13»): булевы ключи
  отсутствуют, остальное идентично `user31` — ✅
- `boolOff` (`RandomTrailers = OFF`): `random-trailers: false` (boolean), `version: 3` — ✅
- `boolYes0` (`RandomTrailers = yes`, `DisableCookies = 0` — штатный путь парсера):
  `true`/`false`, регресс не сломан — ✅
- `intrange` (`S1 = 100-200`, `Itime = 10-16`): свёрнуты к нижней границе — `s1: 100`,
  `itime: 10` (числа), `jc` не тронут, `version` не появляется (нет 3.x-полей) — ✅
- `premium` (H1–H4 диапазонами, I1–I5 CPS): без изменений — диапазоны строками, I1/I5
  целые (148/153 симв., в YAML не перенесены), `version` НЕ проставляется — ✅
- `plain` (обычный WireGuard без AWG): `amnezia-wg-option` отсутствует целиком — ✅
- `dual` (`Address` v4+v6, `AllowedIPs = 0.0.0.0/0, ::/0`): `ipv6` сохранён, `::/0` в
  `allowed-ips`, `ip-version` не проставляется — ✅
- юнит `normalizeWgText`: `on`→`1`, `OFF`→`0`, `true` не тронут, BOM снят,
  `PersistentKeepalive = 25-35` → `25` — ✅

### Регрессия прочих слоёв

- валидатор: vless (TCP) → VALID; `mieru … transport=TPC` → INVALID — ✅
- VPS-профиль × AWG 3.1 (интеграция): `tun.device: tun-mihomo`, `auto-route: false`,
  `dns.listen: 0.0.0.0:53` + полный `amnezia-wg-option` (`version: 3`,
  `random-trailers: true`), VALID — ✅

## Что не тестируется

Workflow автоматически запускает source Mihomo tests, сборку, проверку синтаксиса
и runtime suite. Browser suite и реальный `mihomo -t` запускаются отдельно;
после публикации остаётся проверка живой страницы.

Для AWG-импорта за рамками тестов остаются два уровня, которые страница проверить не может:
фактический AWG-хендшейк против
self-hosted 3.1 сервера и поведение конкретной сборки ядра (требование mihomo ≥ 1.19.30
для 3.1-ключей — см. [PROTOCOLS.md](PROTOCOLS.md)). Успешная структурная валидация ≠
работающий туннель.
