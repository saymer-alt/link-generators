# Changelog

Все заметные изменения проекта. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).

## [Unreleased]

### Added

- Поддержка штатного `dialer-proxy` Mihomo для WireGuard/WARP («туннель в туннеле»): необязательное поле «Промежуточный proxy / dialer-proxy» и авторская dialer-группа (select) с транзитными узлами. Таргет обязан поддерживать UDP; self-reference, неизвестные таргеты/участники и конфликты имён отклоняются при сборке; валидатор дублирует статические проверки ядра (v1.19.31) и предупреждает о циклах через группы и о MTU (рекомендация 1200–1280, дефолт ядра 1408). Пустые поля — прежний вывод (byte-parity). Проверено `mihomo -t` и живой цепочкой двух инстансов; AWG 3.1 не входит в первую реализацию. Третий режим dialer-группы — provider-backed через `use:`: перечисляются URL уже введённых URL-подписок, группа ссылается на их proxy-providers без разворачивания содержимого; UDP-совместимость узлов подписки заранее неизвестна и выбирается вручную. Явная поддержка WireGuard-over-WireGuard: валидные цепочки (WG-A→WG-B→WG-C, через группы и провайдеры) разрешены; полный dependency-graph детектор отклоняет маршруты, возвращающиеся к исходному outbound (включая циклы через членство в группах, которые ядро статически не ловит), — таргет GLOBAL/⚡ Fastest теперь ошибка. Детектор централизован: `web4core.analyzeDialerGraph(doc)` строит ориентированный граф зависимостей (dialer-рёбра, proxies:, use:, provider override) единым кодом для генератора и валидатора; смешанные группы (`proxies:` + `use:`) учитывают обе категории рёбер; провайдер без override помечается dynamic/unknown (предупреждение о недоказуемости статической безопасности), а не «доказанным тупиком».

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
