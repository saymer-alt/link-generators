# Changelog

Все заметные изменения проекта. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).

## [Unreleased]

### Added
- Mihomo Builder: три понятных профиля развёртывания вместо абстрактного селектора — «Роутер / обычный TUN (Keenetic)» (по умолчанию), «VPS — локальный Mihomo / SOCKS для Xray / 3X-UI» и «VPS Transparent Gateway (amnezia-mihomo-gateway)». Профиль управляет только сценарными переключателями (TUN/MIPS/Mixed/Allow LAN/gateway-панель) с fail-safe клампами в Build; пользовательские данные (прокси, подписки, WireGuard, фильтры, dialer-proxy) не затрагиваются.
- Секция «ADVANCED — Отдельный вход на каждый прокси» свёрнута в спойлер по умолчанию; раскрытие ничего не включает.
- docs/GENERATOR-GUIDE.md — короткая человеческая инструкция; ссылка на неё — вверху Builder.

- Добавлена штатная поддержка `dialer-proxy` Mihomo для WireGuard/WARP («туннель в туннеле»): можно указать существующий proxy/группу, собрать собственную `select`-группу из транзитных узлов или использовать provider-backed dialer-группу через `use:` на уже подключённые URL-подписки. Поддерживаются ациклические WireGuard-over-WireGuard цепочки; UDP-совместимость динамических provider-узлов заранее не предполагается и проверяется полевым тестом.
- Добавлен централизованный dependency-graph анализатор `web4core.analyzeDialerGraph(doc)`: учитываются `dialer-proxy`, статические `proxies:`, provider `use:` и `override.dialer-proxy`; смешанные группы учитывают обе ветви. Циклы, возвращающие маршрут к исходному outbound, отклоняются с полным путём; provider без статического override помечается как dynamic/unknown, а не как доказанно безопасный или ошибочный.
- Добавлен воспроизводимый полевой harness `tools/warp-dialer-fieldtest/` для WARP direct / WARP-over-dialer / WARP-over-WARP, sweep/switchtest, MTU-лестницы, transfer/trace измерений и UDP-capability классификации. Harness умеет redaction секретов, JSON/CSV отчёты, fail-closed PIN проверки и строгий `--fresh-handshake` режим для per-node транспортных измерений.
- Документированы полевые особенности Geodema/Remnawave: subscription endpoint требует корректный HWID-контекст и без него может намеренно отдавать `App not supported`; пример provider header добавлен в field-test документацию. Добавлена отдельная практическая заметка по `exclude-filter` и фактическим именам узлов подписок.

### Changed
- UI Mihomo Builder дополнен подсказками (tooltip/inline) к основным переключателям и кнопкам; около dialer-proxy явно задокументированы требования UDP relay и персистентность WireGuard-хендшейка при переключении узлов (>150 с в полевых замерах).

- UI-подсказка `Exclude Filter` больше не предлагает только латинский `(?i)ru|russia`: пример расширен кириллическим вариантом, а текст явно объясняет, что Mihomo сопоставляет regexp с фактическими именами provider-узлов. Это важно для подписок, где страны/города названы кириллицей.
- Field-test отчётность разделяет три независимых факта: `selection_changed` (API подтвердил выбранный узел), `transport_fresh` (outbound пересоздан) и `path_freshness` (`fresh` / `unverified`). Обычный короткий `settle-ms` больше не трактуется как доказательство смены транспортного пути WireGuard.

### Fixed

- Исправлен выбор provider-узлов с ведущими/хвостовыми пробелами в имени: resolver сначала ищет exact match, затем единственный `trim()`-эквивалент, а в Mihomo API всегда передаёт оригинальное имя byte-for-byte; неоднозначность и отсутствие совпадения завершаются ошибкой.
- Исправлена методология sweep/switchtest для персистентных WireGuard-хендшейков: полевые измерения показали, что после переключения dialer-группы старый транспорт может сохраняться более 150 секунд. `--fresh-handshake` выполняет reload изолированного тестового конфига через `PUT /configs?force=true`, ждёт API, повторно подтверждает выбранный узел и только затем снимает trace; без этого режима результат честно помечается как `unverified`.

### Verified

- Offline suite полевого harness расширен с **23 до 31 теста**: добавлены регрессии exact/leading/trailing provider names, unique normalized resolution, ambiguous/unknown/empty fail-closed кейсы и fresh-handshake контракт. CI проверяет синтаксис, offline-тесты, secret scan и runtime provenance.
- На изолированном SE VPS с Mihomo **v1.19.31** подтверждены direct WARP → **ARN**, WireGuard-over-WireGuard → WARP_OK и provider-backed nested WARP через Geodema: транспорт DE → **FRA**, NL → **AMS**, SE → **ARN**. Строгий fresh-handshake A→B→A дал **FRA → AMS → FRA**; это зафиксировано как field evidence, а не как гарантия будущего Cloudflare routing.
- На FRA-маршруте nested WARP прошёл MTU **1280 / 1260 / 1240 / 1220 / 1200**, все ступени WARP_OK; transfer в полевых прогонах оставался рабочим. Production Mihomo, маршруты, firewall/systemd и прочие сервисы VPS тестами не изменялись.
- Geodema/Remnawave HWID-поведение подтверждено HTTP-матрицей: без HWID `/mihomo` возвращал placeholder с `x-hwid-not-supported: true`, а с корректным HWID — реальную подписку; provider-backed dialer-группы получили рабочие UDP-capable DE/NL/SE узлы.
- `exclude-filter` проверен на реальном Geodema provider: baseline **99** узлов; фактический RU-pattern удалил **6/6** RU без false positives/false negatives, Germany control — **3/3**, exact-name — **1/1**, RU+DE — **9/9**, снятие фильтра восстановило baseline. Старый пример `(?i)ru|russia` не удалял кириллические RU-имена; reload применял новый provider-level фильтр сразу, без обязательного чистого cache/home.

- Добавлен режим **🚦 Политики по доменам (Domain Policy Routing, Variant B)**: доменные категории (имя + список доменов, шаблоны AI/YouTube/Telegram/Google/Direct) генерируют inline `rule-providers` (`policy-<slug>`, classical), категории-группы и `RULE-SET`-правила перед неизменным `MATCH,GLOBAL`. Правила ссылаются на стабильные группы, группы — на provider подписки через `use:`: изменение состава подписки не требует пересборки правил (живой PoC на Mihomo v1.19.31/v1.19.32). В режиме URL-подписок каждая категория получает `NAME-AUTO` url-test над общим provider (несколько групп на один провайдер) и select `[AUTO, ⚡ Fastest, GLOBAL, DIRECT]`; без подписок — select без AUTO; в режиме белых списков — select `[GLOBAL, DIRECT]` без вложенности (#2588); с «на каждый прокси» несовместим (кламп UI + отклонение движком). Контракт `proxy: DIRECT` у провайдеров подписки закреплён regression-тестами (холодный старт без него дедлочит фетч). Нераспознанные строки пользователя пропускаются с неблокирующим предупреждением; валидатор проверяет rule-providers/RULE-SET/цели и завершающий `MATCH,GLOBAL`. Выключенный режим — byte-parity прежнего вывода. Подробности — docs/POLICY-ROUTING.md.

## [1.5.0] - 2026-09-28

### Added

- Добавлены три прикладные инструкции WARPSCOUT: Windows, Keenetic / Entware и VPS (Ubuntu 24.04 / Debian 12), включая проверенные сценарии установки, SNI/full-scan для MASQUE, AWG-сценарии на фильтрованных сетях, VPS acceptance для Cloudflare colo/path и полевые A/B-наблюдения по дачным KN-1012/NC-1012.
- Добавлено опциональное поле **Device Model** для URL-подписок Mihomo: значение передаётся как provider header `x-device-model`; пустое поле сохраняет прежнее поведение.
- CI теперь проверяет provenance vendored `web4core.runtime.js`: freshly-built runtime из `saymer-alt/web4core:link-generators` должен совпадать с tracked runtime после нормализации переводов строк.
- Браузерные регрессии расширены проверками semantic YAML round-trip, WARP import flow, WG/AWG async state, VPS stack contract, reserved names/dedup и другими audit-сценариями.

### Changed

- При открытии страницы по умолчанию активен **Mihomo Builder**; WARP MASQUE остаётся доступен второй вкладкой.
- WARP identity import стал атомарным: поля, отсутствующие в новом импорте, очищаются, а переход **«В Mihomo Builder»** на свежей странице автоматически выключает URL-подписки и использует статический ввод.
- VPS Gateway приведён к фактическому контракту **Mihomo 1.19.31**: top-level `tun.inet4-address` больше не генерируется; effective IPv4 TUN берётся из `dns.fake-ip-range`. Для VPS `gvisor` остаётся рекомендуемым baseline, `mips` поддерживается и проверен, а `system` / `mixed` явно сохраняются только как экспериментальный выбор без молчаливой подмены.
- Runtime обновлён из интеграционной ветки `saymer-alt/web4core:link-generators`; генератор теперь сохраняет строковую семантику YAML-значений, корректно обрабатывает UTF-8 VMess-имена и использует более точную идентичность outbound для dedup.

### Fixed

- WARP output больше не строится через небезопасный `innerHTML`: пользовательские SNI/имена отображаются как текст и не превращаются в DOM.
- Исправлена YAML-семантика строк, похожих на scalar-типы (`true`, `false`, `null`, `00123`, `1e3`, значения с `#`): после round-trip они остаются строками.
- Dedup больше не схлопывает разные VLESS outbound только из-за совпадения host/port/UUID: учитываются transport, WS/gRPC/HTTP параметры, TLS/SNI, REALITY, fingerprint, ALPN и другие значимые поля.
- Исправлены конфликты пользовательских proxy-имён с `GLOBAL`, `DIRECT`, `REJECT`, `⚡ Fastest`, `🌐 static-health` и дубликатами: имена получают детерминированные безопасные суффиксы.
- Исправлен UTF-8 decode VMess JSON, включая имена вроде `Москва 🚀`.
- AWG 3.1 import корректно обрабатывает inline-комментарии после `PersistentKeepalive`, `RandomTrailers` и `DisableCookies`.
- Загрузка WG/AWG файлов стала race-safe: Build блокируется на время чтения, stale async result не может перезаписать более новую загрузку, Copy сбрасывается до актуальной валидации.
- Выключенный Web UI больше не блокирует Build из-за скрытого некорректного Custom URL; при повторном включении URL снова валидируется.
- Актуализированы MASQUE/DPI и AWL regression-тесты: тесты проверяют текущий UI/health-check contract, реальный proxy traffic и дожидаются собственного окна control health-check.

### Verified

- Финальная интеграция проверена на официальном **Mihomo v1.19.31**; SHA-256 release asset: `d5e74bbddbdfff49a1aef7775bf5911da59f0d7196ed509a0ac914b3653dd5f1`.
- Перед production promotion: web4core source **106/106**, consumer runtime **53/53**, validator **47/47**, MASQUE/DPI **7/7 групп**, browser suite и whitelist — PASS.
- Реальный Mihomo failover: static / providers / mixed — **3/3 P→F→P**; AWL priority-over-speed и возврат к более медленному primary — PASS.
- Финальный независимый smoke-прогон прошёл браузерную матрицу A–M и `mihomo -t` на 10 probe YAML — **10/10 PASS**; воспроизведённых дефектов продукта не найдено.
- Long production-interval AWL soak остаётся отдельным manual observation и намеренно не является CI/release gate.

## [1.4.2] - 2026-09-21

### Changed

- Production-дефолт Mihomo изменён с `log-level: info` на `log-level: warning`: обычные успешные per-connection записи больше не попадают в лог, а warnings/errors сохраняются; это снижает риск многогигабайтных лог-файлов на VPS при перенаправлении stdout/stderr без ротации.
- Введён отдельный production channel `stable`: `main` становится integration/development, runtime CI валидирует обе ветки, но автоматический write-back runtime остаётся только в `main`. GitHub Pages публикуется из `stable`; promotion выполняется явно после зелёного CI и необходимых функциональных/полевых проверок.

## [1.4.1] - 2026-09-20

### Added

- После Build добавлена неблокирующая сводка **«Требования используемых функций»**, которая анализирует финальный YAML и показывает только реально применимые требования: MIPS → Mihomo >= 1.19.31, AWG 3.1 → >= 1.19.30, provider `override-expr` → >= 1.19.29, а также отдельные notices для Selective Modern REALITY и экспериментальных Mieru/TrustTunnel. Сводка не меняет YAML и не блокирует Copy.

### Changed

- Mihomo Builder понятнее различает обычные proxy-ссылки и HTTP(S) URL-подписки: пользовательский `Sub Mode` переименован в «Использовать URL-подписки», добавлена динамическая подсказка, readonly YAML preview получил явное объяснение, а после browser-VALID показывается команда финальной проверки `mihomo -t` и требования к диагностическим данным.
- Формализован контракт поддержки сгенерированного YAML: ручное редактирование разрешено, но после изменения файл считается пользовательской конфигурацией; гарантии browser-validator относятся только к неизменённому output после **Build Config**, а изменённый файл нужно самостоятельно проверять через `mihomo -t`.
- Compatibility notices вынесены из структурного валидатора в отдельную post-Build сводку, чтобы не смешивать требования версий с ошибками/предупреждениями структуры YAML.
- Документация Auto-Whitelist дополнена фактическими лабораторными измерениями Mihomo 1.19.31: passive provider blackhole с production-like `interval: 300` переключился примерно за 304.9 с, а при повторяющихся активных dial failures — примерно за 15 с. Эти значения зафиксированы как наблюдение лаборатории, а не SLA; production-дефолты не изменены.

### Fixed

- Документация синхронизирована с фактическими дефолтами v1.4.0: MIPS включён по умолчанию, gVisor описан как compatibility/API fallback; REALITY E2E-матрица больше не трактуется как универсальная граница версий.
- Consumer regression теперь отдельно фиксирует `static-health.lazy: false`, а Selective REALITY fixture использует детерминированный валидный X25519 public key вместо искусственного `TESTPBK`.

## [1.4.0] - 2026-09-19

### Added

- **Автоматический режим белых списков** — два набора выходов (primary / fallback) с плоской `fallback`-группой, автоматическим переходом и возвратом по health-check. Поддерживаются static links, HTTP providers и mixed input; для режима добавлены отдельная документация и регресс-тесты.
- **Selective Modern REALITY (X25519+ML-KEM)** — новое многострочное поле в конструкторе Mihomo: перечисляются серверы (`host`, `host:port`, `[ipv6]:port`), и только REALITY-узлы именно этих серверов получают `support-x25519mlkem768: true` и `client-fingerprint: chrome` (если не задан). Обычные VLESS/TLS и остальные серверы не затрагиваются; пустое поле — прежний вывод без изменений. Некорректные строки пропускаются с неблокирующим предупреждением, Copy остаётся доступен.
- **Exclude Filter** для Sub Mode — regexp/keyword-фильтрация имён узлов в HTTP(S)-подписках.
- **Выбор Web UI dashboard** — MetaCubeXD, Yacd-meta, Zashboard или свой URL архива.
- Расширены regression/manual E2E проверки: AWL priority/failover/soak, MASQUE/DPI и реальный REALITY handshake на матрице Xray.

### Changed

- **MIPS TUN stack теперь включён по умолчанию для Mihomo >= 1.19.31**; gVisor остаётся compatibility fallback. `system` / `mixed` спрятаны за отдельной расширенной опцией.
- Per-Proxy TUN/SOCKS собраны под отдельный master switch и получают явные guards зависимых настроек; недопустимые комбинации сбрасываются до генерации.
- В Sub Mode провайдеры для selective REALITY получают scoped `override-expr` с `has("reality-opts")`; в Auto-Whitelist `additional-prefix` и `override-expr` сохраняются одновременно и не перезаписывают друг друга.
- Runtime теперь поддерживается через source-level fork `saymer-alt/web4core:link-generators`: workflow сначала собирает и тестирует runtime read-only, а write-job обновляет consumer только после успешных проверок. При реальном bot-коммите сохраняется точный source SHA; byte-identical rebuild остаётся no-op без коммита.
- Формулировка REALITY-поля не обещает совместимость по одной версии: X25519MLKEM768 появился в Xray v25.5.16, но применять опцию следует только к серверам с подтверждённой совместимостью.
- Обновлены подсказки и статусные сообщения интерфейса, включая полный hint по поддерживаемым протоколам и aria-live для статусов/toast.

### Fixed

- Per-Proxy: скрытая группа health-check «🌐 static-health» теперь испускается с `lazy: false`. Ранее Mihomo выполнял для static-прокси стартовую проверку, но плановые тики скрытой невыбранной группы могли пропускаться; теперь проверки идут по интервалу без ручных действий.
- Исправлено отображение и выравнивание расширенных Mihomo-контролов.
