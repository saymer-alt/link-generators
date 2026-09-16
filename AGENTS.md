# AGENTS.md — link-generators

## Дополнение: автоматический режим белых списков

См. [docs/AUTO-WHITELIST.md](docs/AUTO-WHITELIST.md). UI policy остаётся здесь;
generic `fallbackInput` и плоский primary/fallback GLOBAL живут в fork. Отсутствие
`fallbackInput` сохраняет старый output. Обязательны `tests/whitelist.cjs`,
baseline, реальный Mihomo -t и `tests/mihomo-failover.cjs`; source suite включает `mihomo-priority.test.mjs`.


Инструкция для AI-агентов (в первую очередь ZCode), работающих в этом репозитории.
Три слоя документации: **README.md** — пользовательская landing page (что это и как
пользоваться), **docs/** — подробная техническая база знаний (архитектура, dataflow,
протоколы, валидация, обновления рантайма, тестирование), **этот файл** — правила для
агента. При расхождении верить коду; несоответствие коду чинить в документации, код —
только по задаче владельца.

## Что это

Статический одностраничный веб-инструмент «WARP & Mihomo Unified Generator», выложенный
на GitHub Pages: https://saymer-alt.github.io/link-generators/ . Всё работает на клиенте:
две вкладки — генератор `masque://`-ссылок для WARP и сборщик `config.yaml` для Mihomo.

Чего в проекте НЕТ (не придумывать): сборочной системы приложения, package.json,
npm-зависимостей приложения, линтера, бэкенда. С 2026-09-15 есть Node regression tests
в `tests/`; runtime-тест выполняется также в workflow автообновления.
Каждый пуш в `main` немедленно публикуется на Pages — «main = прод».

Язык проекта — русский (UI, комментарии, документация). Код-стайл: всё инлайн в одном
HTML-файле, компактный hand-written JS без фреймворков, комментарии-маркеры вида
`// === SECTION ===`.

## Состав репозитория (все файлы)

| Файл | Роль | Редактировать |
|---|---|---|
| `index.html` | Всё приложение: inline CSS + inline JS; единственная страница | Да — основной файл |
| `web4core.runtime.js` | Вендоренный артефакт сборки saymer-alt/web4core@link-generators | НЕТ — см. ниже |
| `tests/` | Node/browser regression tests и fixtures | Да — синхронно с проверяемыми контрактами |
| `docs/` | Внутренняя база знаний: ARCHITECTURE, DATAFLOW, MIHOMO, PROTOCOLS, VALIDATION, UPDATES, DEVELOPMENT, TESTING | Да — синхронно с изменениями поведения |
| `.github/workflows/update-web4core-runtime.yml` | Автообновление рантайма | Аккуратно: имеет право писать в `main` |
| `README.md` | Пользовательская landing page (переписана 2026-09-08) | Да, но не молча переписывать |
| `.nojekyll` | Отключает Jekyll-обработку на Pages | Не трогать |
| `LICENSE` | BSD-3-Clause (унаследована от web4core) | Не трогать |

Историческое: `mihomo.html` (байт-копия `index.html` под вторым адресом) удалён
2026-09-08 (e2cd5a9) как неиспользуемый артефакт — не восстанавливать; `/mihomo.html`
на Pages отдаёт 404, это ожидаемо.

## Архитектура: где какая логика

Этот репозиторий — **UI/browser layer**. Protocol engine находится в
`saymer-alt/web4core:link-generators`; runtime собирается из нашего fork.
Новые parsers/builders и общую семантику протоколов не дублировать в `index.html`.
UI-specific normalization/post-processing оставлять здесь только если это
ответственность формы, UX или deployment profile; существующие AWG wrappers не
переносить попутно. Новый outbound validation обычно затрагивает оба репозитория.

Validator, README и docs должны отражать только реальную end-to-end поддержку:
распознанный URI или разрешённый YAML-тип сами по себе не доказывают работоспособность.
Полная карта, выбор слоя и workflow будущего агента — `docs/WEB4CORE-FORK.md`.
До изменения читать AGENTS обоих репозиториев, проверять branch/remotes/status,
определять scope; после — tests/build, runtime comparison и review до commit/push.
Workflow обязан оставаться воспроизводимым и fail-closed: не пропускать ошибки
checkout/build/tests, не копировать непроверенный runtime, не делать force-push.

### Вкладка 1 «WARP MASQUE Links» — вся логика инлайн в `index.html`

- `parseYaml()` — импорт YAML-конфига от Telegram-бота: `jsyaml.loadAll` по всем документам,
  ищется `proxies[0]` либо объект с ключом `private-key`/`privateKey`; без `private-key`
  отказ. Заполняет поля формы (privateKey, publicKey, ip, ipv6, sni, dns).
- `generateWarp()` — генерация пар ссылок QUIC + H2. Это НЕ случайные числа, а выверенная
  анти-DPI стратегия (в коде помечена комментариями «П.1/П.2/П.3») — см. «DPI-стратегия».
- `sendToMihomo()` — перенос сгенерированных ссылок во вкладку 2 и автосборка.
- `js-yaml@4.1.0` грузится с jsdelivr CDN — единственная внешняя сеть-зависимость страницы.

### Вкладка 2 «Mihomo Config Builder» — обёртка над рантаймом + собственные слои

Парсинг ссылок и генерация YAML — в `web4core.runtime.js`; `index.html` собирает запрос,
вызывает API и добавляет собственные слои поверх результата:

- `buildMihomo()` → `globalThis.web4core.buildFromRequest({ core: 'mihomo', input, wgBeans, options })`.
- WG/AWG-файлы (`.conf`, `.wg`, `.awg`, multiple) → `web4core.parseWireGuardConf(text, filename)` → массив `wgBeans`.
- Список health-check endpoints → `web4core.URLTEST_CHOICES` (Google/Cloudflare/Apple/Microsoft/Ubuntu/Fedora;
  фолбэк — Google generate_204).
- Опции страницы → поля `options`: `addSocks` (mixed-port 7890), `addTun`, `webUI`,
  `urlTest`, `mihomoSubscriptionMode`, `mihomoPerProxyTun`, `mihomoTunStack`, `perProxyPort`,
  `excludeFilter` (только Sub Mode; пусто → прежний output),
  `webUiDashboard`/`webUiCustomUrl` (выбор дашборда external-ui-url: metacubexd-дефолт
  сохраняет byte-parity; custom требует абсолютный http/https URL).
- Зависимости опций (группа «Расширенный режим: отдельный вход на каждый прокси»):
  advanced-крышка (`cfgPerProxyMaster`, по умолчанию OFF) обязательна для обоих child'ов;
  MIPS (`cfgTunMips`) и «TUN на каждый прокси» (`cfgPerProxyTun`) требуют `cfgTun`;
  «SOCKS-порт на каждый прокси» (`cfgPerProxySocks`) требует `cfgSocks`; выключение
  родителя отключает и сбрасывает зависимую опцию (`updateMihomoOptionStates()`).
  `buildMihomo()` не доверяет DOM и повторно клампит те же зависимости
  (включая master): `addTun=false` → `mihomoPerProxyTun=false` и
  `mihomoTunStack=gvisor`; `addSocks=false` → `perProxyPort=false`.
- В per-proxy режиме runtime добавляет скрытую url-test группу «🌐 static-health»
  (hidden: true) над static-листьями: без неё static прокси лишены health-check
  (регрессия upstream a0859bf); провайдеры чекаются собственными механизмами.
- Чекбокс «Allow LAN» — постобработка: регэксп-патч `allow-lan: false → true` и вставка
  `bind-address: "*"` ПОСЛЕ того, как рантайм вернул YAML-строку. Патч привязан к
  текстовому формату YAML, который генерирует рантайм.
- Собственный слой страницы (не рантайм), добавлен локально:
  - **AWG-совместимость**: `normalizeWgText` (диапазон `PersistentKeepalive = 25-35` →
    скаляр и булевы `RandomTrailers`/`DisableCookies = on|off` → `1|0` ДО парсинга —
    официальный формат литералов AWG 3.1; заодно снимается UTF-8 BOM), `normalizeWgBeans`
    (авто `version: 3` при наличии AWG 3.x-полей — иначе mihomo молча использует
    legacy-движок; range-строки на int-полях mihomo `jc/jmin/jmax/s1-s4/itime` —
    `AWG_INT_KEYS` — сворачиваются к нижней границе, иначе декодирование всего конфига
    падает), `injectWgDns` (dns/`remote-dns-resolve` для wireguard-прокси из поля
    «WireGuard DNS»; повторный dump только `jsyaml.dump(..., { lineWidth: -1 })`, иначе
    рвутся длинные base64-строки). Форматы значений AWG и матрица версий mihomo —
    docs/PROTOCOLS.md.
  - **DNS-защита**: DNS `100.64.0.1` (Amnezia Premium) → автоподстановка `1.1.1.1, 8.8.8.8`
    с предупреждением.
  - **Pre-copy валидатор**: после Build Config финальный YAML проходит
    `validateMihomoYaml()` — state machine NOT_BUILT→VALIDATING→VALID/INVALID,
    генерационный счётчик против race, Copy YAML заблокирована при INVALID. Enum-списки
    типов/групп сверены с исходниками mihomo v1.19.x. Подробно — docs/VALIDATION.md и
    docs/TESTING.md.

Рантайм additionally умеет сборку под sing-box и xray (`buildSingBox*`, `buildXray*`) и
другие экспорты (`buildBeansFromInput`, `validateBean`, `computeTag`,
`getAllowedCoreProtocols`, `fetchSubscription`, `buildMihomoYaml`, …) — страница их не
использует, но они часть публичного API `globalThis.web4core`.

### Связь файлов

`index.html` (единственная страница) подключает `./web4core.runtime.js` обычным
(классическим) `<script>` — не module, поэтому страница работает и с `file://`. Если
рантайм не загрузился, все действия builder'а показывают toast «web4core.runtime не
загружен».

## web4core.runtime.js — сгенерированный файл, руками не трогать

MIPS реализован в исходниках настоящего fork `saymer-alt/web4core`, ветка
`link-generators`: `src/build.js` передаёт `options.mihomoTunStack`,
`src/core/yaml.js` нормализует `opts.tun.stack` и использует его для обычного TUN
и Per-Proxy listeners. Только точное `mips` включает MIPS; fallback — `gvisor`.

Это IIFE-бандл штатной esbuild-сборки fork (`npm ci && npm run build:web:runtime`,
Node 22). `web4core.runtime.js` руками не редактировать: он должен воспроизводиться
из исходников fork. Textual bundle patch удалён. Изменения парсинга/эмиссии —
в source-ветке fork в согласованном scope; upstream PR предпочтителен для общих
исправлений, wrapper в `index.html` остаётся вариантом для адаптаций входа/выхода.
Новые протоколы требуют отдельной задачи владельца. Подробности — `docs/UPDATES.md`.

В конце бандла — единственная точка экспорта: `globalThis.web4core = { … }`.

## GitHub Actions: автообновление рантайма

`.github/workflows/update-web4core-runtime.yml`: push в `main`, еженедельный
cron `17 4 * * 1`, ручной dispatch. Checkout этого репо и
`saymer-alt/web4core@link-generators` → Node 22 → npm ci → source Mihomo tests
→ upstream build command → node --check → tests/runtime.cjs → artifact.
Сборка и тесты выполняются с `contents: read`, без сохранённых Git credentials.
Отдельный свежий job с `contents: write` только сравнивает/копирует runtime и при
отличии создаёт «Update web4core runtime from upstream» в `main`. Код artifact
там не выполняется. При изменении main после проверки — отказ; force-push запрещён.
Синхронизация upstream в custom branch — controlled merge с review и тестами,
не автоматический merge внешнего кода (см. `docs/UPDATES.md`).

Следствия для агента:
- каждый твой пуш в `main` запускает этот workflow (даже если runtime не менялся — тогда
  он завершится без коммита);
- скоро после твоего пуша в `main` может появиться бот-коммит, меняющий только
  `web4core.runtime.js` — это нормально, не откатывать;
- обновление рантайма меняет поведение парсинга/сборки без изменения `index.html` —
  после автообновления стоит проверять страницу вручную (в первую очередь allow-lan
  регэксп-патч).

## README и код: что источник истины

Историческая справка: в README когда-то описывались три вкладки, «Warpscout Parser» и
режим «WARP-in-WARP» (чекбокс + `dialer-proxy`). Эти функции были добавлены в
`index.html` 19.08.2026 и удалены тем же вечером — страница возвращена к
двухвкладочному варианту; восстанавливать их нельзя (см. правила ниже). 08.09.2026
README переписан как пользовательская landing page; подробная техническая документация
живёт в `docs/`, правила для агентов — в этом файле.

Принцип: источник истины — КОД. Если README расходится с кодом, это устаревший README,
а не баг кода. Правила:

- в текущем коде НЕТ warpscout-парсера, `warpscout-account.json`, чекбокса WARP-in-WARP
  и `dialer-proxy` (0 вхождений в HTML и рантайме). Самостоятельно «восстанавливать» их
  нельзя — ни по старому README, ни по истории git (ревизия ed835e8/74a3f24);
- если задача звучит как «починить/вернуть warpscout» — остановиться и уточнить у
  владельца: восстанавливать или это устаревшая постановка;
- правки кода, меняющие набор вкладок/фич, сопровождаются синхронной правкой README;
- страница сейчас умеет только YAML-импорт от Telegram-бота (`parseYaml`); сырые
  warpscout-логи она не парсит.

## Форматы входных данных и контракты

### MASQUE: DPI-стратегия генерации (load-bearing, не менять «ради улучшения»)

Формат выходной ссылки (параметры и их имена — контракт, их парсят внешние импортеры,
включая сам web4core при обратном импорте во вкладку 2):

```
masque://IP:PORT?sni=…&private-key=…&public-key=…&ip=…&udp=true&remote-dns-resolve=true[&ipv6=…][&dns=…][&network=h2]#ИМЯ
```

- base64-ключи обязательно URL-энкодятся (`urlEncodeKey`: `+ / =` → `%2B %2F %3D`).
- QUIC: только фиксированный пул `162.159.198.2 / 162.159.198.1 / 162.159.199.2`, всегда порт 443.
- H2: IP только из `162.159.198.x / 162.159.199.x` (последний октет 1–254).
- Порты H2 — взвешенный рандом. Safe Ports Only (по умолчанию): 443 (70%), 8443 (20%),
  4443 (5%), 8095 (5%). Полный режим добавляет VPN-порты 500/1701/4500 (риск семантического
  конфликта у DPI — поэтому по умолчанию выключены).
- Анти-корреляция: если порт H2 совпал с портом QUIC, IP H2 обязан отличаться от IP QUIC.
- Имена профилей: `PROFILE-QUIC[-N]` (без порта) и `PROFILE-H2-<port>[-N]`.
- Дефолты полей — часть поведения: SNI `4pda.to`, DNS `1.1.1.1,1.0.0.1`, IP `172.16.0.2`,
  профиль `WARP-MASQUE`.

### Вход вкладки 2: ссылки и подписки

Рантайм парсит схемы (SUPPORTED_SCHEMES): `vmess, vless, trojan, anytls, ss, socks,
socks4, socks4a, socks5, socks5h, http, https, hy2, hysteria2, tuic, tt, mieru, mierus,
sdns, masque`. Подписка-хинт в UI перечисляет меньше — фактический список шире.

Ядро mihomo принимает (CORE_PROTOCOL_SUPPORT): `vmess, vless, trojan, anytls, ss, socks,
http, hy2, tuic, wireguard, masque, mieru, trusttunnel`.

Подписки: строка `http(s)://…` без логина/пароля в URL считается подпиской (в Sub Mode —
proxy-providers с refresh 43200 с и fallback-ретраями); URL с кредами считается обычной
ссылкой. `fetchSubscription` в браузере упирается в CORS — работают только отдающие
CORS-заголовки источники; это ограничение платформы, не баг.

### WireGuard / AmneziaWG

Файлы `.conf` / `.wg` / `.awg` парсятся на клиенте `parseWireGuardConf(text, fileName)`.
Формат AmneziaWG (`Jc/Jmin/Jmax/…` параметры) поддерживается рантаймом.

### Контракт buildFromRequest

`buildFromRequest({ core, input, wgBeans, options })` → `{ kind: "yaml", data: <строка> }`.
Дефолты ядра mihomo: `webUI=true`, `addSocks=true`, `addTun=false`; требуется хотя бы один
inbound (TUN или SOCKS), иначе ошибка «Mihomo: enable at least one inbound». Пустой ввод
при пустых wgBeans → ошибка «No valid links or profiles provided».

### Профиль развёртывания «VPS Gateway» (opt-in, 2026-09-09)

Дополнительный post-processing сценарий для amnezia-mihomo-gateway (Mihomo-половина
gateway-конфига). Подробно — docs/VPS-GATEWAY.md. Инварианты, которые нельзя нарушать:

- селектор `#cfgProfile` по умолчанию = `generic`; при `generic` функция
  `applyDeploymentProfile()` НЕ вызывается (guard в `buildMihomo()`) — вывод
  байт-в-байт прежний, без лишних `jsyaml.load/dump`;
- `tun.auto-route: false` — жёсткий инвариант, в UI не выставляется;
- дефолты профиля = переменные текущего `install.sh` amnezia-mihomo-gateway
  (`PROXY_IF`/`TUN_INET_ADDR`/`FAKE_IP_RANGE`, пакет v2.0); якорь — константа
  `VPS_GATEWAY_DEFAULTS` в `index.html`; при изменении в gateway-репо — синхронизировать;
- DNS-блок существует только внутри vps-профиля (sub-toggle `#vpsDnsEnabled`);
  выключение удаляет `dns` целиком; в generic `dns` не появляется никогда;
- порядок постобработки: `injectWgDns` → `applyDeploymentProfile` (только vps) →
  allow-lan регэксп-патч; повторный dump — только
  `jsyaml.dump(doc, { lineWidth: -1 })`;
- Linux-часть gateway (policy routing, iptables, Docker, AWG, systemd, watchdog)
  генератором не создаётся — это зона amnezia-mihomo-gateway.

## Правила внесения изменений

1. Перед изменением логики генерации (ссылки, YAML, парсинг) — сначала разобраться в
   существующем формате и контрактах выше; не менять поведение «ради улучшения» без
   задачи на это. Формат ссылок и структуру YAML пользователи вставляют в свои роутеры —
   молчаливые изменения ломают чужие конфиги.
2. Править `index.html` — он единственная страница приложения (историческое зеркало
   `mihomo.html` удалено, см. таблицу файлов выше).
3. `web4core.runtime.js` не редактировать вручную никогда (перезапишется автообновлением).
4. Минимальные диффы; не реформатировать не тронутые участки; сохранять существующий
   инлайн-стиль и русские тексты UI. Не вводить сборку, npm, ES-модули, фреймворки —
   классический `<script>` и работа с `file://` являются фичей.
5. Не менять DOM-id элементов (`mihomoInput`, `cfgLan`, `pingSelect`, …) без синхронного
   обновления JS — вся привязка по id.
6. Новый функционал сборки — через публичный API `globalThis.web4core` или постобработкой
   результата; изменения самого runtime — в исходниках fork в согласованном scope.
7. Коммитить только целенаправленные изменения; перед коммитом проверить `git status` /
   `git diff`: в диффе не должно оказаться ничего, кроме задуманного (особенно — случайных
   изменений `web4core.runtime.js`).

## Проверки после изменения HTML/JS

Автоматические регрессии: `node tests/runtime.cjs` и внешний Playwright-прогон
`tests/browser.cjs` (подробно — docs/TESTING.md). Дополнительные проверки:

1. Синтаксис JS: inline-скрипт `index.html` извлечь (содержимое последнего тега
   `<script>…</script>`) и прогнать через парсер; на хостах с Node — `node --check`
   (в т.ч. для `web4core.runtime.js`).
2. Ручной прогон в браузере (открытие `index.html` напрямую с `file://` работает;
   для js-yaml с CDN нужен интернет): обе вкладки; полный сценарий — вставить YAML →
   «Распарсить» → «Сгенерировать» → «В Mihomo Builder» → «Build Config» → валидация →
   Copy; убедиться, что нужные опции (allow-lan, mixed-port, TUN) отражены.
3. Регрессионный минимум валидатора: `transport: TPC` → INVALID и Copy заблокирована,
   `TCP` → VALID; AWG 3.1 `.conf` → VALID (`version: 3` в YAML); любое изменение ввода
   сбрасывает статус проверки.
4. После пуша: проверить живую страницу https://saymer-alt.github.io/link-generators/ и
   (если прилетел бот-коммит рантайма) повторить ручной прогон — в первую очередь
   allow-lan патч и enum-списки валидатора (docs/UPDATES.md).

## Конфиденциальность и безопасность

- Пользователь вставляет сюда секреты: private/public ключи WARP, адреса, SNI. Сейчас
  страница ничего не отправляет и нигде не хранит: в `index.html` нет ни `fetch`,
  `XMLHttpRequest`, `sendBeacon`, ни `localStorage`/`sessionStorage` — только запись в
  буфер обмена. Так и должно оставаться: НЕ добавлять телеметрию, аналитику, отправку
  данных, сохранение ключей в хранилище.
- Нюанс рантайма: `web4core.fetchSubscription()` умеет скачивать текст подписки из
  браузера и при неудаче прямого fetch уходит на публичный CORS-прокси
  `sub.web2core.workers.dev` (инфраструктура апстрима). Текущий UI его НЕ вызывает —
  подписки качает сам Mihomo через `proxy-providers`. Подключение fetchSubscription =
  решение о передаче URL подписки третьей стороне — только с явного согласия владельца.
- Пользовательский ввод недоверенный (YAML от бота, ссылки, файлы): парсить в try/catch
  с понятной ошибкой в toast — как сделано сейчас.
- Осторожно с `innerHTML`: `generateWarp()` вставляет сгенерированные ссылки через
  `innerHTML` (ссылки содержат пользовательские ключи/SNI). Существующую поверхность не
  расширять; при рефакторинге предпочтительнее `textContent`.
- Ключи в ссылках маскировать/обрезать при цитировании в issue, коммит-сообщениях и
  логах.

## Типичные опасные регрессии

- Потерять URL-энкодинг base64-ключей (`+ / =`) — ссылки станут невалидными.
- Нарушить анти-корреляцию IP, вынести QUIC с порта 443 или «выпрямить» веса портов —
  ломается вся DPI-стратегия.
- Отредактировать `web4core.runtime.js` вручную — правка тихо исчезнет при следующем
  автообновлении.
- Не «восстанавливать» удалённый `mihomo.html` — убран осознанно (e2cd5a9); ссылки на
  `/mihomo.html` отдают 404, это ожидаемо.
- После обновления рантайма или смены целевой версии mihomo — сверить enum-списки
  валидатора и контракт allow-lan патча (docs/UPDATES.md).
- После обновления рантайма не проверить allow-lan регэксп-патч — сменившийся формат YAML
  сломает его молча (замена просто не найдёт строку).
- Изменить дефолты чекбоксов/полей — пользователи зависят от текущих значений. Дефолты
  `cfgTun: checked` (подтверждён владельцем 2026-09-15) и `cfgTunMips: checked`
  (решение владельца 2026-09-16, NIGHT-09; рядом предупреждение «требует Mihomo
  >= 1.19.31», генерацию не блокирует) — осознанные. `system`/`mixed` доступны только
  за крышкой `cfgTunStackAdvanced` (OFF по умолчанию; override снимает MIPS чекбокс —
  единое состояние UI/YAML). Дефолты больше не менять мимоходом.
- Сломать зависимости TUN/Mixed → дочерние опции или их fail-safe клампы в `buildMihomo()` —
  невозможные DOM-состояния снова станут достижими; baseline 256 масок в
  `tests/whitelist.cjs` нормализован по этим зависимостям, а валидные комбинации
  (`socks=0+perSocks=1`, матрице не принадлежащие) покрыты bypass-тестом.
- Включить профиль VPS Gateway по умолчанию или выполнять `applyDeploymentProfile()` при
  `generic` — изменит вывод основного сценария (нарушение главного инварианта профиля).
- Менять дефолты VPS-профиля без сверки с `install.sh` amnezia-mihomo-gateway — конфиг
  перестанет совпадать с routing-скриптом (device/fake-ip-range/inet4-address установщик
  перезаписывает или не находит).
- Забыть `lineWidth: -1` в `applyDeploymentProfile()` — jsyaml перенесёт длинные AWG
  base64-строки (I1–I5/H) и молча испортит конфиг.
- Расширить `AWG_INT_KEYS` в `normalizeWgBeans` на строковые range-поля (`h1-h4`,
  `content-padding-addition`, rekey-*/keepalive/max-handshake таймеры) — mihomo держит их
  строками, v3-движок парсит «lo-hi» как UintRange: свёртка к числу сломает легальные
  диапазоны (Amnezia Premium пишет H1–H4 диапазонами).
- «Чинить» неработающий AWG 3.1-туннель генератором, когда ядро на устройстве старше
  mihomo 1.19.30 — все 3.1-ключи в `amnezia-wg-option` ядро молча игнорирует (двусторонние
  `HeaderProtectionKey`/`RandomTrailers` → туннель не поднимется). Production runtime
  (официальный релиз, v1.19.30) поддержку имеет; диагностику начинать с `mihomo -v` на
  устройстве — версия opkg-пакета может не совпадать с реальным бинарником
  (update-mihomo.sh меняет бинарник напрямую, мимо opkg), а `PKG_VERSION` в Makefile
  entware-go — версия апстрим-синка, не продакшена.
- «Восстановить» warpscout / WARP-in-WARP / `dialer-proxy` — они удалены сознательно
  (19.08.2026), см. раздел «README и код».
- Перевести подключение рантайма на ES-модули — сломается открытие с `file://`.


## Технический долг

- Технический долг выявлять и фиксировать как отдельный инженерный риск, но не путать его с косметикой, личными стилевыми предпочтениями или просто «некрасивым» рабочим кодом.
- Для каждого найденного долга сначала привести evidence и классифицировать влияние: **High** (риск поломки/безопасности/потери данных или блокирует эксплуатацию), **Medium** (мешает развитию, создаёт дублирование или расхождение логики, заметно усложняет сопровождение), **Low** (локальная сложность без существенного текущего риска).
- Не выполнять рефакторинг только ради чистоты. Погашать долг, когда польза и снижение риска оправдывают изменение; стабильный проверенный код не переписывать без причины.
- Исправление долга должно иметь минимальный scope, сохранять существующие safety-boundaries и проходить обычные regression/safety-проверки проекта. Если исправление создаёт больший риск или новый долг, остановиться и предложить более безопасный вариант.
- При обнаружении долга вне текущей задачи не расширять scope молча: зафиксировать находку и рекомендацию, а реализацию выполнять только когда она входит в задачу или явно одобрена оператором.

- Если долг обнаружен вне текущей задачи, не изменять код или документацию только ради фиксации находки. В итоговом отчёте указать место, краткое описание, evidence, уровень **High / Medium / Low**, риск и рекомендуемое действие. Если находка заслуживает отдельного отслеживания — предложить создать GitHub Issue. Создавать Issue, добавлять `TODO` или менять файлы для фиксации долга только по явному разрешению оператора. `TODO (TechDebt ...)` допустим, когда такой комментарий входит в согласованный scope и действительно нужен непосредственно рядом с кодом.
