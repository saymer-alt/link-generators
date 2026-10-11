# WG/AWG Watchdog — исследование восстановления (NIGHT-FUTURE-01)

Дата: 2026-10-08. Статус: **RESEARCHED** (дизайн read-only collector'а; auto-restart — не реализуется без FIELD-OBSERVED доказательств).
Базис: docs/research/WG-AWG-RUNTIME-RECOVERY.md (v1.9-исследование, симптомы FIELD-OBSERVED), issue #153 (v1.10 field incident), issue #9 (AWL failover).

Evidence-метки: SOURCE-PROVEN (исходники wireguard-go/amneziawg-go/mihomo v1.19.32), FIELD-OBSERVED (владелец), INFERRED, UNKNOWN.

---

## 1. Почему возможен stale handshake (SOURCE-PROVEN по wireguard-go)

WireGuard — connectionless по дизайну: нет keepalive-состояния соединения, сессия живёт, пока:
1. handshake прошёл (`REKEY_AFTER_TIME` / `REJECT_AFTER_TIME` = 180 с — протокольный предел), и
2. транспортный путь (UDP 5-тупл) остаётся тем же (NAT mapping не сменился), и
3. ключи не ротированы сервером принудительно.

Stale handshake — состояние, когда локальный счётчик считает сессию живой, но фактический путь нарушен (NAT rebinding, смена exit-IP сервера, UDP-блокировка). SOURCE-PROVEN: wireguard-go отправляет handshake-инициации по таймеру, но не «пингует» в транспортом смысле — молчание сети выглядит как «пакеты отправлены».

AWG добавляет: obfuscation-параметры (JC/Jmin/Jmax/S1/S2, H1–H4) — при их несовпадении с сервером handshake вообще не проходит (это «не stale», а «never established» — важно различать).

## 2. Диагностическое разделение (read-only признаки)

| Симптом | Вероятная зона | Признак (read-only) |
|---|---|---|
| handshake не проходит вообще | endpoint/ключи/obfuscation | `latest handshake` отсутствует с момента старта интерфейса |
| handshake проходил, перестал | NAT/path/UDP-блокировка | `latest handshake` старше `REJECT_AFTER_TIME` (180 с), `transfer rx` замер |
| handshake свежий, трафик не идёт | маршрут/разрешение/DNS внутри туннеля | handshake свежий, но `transfer rx` = 0 при tx > 0 |
| интерфейс «завис» (нет swap) | L3-проблема внутри туннеля | ping через туннель молчит при свежем handshake |

Источник полей: `wg show <iface>` (latest handshakes, transfer, endpoints) — wireguard-tools; в AWG — amneziawg-tools с тем же выводом. На Keenetic/Entware — `awg show`. SOURCE-PROVEN по CLI-выводу обоих тулкитов.

Дополнительно из Mihomo Runtime Evidence (#188): `GET /proxies` — поле `alive` и `history` узла (delay-пробы) — косвенный признак уровня Mihomo, не уровня WG-интерфейса.

## 3. Restart: когда помогает и когда ухудшает

Помогает (INFERRED → требует FIELD-OBSERVED подтверждения per-инцидент):
- NAT mapping сменился, а WG не инициирует новый handshake по устаревшему endpoint (persistently stale >180 с при отсутствующем ручном трафике);
- интерфейс в состоянии «handshake давно, tx растёт, rx=0» после смены пути.

Ухудшает:
- restart-loop при длительной недоступности endpoint (каждый restart — новые handshake-инициации, шум в логах сервера, возможный бан по rate-limit);
- restart при «handshake свежий, но внутри туннеля DNS/маршрут» — не чинит причину;
- restart на живом подключении пользователя (кратковременный обрыв всего WG-трафика).

Правило v1.11 (без изменений): никаких автоматических restart'ов. Решение — только владелец по данным collector'а.

## 4. Read-only incident collector — проект

Цель: при следующем реальном инциденте собрать полный снимок ОДНОЙ командой, не меняя состояние.

### 4.1 Состав снимка (все команды read-only)

```text
# интерфейсный уровень (Entware/Keenetic: awg или wg)
awg show / wg show                          # handshake, transfer, endpoints
awg show <iface> dump                       # peers, allowedips, latest-handshake
ip addr show <iface>                        # адрес/состояние
ip route show table all | grep <iface>      # маршруты
# Mihomo уровень
curl -s http://127.0.0.1:9090/proxies       # alive/history групп (если контроллер доступен)
curl -s http://127.0.0.1:9090/version
# системный уровень
logread | tail -200                         # системный журнал (Keenetic)
ndmlog (если доступно)                      # ndm-события
date; uptime                                # привязка ко времени
```

### 4.2 Чего в снимке быть НЕ должно (privacy)

- приватные ключи, preshared keys (grep-фильтр `PrivateKey|PresharedKey` — маскировать);
- полный `allowedips` если содержит домашнюю сеть (маскировать до `10.x.0.0/16`);
- имена/адреса серверов — маскировать при публикации; в локальном снимке можно оставить.

### 4.3 Формат

Один файл `incident-YYYYMMDD-HHMMSS.txt` с заголовком-разделителем на секцию; приложение к issue владельцем вручную после ручной проверки на секреты. Коллектор — отдельный shell-скрипт (read-only, без set-команд) — **кандидат отдельной задачи, не часть v1.11**.

**Обновлено (NIGHT-MEGA-01 B3)**: PoC-реализация коллектора существует — `research/poc/wg-awg-collector/collect-awg-incident.sh` (read-only, маскирование private key/PSK до записи — поле 1 интерфейсной строки dump и поле 2 пир-строк, SKIPPED при отсутствии инструмента; offline-тесты `collector.test.sh`, 14 проверок, стабы на PATH). Это PoC в research/, не production keenetic-auto-setup; живой запуск — только по operator-задаче при реальном инциденте.

### 4.4 Критерии безопасного auto-restart (НЕ для реализации сейчас)

Auto-restart допустим только если ВСЕ условия подтверждены FIELD-OBSERVED на реальном инциденте:
1. «stale» определён структурно (handshake >180 с + rx=0 при tx>0), не по таймеру;
2. cooldown после restart ≥ N минут (нет restart-loop);
3. счётчик рестартов с ограничением (после M рестартов — stop и уведомление);
4. ручной режим всегда доступен и не перехватывается watchdog'ом;
5. инцидент-снимок собирается автоматически ПЕРЕД каждым restart (для разбора).

До появления такого инцидента — только read-only collector.

## 5. Что осталось UNKNOWN

- Доля инцидентов «NAT rebinding vs server-side» на реальной паре узлов — нет данных.
- Поведение AWG obfuscation при смене пути (H1–H4稳定性) — UNKNOWN.
- Влияние Mihomo dialer-proxy поверх WG на handshake-таймеры — UNKNOWN (отдельное исследование).
