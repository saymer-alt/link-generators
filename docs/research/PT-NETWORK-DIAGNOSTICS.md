# PT Network Diagnostics: TCP/UDP · DNS path · MTU (#177, v1.11 EVENING-02)

Дата: 2026-10-08. Базис: main после #192/#193/#194 (Config Studio + Runtime Evidence + hardening).
Блок: PT-DIAG (pure, index.html), UI — сворачиваемая панель «🌐 Сеть: TCP / UDP · DNS · MTU» в Physical Topology.

Evidence-метки: SOURCE-PROVEN / RUNTIME-PROVEN / FIELD-OBSERVED / INFERRED / HYPOTHESIS / UNKNOWN.

---

## 1. Upstream research (SOURCE-PROVEN, тег v1.19.32)

| Вопрос | Факт | Источник |
|---|---|---|
| HTTP inbound UDP | HTTPOption не содержит UDP-полей — TCP-only | `listener/inbound/http.go` |
| SOCKS inbound UDP | `SocksOption.UDP bool` (inbound:"udp,omitempty") | `listener/inbound/socks.go` |
| SOCKS outbound UDP | `udp` опция + `CmdUDPAssociate` handshake | `adapter/outbound/socks5.go` |
| SS outbound UDP | `udp`, `udp-over-tcp`, `udp-over-tcp-version` опции | `adapter/outbound/shadowsocks.go` |
| SS inbound UDP | `ShadowSocksOption{UDP: true}` — по умолчанию включён | `listener/parse.go` |
| Next-hop DNS | адрес proxy-server резолвится дialером исходящего узла через `resolver.ProxyServerHostResolver` (отдельный резолвер от destination-DNS) | `common/dialer/dialer.go` parseAddr |
| HTTP CONNECT | переносит только TCP-поток | протокольное определение (RFC 7231 §4.3.6) — TCP-only по конструкции |

**Важно**: поддержка UDP транспортом ≠ сквозной UDP через цепочку. Сквозной вердикт — конъюнкция по звеньям; любой UNKNOWN/UNSUPPORTED/external contract убирает SUPPORTED.

## 2. TCP/UDP capability diagnostics (PHASE B)

Per-link вердикты: SUPPORTED / UNSUPPORTED / UNKNOWN / CHAIN_UNAVAILABLE (what-if).
First-class (ss/socks/http) — SOURCE-PROVEN пары outbound+listener. Прочее (external contract, напр. wireguard-ребро к WARP) — UNKNOWN: возможности не доказаны генератором.

End-to-end агрегат (детерминированный): CHAIN_UNAVAILABLE > UNSUPPORTED > UNKNOWN > SUPPORTED.
Формулировка-потолок: «SUPPORTED означает: статически доказано на каждом звене; это НЕ измерение сквозного UDP/TCP-трафика».

Кейсы:
- ss→ss: TCP SUPPORTED, UDP SUPPORTED (link-level; сквозной — по конъюнкции)
- http-звено: TCP SUPPORTED, UDP UNSUPPORTED → end-to-end UDP UNSUPPORTED
- external (wireguard к WARP): UNKNOWN → end-to-end UNKNOWN

## 3. DNS path intelligence (PHASE C)

**Next-hop resolution** — где резолвится адрес следующего узла:

- endpoint — IP-литерал → `PROVEN_NO_DNS` («DNS-резолвинг не требуется») — STATIC-PROVEN по конфигурации;
- endpoint — hostname → `SOURCE-PROVEN_AT_SOURCE`: Mihomo резолвит адрес proxy-server через proxy-server DNS на исходящем узле (`ProxyServerHostResolver` — отдельный резолвер, SOURCE-PROVEN). Для client→ENTRY — локальный DNS устройства клиента;
- endpoint отсутствует/битый → UNKNOWN.

**Destination resolution** — где резолвятся домены назначения: только по явной декларации владельца `node.dns.destination` (`exit` / `local` / `unknown`):

- `exit` хотя бы на одном узле → `INTENDED_AT_EXIT` (INTENDED, не измерение);
- только `local` → `INTENDED_DIVERTED` (DNS path расходится с data path по декларации);
- деклараций нет → `UNKNOWN — per-node DNS configuration not provided`.

Никогда не утверждается «observed DNS location» — наблюдения являются зоной Runtime Evidence (#188), DNS-наблюдения в v1.11 не реализованы.

**DNS vs data path**: совпадение возможно только при destination=exit; это декларация, не измерение.

Malformed metadata (`node.dns` не объект / destination вне enum) → PT-DNS-BAD (error), анализ продолжается с трактовкой UNKNOWN.

## 4. MTU/fragmentation (PHASE D)

Per-link: опциональный `link.transport.mtu` (576..65535, иначе PT-MTU-BAD):

- DECLARED — значение показывается как заявленное, не измеренное;
- overhead: ss/socks/http → PARTIAL («потоковый TCP-транспорт: фиксированного IP-уровня overhead нет; AEAD уменьшает полезную нагрузку — модель зависит от шифра»); wireguard/external → UNKNOWN; wireguard — PARTIAL со ссылкой на WG-MTU-MIHOMO.md (60/80 байт внешний);
- fragmentation risk: ≤1280 → LOW (по декларации); >1280/неизвестно → UNKNOWN.

Запрещено (политика v1.11): суммирование overhead по цепочке без доказанной модели инкапсуляции, отождествление TCP proxy-chaining с вложенными IP-туннелями, вывод фактического path MTU из одного конфига, auto-MTU. Сквозной вердикт — только PARTIAL (есть заявленные) или UNKNOWN (нет), никогда «точный recommended MTU».

## 5. UI (PHASE E)

Сворачиваемый блок «🌐 Сеть: TCP / UDP · DNS · MTU» в PT-панели (после Semantic Trace, до генерации). Заполняется при «Проанализировать»; учитывает what-if (CHAIN_UNAVAILABLE). Компактный формат: сквозной итог + per-link строки + дисклеймер. Mobile 320–480 — без overflow (тесты).

## 6. Consistency (PHASE F)

Диагностики не меняют модель/генерацию/YAML. Согласованность со статусами генерации: EXTERNAL_CONTRACT_REQUIRED на звене ⇒ end-to-end не заявляет SUPPORTED (тест 4). Runtime Evidence остаётся единственным источником «наблюдений»; DNS/MTU-диагностики — STATIC/DECLARED уровень.

## 7. Тестовая матрица (PHASE G) — tests/pt-network-diagnostics.cjs, 18 групп

1. 2-hop ss/ss all-known → SUPPORTED/SUPPORTED; 2. 3-hop mixed (socks/ss/http) → TCP SUPPORTED / UDP UNSUPPORTED; 3. missing transport → UNKNOWN; 4. unsupported transport → UNKNOWN + EXTERNAL_CONTRACT_REQUIRED в генерации; 5. wireguard overlay → UNKNOWN; 6. explicit DNS expectation → INTENDED_AT_EXIT; 7. missing DNS config → UNKNOWN; 8. next-hop hostname → resolve-at-source, IP → PROVEN_NO_DNS; 9. WARP overlay без proof → UNKNOWN; 10. explicit MTU → PARTIAL; 11. без арифметики overhead; 12. what-if → CHAIN_UNAVAILABLE; 13. generation consistency; 14. no secrets; 15. malformed metadata → PT-DNS-BAD/PT-MTU-BAD; 16. legacy-топология валидна; 17. вне build-пути; 18. детерминизм.

Browser-проверки — в tests/config-studio-browser.cjs (панель, demo UNKNOWN, metadata PARTIAL/INTENDED_AT_EXIT, malformed, mobile 360).

## 8. Что невозможно без реальных VPS (backlog для field-test)

- Фактический path MTU и фрагментация на реальном пути (нужны измерения с DF-пробами).
- Сквозной UDP через 2+ VPS (нужен UDP-echo/пробатор per hop).
- Фактический DNS path (нужен capture/DNS-лог на узлах).
- Поведение real-server Mieru/VLESS серверных частей (внешние контракты).
