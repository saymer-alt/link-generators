# Changelog

Все заметные изменения проекта. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).

## [Unreleased]

### Added

- Добавлены две прикладные инструкции WARPSCOUT: Windows-сценарий для поиска WARP / MASQUE H3 / H2 и VPS-сценарий для Ubuntu 24.04 / Debian 12 с установкой, сканированием из сети конкретного сервера и сравнительной диагностикой текущих H3/H2-выходов через Mihomo, Cloudflare trace/meta и внешний IP.

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
