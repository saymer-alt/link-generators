# Дополнительные направления (NIGHT-FUTURE-01, обзор при остатке бюджета)

Дата: 2026-10-08. Статус: краткий архитектурный обзор; ничего не реализовано. Всё — v1.12+ / undecided, кроме отмеченного.

---

## 1. Automatic physical topology failover

- Что это: отказ узла цепочки → автоматическая перестройка на альтернативную физическую цепочку (Moscow→EE→SE при отказе EE становится Moscow→DE→SE).
- Блокеры: требует модели альтернативных цепочек (сейчас topology — linear, альтернативы не моделируются), runtime-наблюдений (#188 — теперь есть фундамент), доказанной семантики переключения сессий (см. P0/P1.13: middle-hop fail → CHAIN_UNAVAILABLE; локальный failover внутри ребра — разрешён и отличается от физического).
- Safety: никогда не «тихо» переключать маршрут пользователя; любое переключение — событие с уведомлением и откатом.
- Acceptance (будущее): FIELD-OBSERVED отказ реального узла → переключение → откат; ни одного пакета в DIRECT при отсутствии явного разрешения.
- Статус: RESEARCHED-BRIEF; v1.12+ / undecided.

## 2. Расширенные transport contracts (Mihomo inbound/outbound)

- Первый набор v1.11: ss/socks/http. Upstream v1.19.32 имеет также vmess/vless/trojan/hysteria2/tuic/anytls/mieru/snell-инбаунды (SOURCE-PROVEN, listener/parse.go — см. PT-NETWORK-DIAGNOSTICS.md §1).
- Расширение реестра = на каждый транспорт: протокольные TCP/UDP-факты, поля конфига, тесты mihomo -t на оба артефакта, FAIL-closed контракты. Затратно, но механически понятно.
- Ограничение: classical MRS — нет; транспорт-специфичные quirks (например, reality в http-inbound) требуют per-транспорт чтения исходников.
- Статус: RESEARCHED-BRIEF; приоритет — по потребностям владельца.

## 3. Ограничения автоматического deployment

- Позиция проекта: деплой только вручную владельцем; generator не SSH-ится.
- Если когда-либо пересматривать: явный экспорт-манифест + владелец выполняет команды сам; никаких вшитых ключей/agent'ов; dry-run print-only по умолчанию; safety-гейты по образцу vps-gateway-bootstrap (approval/ownership/recovery — другой проект владельца).
- Статус: позиция зафиксирована; пересмотр — только по явному owner GO.

## 4. Расширение графа физических топологий (beyond linear)

- Модель уже graph-friendly (nodes/links/roles), но валидатор v1.11 — строго linear (ветвления/merge отклоняются).
- Будущее: DAG/branching topologies (например, backup-entry), multi-entry, active-active transit. Требует: новой role-семантики, агрегации what-if по альтернативам, доказательной failover-модели.
- Статус: RESEARCHED-BRIEF; v1.12+ / undecided.
