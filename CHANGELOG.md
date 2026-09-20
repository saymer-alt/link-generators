# Changelog

Все заметные изменения проекта. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).

## [Unreleased]

### Changed

- Mihomo Builder понятнее различает обычные proxy-ссылки и HTTP(S) URL-подписки: пользовательский `Sub Mode` переименован в «URL-подписки (Sub Mode)», добавлена динамическая подсказка, readonly YAML preview получил явное объяснение, а после browser-VALID показывается команда финальной проверки `mihomo -t` и требования к диагностическим данным.

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
