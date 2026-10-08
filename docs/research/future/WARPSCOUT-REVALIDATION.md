# WARPSCOUT Revalidation — контракт будущей перепроверки (NIGHT-FUTURE-01)

Дата: 2026-10-08. Статус: **RESEARCHED** (дизайн; никаких сканирований реальных сетей).
Базис: docs/WARPSCOUT-KEENETIC.md, WARPSCOUT-VPS.md, WARPSCOUT-WINDOWS.md (полевой контракт «node/colo — наблюдаемое состояние, а не вечное свойство»), FIELD-OBSERVED #77 (Saymer/Saymer2 только ARN, FRA отсутствует).

---

## 1. Принцип

Разовое сканирование WARPSCOUT — **наблюдение с моментом времени T**, а не правило. Перепроверка — отдельный явный процесс со своими TTL и уровнями доказательности. Инструмент никогда не «запоминает endpoint навсегда».

## 2. Разделение уровней проверки (P2-гейт каждый)

| Уровень | Что доказывает | Инструмент |
|---|---|---|
| L1 Endpoint reachable | TCP/UDP до endpoint'а | connect/проба |
| L2 Tunnel established | WG handshake / MASQUE-сессия установлена | wg show / masque-клиент |
| L3 Exit observed | egress-IP/colo зафиксирован | внешний echo + Cloudflare trace |
| L4 Service accessible | целевой сервис доступен через туннель | HTTP-проба к сервису |
| L5 SNI valid | SNI-камуфляж принят сервером | TLS/QUIC handshake с нужным SNI |

Каждый уровень — отдельное наблюдение со своим штампом; нельзя выводить L4 из L2.

## 3. JSON Schema наблюдения (v1 — проект)

```json
{
  "$schema": "warpscout-observation-v1",
  "observationId": "obs-<utc-timestamp>-<short-hash>",
  "profileRef": "идентификатор профиля (ссылка, не секрет)",
  "transport": "wg | masque-h2 | masque-h3",
  "endpoint": { "host": "…", "port": 443 },
  "checkedAt": "2026-10-08T20:00:00Z",
  "levels": {
    "reachable":    { "status": "PASS|FAIL|UNKNOWN", "latencyMs": 12 },
    "tunnel":       { "status": "PASS|FAIL|UNKNOWN", "handshakeAgeSec": 42 },
    "exit":         { "status": "PASS|UNKNOWN", "country": "SE", "colo": "ARN", "egressIp": "синтетический/маскированный" },
    "service":      { "status": "PASS|FAIL|UNKNOWN", "target": "ref-цели", "httpStatus": 204 },
    "sni":          { "status": "PASS|FAIL|UNKNOWN" }
  },
  "source": "warpscout-scan | manual | revalidation",
  "notes": "синтетика; никаких реальных секретов"
}
```

Правила:
- `egressIp` — маскируется при публикации (не вставляется в репозиторий в реальной форме);
- наблюдения неизменяемы (append-only log), «текущее состояние» — производная от log'а;
- секреты (ключи WG, токены) — вне schema, ссылки-only.

## 4. TTL / freshness model

Никакого фиксированного «TTL 30 минут». Свежесть — **по событиям**, не по времени:

| Событие | Эффект |
|---|---|
| смена endpoint'а / ключа профиля | все наблюдения профиля → STALE |
| смена transport (WG↔MASQUE) | наблюдения этого транспорта → STALE |
| новый успешный полный проход L1–L5 | наблюдения профиля обновляются, STALE снимается |
| истечение объявленного владельцем review-interval | пометка «пора перепроверить» (не автодеградация) |

Базовая рекомендация по умолчанию: review-interval 7 дней (только напоминание, не деградация статуса).

## 5. Дедупликация и хранение

- Ключ наблюдения: `(profileRef, transport, endpoint, checkedAt-бакет до минуты)`.
- Дубликат: последнее наблюдение с тем же ключом и тем же результатом уровней — заменяется (лог сжимается до последнего уникального на батч).
- Хранение: локальный JSON/NDJSON (append-only), без внешних сервисов; в репозиторий — только синтетические образцы.

## 6. UNKNOWN / STALE правила

- любой уровень UNKNOWN → общее состояние UNKNOWN (не FAIL);
- STALE — только структурно (см. §4), не по возрасту;
- FAIL уровня L2 → «туннель не установлен», L3 → «exit не наблюдаем», никогда не агрегируются в «endpoint мёртв» без L1-FAIL.

## 7. Различия WG vs MASQUE-H2 vs MASQUE-H3

- WG: handshake-таймеры (REJECT_AFTER_TIME 180 c — протокольный предел, SOURCE-PROVEN wireguard-протокол), NAT-чувствительность.
- MASQUE-H3: QUIC-сессия + H3-коннект; reconnect дешевле; colo-привязка сильнее (Cloudflare-маршрутизация).
- MASQUE-H2: TCP-поток; UDP-поведение отличается от H3 — проверять отдельно.
Наблюдения хранят transport, чтобы не сравнивать WG-наблюдения с MASQUE-наблюдениями как однородные.

## 8. План автоматических тестов (synthetic)

1. Валидная observation JSON — парсится, статус собирается.
2. L2 FAIL + остальные PASS → aggregate = FAIL (туннель).
3. L3 UNKNOWN → aggregate = UNKNOWN.
4. STALE по смене endpoint'а в профиле.
5. Дедупликация: два одинаковых наблюдения в одну минуту → одна запись.
6. Маскирование egressIp/secret при сериализации для публикации.
7. WG/MASQUE-H2/H3 не смешиваются в агрегате профиля.

## 9. Не делать

- Никаких сканирований реальных сетей владельца этим инструментом из CI.
- Не превращать перепроверку в постоянный фоновый poll (владелец запускает явно).
- Не публиковать реальные egress-IP/colo-привязки к профилям владельца.
