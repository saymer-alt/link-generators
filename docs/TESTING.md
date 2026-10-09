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
| v26.7.11 | FAIL для проверенной связки с Mihomo v1.19.31 | FAIL для той же связки |

Выводы этой лаборатории привязаны к **Mihomo v1.19.31**. Xray v25.5.16 — проверенная
рабочая точка для selective ML-KEM в этой матрице, но не универсальный минимальный
порог совместимости для любых будущих клиентов/серверов. Аналогично, наблюдавшийся
FAIL на Xray v26.7.11 не является вечной «верхней границей» Xray: это результат
конкретной связки Xray v26.7.11 + Mihomo v1.19.31. На v25.3.6 клиентский hello с
ML-KEM key share отвергается только тогда, когда цель поддерживает ML-KEM (при цели
без ML-KEM старый сервер терпит тот же hello), поэтому формулировка продукта
«только для совместимых серверов» точнее любого голого версионного порога.
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
проверены отдельными лабораторными прогонами NIGHT-24A (`mihomo -t` + живой прогон)
на кандидате, который затем вошёл в v1.4.0; временная ветка кандидата больше не является
источником истины. Артефакты лаборатории — вне репозитория.
`tests/mihomo-awl-soak.manual.cjs` — ручной soak на generated-интервалах
(300s/60000ms), ~25 минут, в CI не ставится: активный failover на dial-ошибках,
автоматический failback по сетке планировщика, чисто пассивное обнаружение
(трафик затихает за 60 с до kill, дальше только read-only API-опросы), поведение
«все узлы мертвы» и восстановление. Запускать эксклюзивно, без параллельных
Mihomo-лабораторий.

## AWG field-check: relaxed group status — 2026-09-23

Полевой кандидат для кейса Max: AWG 3.1 после ручного Ping получает latency, но затем
может снова стать недоступным для GLOBAL. Исходники Mihomo v1.19.31 показывают, что
`alive` сам по времени не протухает: состояние меняет следующий `URLTest()`. При этом
MetaCubeXD manual Ping вызывает `/delay?url=...&timeout=...` без `expected-status`, а
сгенерированный ранее GLOBAL требовал точный код (для Google — 204).

Кандидат на `main` поэтому убирает `expected-status` **только у плоского GLOBAL
fallback**. URL, `interval: 300`, `lazy: false`, dial-failure окно и provider
health-check не меняются; HTTP providers по-прежнему сохраняют строгий
`expected-status`. Обычный режим генератора также не меняется.

Полевой прогон после сборки нового runtime:

1. Сгенерировать новый Auto Whitelist config с тем же AWG и тем же Ping server.
2. Reload/restart Mihomo и больше не нажимать Ping у AWG вручную.
3. Проверить, появляется ли latency/живое состояние автоматически.
4. Наблюдать минимум 15–20 минут (не менее трёх циклов по 300 секунд).
5. По возможности воспроизвести БС → fallback → восстановление сети и проверить
   автоматический возврат к первому доступному PRIMARY.
6. Зафиксировать время, выбранный GLOBAL и состояние AWG до/после каждого 300-секундного
   цикла. Если AWG снова становится dead, следующий кандидат — отдельный keep-warm
   health-check; production `stable` до этого не менять.

Успех этого field-check подтверждает практическую пригодность изменения, но сам по себе
не доказывает, какой HTTP-код возвращался в прежнем неудачном цикле. Для точного root
cause при повторении нужны логи health-check/URLTest или ответ тестового endpoint.

## WireGuard dialer-proxy (туннель в туннеле) — 2026-09-30

Опции `wgDialerProxy` / `wgDialerGroupMembers`: WireGuard/WARP устанавливает соединение с сервером через другой proxy/группу. Контракт и схема — [MIHOMO.md](MIHOMO.md).

- Source: `tools/tests/mihomo-wg-dialer.test.mjs` (13 тестов): byte-parity при пустых опциях, Variant A (имя proxy/группы), Variant B (авторская select-группа перед остальными, дефолт имени `WARP-DIALER`), отказы (неизвестный таргет/участник, конфликт имени, self-named без кандидатов), исключение транзитного WG-профиля (SE2-аналог Keenetic), проброс в subscription- и AWL-priority путях (таргет — ФИНАЛЬНОЕ имя прокси, AWL-пути префиксуют имена).
- Consumer: `tests/runtime.cjs` — 6 dialer-кейсов (53→59).
- Variant C (provider-backed, 2026-09-30): source `mihomo-wg-dialer.test.mjs` — 8 кейсов (13→21): группа `use:` на существующие провайдеры, несколько провайдеров, комбинированная группа proxies+use, дефолт `WARP-DIALER`, неизвестный URL → fail-closed, без subscription-режима → fail-closed, конфликт имени, provider-группа не может содержать WG-прокси по построению. Consumer: 4 кейса (59→63). Browser: поля `wgDialerProviders` → `use:`-группа + UDP-предупреждение валидатора; `mihomo -t`: 1 и 2 провайдера — successful, `use:`-призрак отвергнут ядром.
- Browser: поля `wgDialerInput`/`wgDialerMembers` → Build → `dialer-proxy` в YAML; валидатор: таргет-призрак/self-reference → INVALID, `GLOBAL`-таргет и MTU>1300/без mtu → предупреждения, UDP-only подсказка для http-таргета.
- `mihomo -t` v1.19.31: позитивы (имя proxy; авторская группа) — successful; негативы (`dialer-proxy: GHOST`, self-reference) отвергаются ядром — Builder зеркалит статическую проверку ядра (`config/utils.go`).
- **Централизация (2026-09-30)**: детектор перенесён в рантайм (`web4core.analyzeDialerGraph` — циклы с полными маршрутами + `dynamicGroups`/`dynamicProviders`); валидатор страницы вызывает его, локальная копия — только fallback до доставки нового runtime. Mixed-группы (`proxies:` + `use:` одновременно) вносят обе категории рёбер (регрессии: валидная mixed-группа, цикл через static-члена, цикл через provider override — source + build gate + браузер). Провайдер без override — dynamic/unknown (warning), не «доказанный тупик».
- **Полевой harness `tools/warp-dialer-fieldtest/` (2026-10-01)**: автоматизированные полевые измерения dialer-proxy/provider-схем (sweep узлов, switchtest A→B→A, MTU-лестница с восстановлением конфига, WARP-over-WARP). Offline-тесты harness — 22 кейса (аргументы, redaction, классификация по curl-кодам, CSV, null-device, MTU-редактирование, план, нормализация API); CI проверяет только синтаксис/offline-тесты/отсутствие секретов — реальные field tests в CI не запускаются. Методика и ловушка PIN — README инструмента.
- **Dependency-graph цикл-детектор (2026-09-30, WG-over-WG)**: source `mihomo-wg-dialer.test.mjs` — 9 кейсов (21→30): валидные `WG-A→WG-B`, `WG-A→WG-B→WG-C`, группа-медиированные цепочки; self-loop, 2-node loop, loop через группу, loop через две группы, цикл через provider `override.dialer-proxy` — отвергаются; provider без override — тупик (валидно). Consumer/browser probe: 11 сценариев (валидные цепочки не блокируются, `GLOBAL`-таргет — ошибка). `mihomo -t`: generated `WARP-OUTER → WARP-INNER` и ручная 3-node цепочка — successful; group-loop ядро пропускает (наш валидатор строже). Механический runtime-прогон: запрос маршрутизируется в `WARP-OUTER`, ядро поднимает цепочку и уходит в WG-handshake-таймаут на synthetic-ключах (dialer-механика между двумя WG-outbound живая; реальный handshake — field-test).
- Живая механическая цепочка (два инстанса v1.19.31 на одной машине): main-инстанс `TARGET` (socks5, `dialer-proxy: DIAL`) → dialer-инстанс; сквозной HTTPS-трафик проходит; негативный контроль (DIAL на мёртвом порту) блокирует трафик полностью. Полная WARP-цепочка через удалённый VPS — полевой тест (см. WARPSCOUT-VPS.md).

## Дополнительный runtime review #2588

Подробно: [FALLBACK-REVIEW.md](FALLBACK-REVIEW.md). На v1.19.31 баг воспроизведён
локальными HTTP-пробами: dead wrapper + alive child → трафик ошибочно уходит на БС.
После замены nested-групп плоским GLOBAL тест `tests/mihomo-failover.cjs`
доказывает реальный PRIMARY → FALLBACK → PRIMARY для static/providers/mixed.
Проверяется полный health-check providers, continued probes без primary-трафика
и effective порядок узлов. Тестовый interval=1s; generated default=300s.
`--nested-repro` самодостаточно реконструирует отвергнутую схему.

## Автоматический режим белых списков — 2026-09-15

- Source (web4core, `tools/tests/*.test.mjs`, автообнаружение): после v1.4.0 —
  **11 файлов / 82 теста**, включая selective REALITY и расширенный
  `per-proxy-health`; `amnezia.test.mjs` требует `npm run build:worker`
  (workers/api/dist/worker.mjs, gitignored).
- Runtime: `tests/runtime.cjs` — **49 проверок без baseline / 65 с baseline**.
  Для разных вопросов используются два именованных якоря: `21c3010` — исторический
  переход consumer на source-level fork; `927c446` — ближайший функциональный
  production baseline перед selective REALITY/static-health кандидатом. При baseline
  скрытая группа `🌐 static-health` маскируется целиком, поэтому её критичный
  `lazy: false` проверяется независимо в `tests/whitelist.cjs` вне baseline-режима.
- Существующий browser suite: обе вкладки, AWG, VPS, MIPS, baseline; validator — 47 cases.
  Тестовый текст AWG нормализуется LF для одинаковой работы regex на Windows/Linux.
- Selective REALITY fixture в `tests/whitelist.cjs` использует фиксированный валидный
  X25519 public key (base64url, 32 raw bytes), а не синтетическую строку `TESTPBK`.
  Это сохраняет детерминизм browser-теста и позволяет тем же YAML проходить реальный
  `mihomo -t` без искусственной ошибки ключа.
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
После Vladimir UX pass browser suite также фиксирует понятную подпись «URL-подписки
(Sub Mode)», динамическую подсказку для ordinary links/subscription URLs, readonly
preview итогового YAML и evidence-текст с `mihomo -t` для случаев, когда ядро
отвергает browser-VALID конфиг.
Workflow автообновления запускает runtime-тест до замены бандла.
Исторические ручные прогоны и матрицы ниже сохранены с их датами.

## Воспроизводимый прогон v1.19.31

```bash
node --check web4core.runtime.js
node tests/runtime.cjs
# Исторический якорь перехода на source-level fork:
BASELINE_REF=21c3010 node tests/runtime.cjs
# Ближайший функциональный baseline перед кандидатом v1.4.0:
BASELINE_REF=927c446 node tests/runtime.cjs
# Playwright установлен вне репозитория; его node_modules доступны через NODE_PATH.
JS_YAML_PATH=/absolute/path/js-yaml.min.js TEST_OUTPUT_DIR=/absolute/path/yaml \
BASELINE_REF=927c446 node tests/browser.cjs
```

В PowerShell задавать переменные через `$env:NAME='value'`. `JS_YAML_PATH` — локальная
копия **js-yaml 4.1.0**, того же файла, который загружает страница; с baseline обязательна,
без baseline может быть опущена (тогда используется CDN страницы).
`BROWSER_CHANNEL` по умолчанию `msedge`, можно выбрать установленный `chrome`.
`TEST_OUTPUT_DIR` опционален, должен находиться вне репозитория.
Inline JS отдельно извлечь из последнего `<script>` и проверить `node --check`.

Runtime: 49 проверок без baseline / 65 с baseline. Обычный TUN, все Per-Proxy listeners,
Sub Mode, no-TUN, explicit gvisor, invalid values, прямой buildMihomoYaml, неизменность
байтов исходного вывода в 16 комбинациях. Случайный subscription x-hwid фиксируется
только внутри тестового VM. Три проверки textual patch удалены вместе со скриптом; все функциональные проверки сохранены.

Browser: Compatibility Summary проверяется как consumer-only слой над финальным YAML:
блок скрыт без специальных требований; MIPS, AWG 3.1, provider override-expr / Modern
REALITY и experimental Mieru/TrustTunnel определяются без изменения YAML и без влияния
на Copy.
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
6. Профиль развёртывания: вывод router/vps-local посимвольно равен эталону; при
   vps-gateway — контракт из раздела «Профиль VPS Gateway» (auto-route false,
   dns-тумблер, find-process-mode, store-*, DDP). Полный обязательный набор для
   profile/UX-правок — [DEPLOYMENT-PROFILES-TEST-CONTRACT.md](DEPLOYMENT-PROFILES-TEST-CONTRACT.md) §9.

## Профиль VPS Gateway (opt-in; добавлен 2026-09-09)

> **Историческая запись.** Этот раздел описывает прогоны 2026-09-09, когда модель
> профилей называлась `generic`/`vps`. С PR #79 (2026-10-01) пользовательская модель —
> `router` / `vps-local` / `vps-gateway` (дефолт `router`); «generic» в записях ниже
> соответствует нынешнему router/vps-local-выводу, «vps» — профилю `vps-gateway`.
> Актуальные прогоны новой модели — см. «Domain Policy Routing» и «VPS Domain
> Detection Package» в конце файла.

Селектор «Профиль развёртывания» (`#cfgProfile`); на момент прогона дефолт был
`generic`. Реализация —
`applyDeploymentProfile()` в `index.html`, вызывается **только** для gateway-профиля
(после `injectWgDns`, до allow-lan патча). Прогон 2026-09-09 (базовый HEAD `b7af2b1`, до
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

- текущий default UI-path даёт `tun.{enable, device: tun-mihomo, stack: mips,
  auto-route: false, auto-detect-interface: true, mtu: 1420, gso: true}`; top-level
  `tun.inet4-address` отсутствует — ✅
- `endpoint-independent-nat` отсутствует; при ручной инъекции в YAML удаляется
  (юнит-прогон `applyDeploymentProfile`) — ✅
- `find-process-mode: 'off'` в корне (jsyaml квотит строку `off` — YAML 1.1 bool
  protection; для mihomo/yaml.v3 это строка `"off"`, семантика верна) — ✅
- `profile.store-selected/store-fake-ip = false`, merge без замены секции — ✅
- `auto-route: false` в выводе; `auto-route: true` нигде; в DOM нет контрола
  управления auto-route — ✅
- passthrough редактируемых полей: `device` и `mtu` идут в `tun`, а
  `fake-ip-range` / `listen` — в включённую секцию `dns`; отдельного редактируемого
  top-level `inet4-address` в текущем VPS-профиле нет — ✅
- явно выбранные experimental stack `system` / `mixed` сохраняются, а не переписываются
  молча в gVisor; при MIPS checkbox off используется gVisor — ✅
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

## Domain Policy Routing (Variant B) — 2026-10-01

Коммиты: web4core `2daf383` (эмиссия: `src/core/mihomo.js`, `src/build.js`,
`src/core/yaml.js`, `tools/tests/mihomo-policy-routing.test.mjs`), consumer —
runtime `dcc16b68…` (Source: `saymer-alt/web4core@2daf383bde5257c1d8bd15a0f4c719c6b3f8e5d8`).

- Source-тесты форка: `node --test tools/tests/mihomo-policy-routing.test.mjs` — 12/12;
  полный набор форка 158/158; `test:amnezia` 12/12.
- Consumer node-регресс: `JS_YAML_PATH=… node tests/policy-routing.cjs` — 33 кейса
  (parity off, basic, shared provider, `proxy: DIRECT`, AW-совместимость, static,
  предупреждения, структурные ошибки).
- Браузерный UI: `node tests/policy-routing-browser.cjs` — 14 кейсов (панель,
  карточки add/remove, пресеты, сборка, дубликат имён, кламп per-proxy, VALID).
- Полный потребительский набор после изменений: `runtime.cjs` 63/63,
  `whitelist.cjs` 10 кейсов, `browser.cjs` 47 валидатор + pipeline — PASS.
- Реальный `mihomo -t` v1.19.31 (Windows-бинар) на 5 пробах из поставляемого
  runtime: dpr-subscription (GEOSITE/KEYWORD/CIDR), dpr-static, dpr-aw,
  dpr-off-parity, dpr-cyrillic — все successful; per-proxy+DPR отклонён
  движком как задумано. После интеграции с deployment profiles
  (`router / vps-local / vps-gateway`): 9/9 combined-проб на 1.19.31
  (router/vps-local/vps-gateway × DPR on/off, vps-gateway DNS-off,
  MIPS, gVisor) и 5/5 ключевых на **1.19.32** (recommended/current;
  minimum остаётся 1.19.31). Живой PoC маршрутизации — тестовый VPS, 2026-10-01
  (журнал владельца): DOMAIN→POLICY→PROVIDER→NODE доказан на обеих версиях.

## VPS Domain Detection Package — 2026-10-01

Ветка lg `feat/vps-domain-detection` (index.html: `applyDeploymentProfile`
плюс пакет; без изменений web4core/runtime), gateway-ветка
`feat/domain-detection-store-fake-ip` (`8f41759`): патчер сохраняет
`store-fake-ip` генератора; тест `tests/test-mihomo-config-patch.sh`
расширен (preserved `true` + сквозной DDP-фикстура) — 5/5 gateway-тестов
в WSL.

- `tests/vps-detection-browser.cjs` (новый): 46 кейсов — точные формы
  dns-hijack/sniffer/store-fake-ip (dns on), удаление с dns off
  (sniffer остаётся), DPR on/off coexistence, generic byte-parity
  (hwid-нормализация), валидатор VALID.
- Регресс после пакета: runtime 63/63, browser 47, whitelist 10,
  masque 7, policy-routing 33/14 — PASS (non-VPS untouched).
- `mihomo -t` v1.19.31: 4/4 (vps+package mips/gvisor/DPR/dns-off) +
  6/6 интеграционных DPR-проб.
- Live staging (тестовый VPS, Saymer, production-like generated config):
  normal DNS fake-ip; dns-hijack внешнего :53 (9.9.9.9 → fake-ip); DoH →
  sniffer; pure-IP TLS → sniffer; HTTP Host → sniffer; YouTube QUIC —
  полный handshake через TUN; DPR: chatgpt→RuleSet(policy-ai)→AI,
  youtube (fake-ip/pure-IP/:80)→RuleSet(policy-media)→MEDIA,
  example.com→Match→GLOBAL; QUIC negative: тот же IP + SNI example.com →
  GLOBAL; restart gate: fake-ip (youtube=.4/openai=.5/chatgpt=.6)
  восстановлен 1:1 после рестарта, потоки в правильные политики
  (journal PID нового процесса), мисатрибуции нет; cold-start провайдера
  с пустым cache.db — 99 узлов (proxy: DIRECT контракт).


## Docs/help reconciliation — 2026-10-01 (pre-release audit)

Документационно-UX арка (без изменений генерации): речонсиляция доков под модель
профилей `router / vps-local / vps-gateway`, версионный контракт (minimum 1.19.31 /
recommended 1.19.32), merged-статус gateway-патчера (PR #33), исторические заголовки
у датированных аудитов; новая страница [quick-start.html](../quick-start.html) и
контекстная help-система `?` (`.ctx-help`) в Builder.

- Новый `tests/help-ux-browser.cjs`: ссылка «❓ Помощь / Быстрый старт» ведёт на
  существующий `quick-start.html`; обратная ссылка на генератор; страница без
  `fetch`/`XMLHttpRequest`/`localStorage`/telemetry; help-маркеры `?` присутствуют,
  открываются кликом и с клавиатуры (Enter/Escape), `aria-expanded` переключается;
  клик по `?` НЕ меняет состояние чекбокса; YAML до/после help-взаимодействия
  идентичен (x-hwid-нормализация); DPR-подсказка видна в выключенном состоянии;
  gateway-подсказки присутствуют в панели vps-gateway.
- Полная батарея перезапущена на ветке арки — см. финальный отчёт PR.
- Generated YAML: byte/semantic parity с `origin/main` на представительных сценариях
  (router/vps-local/vps-gateway ± DNS, DPR, БС, WG+dialer) — требование контракта §24.

## Per-profile WG/AWG manager — 2026-10-01

Runtime-контракт web4core (`b2a56bb`/`0567353`+fix, ветка link-generators): bean-поле
`wireguard.dialerProxy`, `wgDialerGroupOnly`, ремап dialer-таргетов при
PRIMARY/FALLBACK-переименовании; DPR Fastest fix. Source-тесты форка: **171/171**;
consumer runtime пересобран из форка (provenance в коммите runtime).

- `tests/wg-profiles-browser.cjs` — **15 кейсов**: single, cancel-no-op, append,
  список без секретов, remove, dup-skip, WG+AWG3.1, clear-all, коллизия имён,
  per-profile dialer (Variant A), смешанный direct+dialer с разными таргетами,
  пустой таргет fail-closed, UI-карточка (режим+таргет инвалидируют сборку),
  re-add после удаления, async race.
- Battery: runtime 63/63, whitelist 10, masque 7, policy-routing 33+14,
  browser 47+, vps-detection 54/54, failover 3/3, AWL priority PASS.
- Parity vs `origin/main` (3680b5c): **byte** — wg-single/router/vps-gateway;
  **semantic** — wg-dialer (миграция глобального поля в per-profile наследование).
- `mihomo -t`: 6/6 — 2 direct / 1 direct+1 dialer (группа) / 3 mixed с разными
  таргетами, на **1.19.31** и **1.19.32-compatible** (Windows compatible-бинар).

## ADVANCED container reorg — 2026-10-02 (UI-only)

Блок «⚙ Расширенный TUN stack» перенесён внутрь ADVANCED-контейнера; контейнер
переименован в «ADVANCED — Расширенные настройки»; внутри две подсекции
(TUN stack / Отдельный вход на каждый прокси). TUN Interface и MIPS остались
снаружи. IDs, JS-логика, fail-safe клампы и DOM-tamper защита не менялись.

- browser.cjs: расширена регрессия спойлера — в закрытом ADVANCED стек-контролы
  скрыты, подсекции присутствуют внутри details, значения (master, advanced
  stack, system) переживают open/close, YAML байт-идентичен до/после цикла;
  состояния восстанавливаются для последующих фаз.
- Battery: runtime 63/63, whitelist 10, masque 7, policy-routing 33+14,
  browser 47+, vps-detection 54/54, failover 3/3, AWL PASS.
- YAML parity vs `origin/main` (3680b5c): router/vps-gateway с расширенными
  состояниями — byte-identical (перенос UI не меняет генерацию).


## Contrast/readability pass — 2026-10-02 (CSS-only)

Палитра централизована: `--link`/`--link-hover` (ссылки, заголовок, валидация-в-процессе),
`--text`/`--muted` подняты; active-вкладка — светлый текст + синий underline; hints
переведены с #484f58 на var(--muted); посещённые ссылки закреплены за --link
(без фиолетового). WCAG-контраст на карточке: hint 2.09 → 7.11:1; ссылки 1.84 → 8.89:1;
hover 11.25:1. Семантические green/yellow/red не менялись; разрозненные hex
(#e3b341/#b8860b/#d9534f/#a5d6ff) переведены на переменные. Сгенерированный YAML
не затронут (CSS-only). Полная батарея зелёная; browser.cjs 9/9 прогонов подряд.


## Integration + XP Professional redesign — 2026-10-02

Интеграция ночной цепочки (#82 docs/help → #84 WG manager/per-profile dialer/DPR+AWL fix → #86 contrast, #83 superseded #84, #85 внутри #86) в `integration/v1.6-xp-ui`; pre-theme baseline `1fe6c5d`.

- Интеграционная батарея (11 suites) — зелёная до редизайна.
- **Theme-only parity gate: 13/13 сценариев byte-identical** между 1fe6c5d и XP-деревом
  (router, router+DPR, router+AWL, vps-local, vps-gateway ± DNS, WG single/multi direct,
  WG per-profile dialer, WG/AWG mixed, Per-Proxy, advanced system, advanced mixed).
- Батарея на XP-дереве: runtime 63/63, whitelist 10, masque 7, policy-routing 33+14,
  browser 47+, policy-routing-browser 14, vps-detection 54/54, help-ux 10, wg-profiles 15,
  failover 3/3, AWL priority PASS.
- `mihomo -t`: 6/6 (2 direct / dialer-группа / 3 mixed) на **1.19.31** и **1.19.32-compatible**.
- Owner acceptance bundle: 12 скриншотов (builder/warp/profiles/WG manager/ADVANCED ±/DPR/
  validation ±/quick-start/mobile 390 main + WG cards).


## XP layout polish + file picker accept — 2026-10-02 (CSS/DOM-attribute only)

- Layout cleanup поверх XP-редизайна: одна Luna-titlebar (quick-start `h2` → section
  headings), вложенные рамки ADVANCED упрощены, `.card-title` hardened, кнопки одной
  высоты, WG-карточки без распирания; responsive 1440/1024/768/390.
- `#wgFile accept=".conf,.wg,.awg"` (было `…,text/plain` — Windows TXT-first);
  `multiple` сохранён; regression в `tests/wg-profiles-browser.cjs` (16-й кейс).
- Theme-only parity: **13/13 byte-identical** к baseline 1fe6c5d; батарея зелёная.

## v1.6.2 (2026-10-02): dialer selector + profile contracts + ctx-help regression

- Новый `tests/profile-matrix.cjs` — **11 кейсов**: матрица дефолтов (Sub Mode ON во
  всех профилях, БС/Per-Proxy доступны только в router), переходы
  router→vps-local→router / router→vps-gateway→router / vps-local→vps-gateway без
  stale-флагов и silent-подмен, per-profile snapshots (ручное router-состояние
  переживает визит в VPS: БС ON, Per-Proxy ON+children, ручной Sub Mode OFF),
  DOM-tamper: БС в VPS → явная ошибка сборки без silent-конверсии; Per-Proxy в VPS →
  Per-Proxy конфигурация не генерируется.
- Новый `tests/wg-dialer-selector.cjs` — **12 кейсов**: authoritative registry
  (префлайт-сборка движком; точные имена incl. `collide`/`collide-2`), self-exclusion
  по итоговому имени, WG→WG / WG→static / WG→generated group / WG→provider-backed
  group, manual-ADVANCED путь (dangling → ошибка «не существует в генерируемом
  конфиге»), target removed → сброс + пометка, became-self после схлопывания
  коллизии, dynamic refresh (ввод, WG-файлы, dialer-группа, Sub Mode), cycle
  A→B→A отклоняется движком, AWL rename в dropdown.
- `tests/help-ux-browser.cjs` расширен до **16 кейсов**: hover (`:hover`) и
  focus (`:focus-within`) открывают tooltip, mouseleave закрывает, `.open`
  переживает mouseleave, Escape закрывает и снимает фокус, новые подсказки
  (Sub Mode, БС, Per-Proxy master, MagiTrickle, WG-карточки, MT-маппинг).
- `tests/browser.cjs` переведён на контракт v1.6.2: Sub Mode явно задаётся после
  каждого переключения профиля (per-profile default), vps-gateway без Per-Proxy
  listeners + восстановление router-Per-Proxy после VPS, БС router-only
  (профиль не подменяется), snapshot-блоки без БС-манипуляций в VPS.
- `tests/whitelist.cjs` — открытие переведено на контракт router-only (БС/Per-Proxy
  disabled в vps-gateway, восстановление router-children), tamper-блок: БС+VPS →
  явная ошибка без сборки; БС+children → кламп.
- Parity: 7/7 byte-identical vs main (5837cea); DPR-off байт-идентичен; `mihomo -t`
  6 YAML × (1.19.31, 1.19.32) successful; HTML integrity clean.

---

## CI automation vs owner field test (2026-10-03)

Вся deterministic-батарея выполняется GitHub Actions на exact SHA — агент не
прогоняет её руками при каждом изменении и в отчётах ссылается на runs
(`run <id>`, commit, job, PASS/failure-анализ), а не на «я прогнал».

### Что где выполняется (merge-gates)

| Check | Workflow / job | Что покрывает |
|---|---|---|
| static + node | `generator-ci.yml` / static-and-node | repo-invariants, merge-маркеры, `node --check` (runtime + все tests/*.cjs + fieldtest), HTML-контракт (dup ids, raw .md links), **wiring-gate** (каждый не-manual `tests/*.cjs` обязан быть подключён к CI — новый сюит без workflow-правки ломает CI), `runtime.cjs`, policy-routing (node), fieldtest unit+secret-scan |
| browser | `generator-ci.yml` / browser | `browser.cjs` (валидатор, DPR/профили/БС/snapshots/tamper, subscription inspection, **4 race-теста reordered-promise**: input/subMode mutation in flight, double Build, preview/inspected-cache), help-ux, MASQUE, policy-routing-browser, vps-detection, wg-profiles, magitrickle-import, **profile-matrix**, **wg-dialer-selector**, whitelist, **YAML parity vs merge-base** (`tests/parity.cjs`, BASE = merge-base с `main`; red = молча меняется дефолтный YAML) |
| mihomo compat | `generator-ci.yml` / mihomo-compat (matrix) | whitelist + failover + awl-priority против **реального Mihomo**, версии **pinned 1.19.31/1.19.32 с sha256-верификацией архива** (новый релиз Mihomo сам не меняет смысл CI) |
| runtime provenance | `update-web4core-runtime.yml` / build-runtime | полные fork-тесты web4core (auto-discovery `tools/tests/*.test.mjs` — вкл. subscription fetch/worker/exclude-filter/tun-stack/amnezia), deterministic rebuild, `node --check`, `runtime.cjs`, **tracked-vs-built provenance**; на push в main — write-back job (copy-only) |
| stacked provenance | `update-web4core-runtime.yml` / stacked-runtime-provenance | для стековых PR: файл `.github/web4core-source-ref` объявляет candidate-ref web4core; job строит его, гоняет полный fork suite + `runtime.cjs` и требует байт-совпадение с tracked runtime. Production-проверка (build-runtime) от файла не зависит и остаётся красной до merge зависимости — это задокументированное исключение; после merge файл удаляется (guard: ref == published tip → job красный с напоминанием) |
| fieldtest harness | `fieldtest-checks.yml` | offline unit + secret-scan; живые field-test режимы в CI запрещены guard-шагом |

Правила: fail-closed (никаких `continue-on-error`/`|| true` на обязательных
шагах); пути к dependency-артефактам — copy-only; версии зависимостей
зафиксированы (playwright 1.55.0, js-yaml 4.1.0, node 22).

#### Порядок сборки runtime в CI

В Fork CI и Update runtime workflow веб-runtime собирается ДО запуска
тестов: `subscription-endpoint.test.mjs` читает собранный бандл и
доказывает, что production CORS endpoint совпадает с source. Если
добавляется тест, читающий бандл, — порядок уже корректен (build → test).
`build-runtime` в Update workflow использует тот же порядок.

### Server list / subscription exclusion UX (issue #100, 2026-10-03)

- Toggle `cfgServerList` OFF по умолчанию: Sub ON + Build = ноль
  `fetchSubscription`-вызовов; provider YAML без browser inspection.
- Toggle ON + явная кнопка «Получить список»: fetch ровно по клику;
  список имён (только display names, без URI/UUID/кредов); счётчики
  «Уникальных имён / исключается / останется».
- Device Model: пусто → fallback `Saymer Link Generators Preview`;
  заполнено → пользовательское значение в x-device-model; HWID
  не меняется.
- Selection: галочки → union с manual filter (exact-match escaping);
  Sub ON/OFF — одинаковое исключение; search фильтрует только
  отображение; select all / clear all; refresh prune.
- Sub OFF: mandatory fetch с toggle OFF (inline expansion требует
  содержимое подписки); union применяется к развёрнутым узлам.
- Stale-safe: поздний/неудачный ответ не меняет output/state/Copy;
  server list stale race отбрасывается.
- WG/AWG hint: текст про несколько файлов/профилей.

## Owner field test (не автоматизируется)

Только то, что требует внешнего мира: реальная GeoDema/Remnawave account с
device-лимитом (стабильность HWID между сборками на живой панели), production
deployed worker `sub.saymer-87.workers.dev` (POST-контракт с device headers + production smoke в deploy workflow),
реальные CORS/сетевые особенности браузера, живой Keenetic/VPS при необходимости.
Manual-сюиты (`*.manual.cjs`: reality-handshake matrix, awl-soak) — по явному
запросу владельца, guard не даёт их случайно подключить к CI.

## Reverse Build / Config Studio 2.0 (DAY-01)

- `tests/project-roundtrip-browser.cjs` — сохранить/загрузить проект,
  поле-в-поле равенство, byte-parity повторного Build, модификация
  состава, undo, bounded-ошибка битого файла.
- `tests/reverse-yaml-browser.cjs` — YAML Reverse: предпросмотр
  восстановления (счётчики/статусы/сравнение), byte-parity для
  подписочных конфигов, честный UNSUPPORTED/MISSING для прямых узлов.
- `tests/qa-reverse-integration.cjs` — полный сценарий владельца
  6 подписок + 8 WG/AWG + DPR: Save/Load/модификация −1 AWG +2 подписки;
  фаза A сохраняет проверку отсутствия прежнего DPR×Tiered конфликта; native Load Preview/Cancel/Confirm проверяется в новой сессии. При MIHOMO_BIN итоговые modified и reversed YAML проходят реальный -t.
- `tests/qa-fixes-browser.cjs` — матрица DPR ON/OFF × Tiered ON/OFF
  (все комбинации VALID) + WG base64-ключи (32 байта, сообщение без
  значения ключа).
- `tests/cs20-ux-browser.cjs` — секреты редактора Studio: показать/
  скрыть/заменить, замаскированность диффа и статусов.


## Независимый аудит v1.11 (2026-10-09)

- `independent-product-browser.cjs`: 6 групп — настоящий Preview/Cancel/Confirm, stale YAML/Builder, loss acknowledgment, blocked conflict, atomic Apply fault injection, Undo/passthrough, async Build invalidation, typed Compare/source classification. CI browser.
- `independent-boundaries-browser.cjs`: 7 проверок — типы JSON, depth/nodes/unsafe keys, WG IDs/shape, Builder/Studio SVG/aria/select redaction, keyboard focus и изоляция focus. CI browser.
- `independent-reverse-profiles-browser.cjs`: 3 группы — реальный Build → Reverse → Build byte parity gateway DNS OFF/ON, custom device/MTU/resolvers, Yacd/custom health-check; disabled TUN. CI browser и обе Mihomo matrix jobs.
- `cs20-ux-browser.cjs`: 4 проверки, включая Save без изменений (исходные байты) и Reset секретной замены.
- `qa-reverse-integration.cjs`: 6 browser checks либо 7 с MIHOMO_BIN; 6+8 → новая сессия Load Preview/Confirm → 8+7 → YAML Reverse. С MIHOMO_BIN modified и reversed outputs проходят -t. Теперь входит в обе matrix jobs.
- `security-stress.cjs`: 49 групп; browser: 59 проверок. Viewports 320/360/375/390/412/480/768/1024/1366/1440/1920/2560, Studio и PT overflow.

Локально: 53 CJS suites в общем прогоне + отдельный parity (10/10 vs main955ecdf) = 54; harness node:test 31/31. Последующие focused reruns покрывают final Load consent, секреты и расширенные widths. Linux runtime labs выполняются в CI с pinned Mihomo 1.19.31/32; локально Windows 1.19.31 parse-only. Это не Firefox/WebKit, не WAN/handshake и не owner field test. Ненулевых Edge exits в этом прогоне не было.

PR #207 проверяется отдельно: dns-routing-core (15 групп), dns-routing-browser (10 проверок), dns-routing-mihomo-compat (5 parse-only cases, обе версии). Эти файлы остаются на candidate branch до OWNER GO; наличие записи в этом разделе не означает promotion. Отчёт: [V1.11-CODEX-INDEPENDENT-AUDIT-AND-REPAIR](research/V1.11-CODEX-INDEPENDENT-AUDIT-AND-REPAIR.md).
