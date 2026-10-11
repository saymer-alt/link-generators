# Auto-MTU Proof Gates (NIGHT-FUTURE-01)

Дата: 2026-10-08. Статус: **RESEARCHED** (доказательные границы; auto-MTU в генератор НЕ добавляется — политика v1.9→v1.11 сохраняется).
Базис-исследования: docs/research/WG-MTU-MIHOMO.md (verdict PARTIALLY PROVEN), docs/research/AWG-MTU-OVERHEAD.md (auto-MTU небезопасен при RandomTrailers), docs/research/PT-NETWORK-DIAGNOSTICS.md §4, docs/research/PT-GENERATION.md.

---

## 1. Сводка overhead-моделей по транспортам

| Транспорт | IP-уровня overhead | Доказанность | Источник |
|---|---|---|---|
| WireGuard (WG) | 60 байт IPv4 / 80 IPv6 внешний (WG-заголовок 32 + outer IP/UDP) | PARTIALLY PROVEN — константы протокола SOURCE-PROVEN, сквозной path MTU — не измерялся | docs/research/WG-MTU-MIHOMO.md; протокол WG (Reykdal/Pfaffenbichler анализ) |
| AWG v1 (без CPA) | WG-overhead + фиксированные AWG-поля (S1/S2 заголовки) | PARTIAL — зависит от режима | docs/research/AWG-MTU-OVERHEAD.md |
| AWG с RandomTrailers | случайный хвост J-байтов — верхняя граница неизвестна | NOT PROVEN → auto-MTU небезопасен | docs/research/AWG-MTU-OVERHEAD.md |
| AWG с CPA (Content Padding Addition) | CPA-зависимый overhead | NOT PROVEN | docs/research/AWG-MTU-OVERHEAD.md |
| Shadowsocks (AEAD) | поточный транспорт: на IP-MTU не влияет напрямую; эффективная полезная нагрузка сегмента уменьшается на [salt][len][tag] фрейминг | PARTIAL — точная модель зависит от cipher/plugin | INFERRED из AEAD-спецификации; не SOURCE-PROVEN для Mihomo-диал-пути |
| SOCKS5 | нет инкапсуляции IP-уровня; CONNECT-туннель — поток | N/A для IP-MTU (поток) | — |
| HTTP CONNECT | нет инкапсуляции IP-уровня | N/A | — |
| MASQUE (H2/H3) | QUIC-инкапсуляция: свой PMTU/PLPMTUD на QUIC-уровне | UNKNOWN (отдельная модель) | — |
| Физические hop'ы (VPS-цепочка) | каждый hop — свой сетевой путь | UNKNOWN без измерений | — |

## 2. Доказательные гейты для ЛЮБОГО будущего алгоритма auto-MTU

Алгоритм имеет право предлагать число ТОЛЬКО если пройдены все гейты:

**G1 — модель инкапсуляции доказана.** Для каждого звена известен точный перечень заголовков (протокольные константы или SOURCE-PROVEN чтение исходников). Запрещено: суммировать «примерные» overhead'ы, считать TCP proxy-chaining эквивалентом вложенных IP-туннелей.

**G2 — RandomTrailers отсутствуют (AWG).** Если у профиля AWG случайные хвосты — верхняя граница длины неизвестна → вердикт NOT PROVEN, предложение числа запрещено.

**G3 — CPA-режим учтён.** CPA присутствует → overhead-модель CPA-специфичная; без неё — NOT PROVEN.

**G4 — стек подтверждён.** gVisor (userspace) и системный стек дают разную effective-MTU модель (WG-MTU-MIHOMO.md: PARTIALLY PROVEN). Алгоритм обязан знать, какой стек используется на каждом узле; UNKNOWN стек → NOT PROVEN.

**G5 — path MTU измерен или гарантирован.** Сквозной path MTU не выводится из одного конфига; требуется PMTUD-измерение или явная декларация владельца с пометкой DECLARED.

**G6 — результат — диапазон + предупреждение, не «точное число».** Даже при пройденных гейтах вывод — «безопасный диапазон» + fragmentation risk, а не единственное значение без контекста.

## 3. Критерии безопасного включения (будущее, не сейчас)

1. Все гейты G1–G6 формализованы в тестах (synthetic-фикстуры per-транспорт).
2. FIELD-OBSERVED валидация на реальной цепочке: заявленный MTU ≤ измеренного path MTU на 100% проб.
3. Отдельная вкладка/блок «экспериментально: расчёт MTU» — никогда не меняет generated YAML молча.
4. Лог расчёта (какие формулы/допущения) доступен пользователю.
5. Fail-closed: любое UNKNOWN звено → «расчёт недоступен», не «среднее значение».

## 4. Существующие инструменты (уже в v1.11, без изменений)

- WG/AWG MTU chain planner в диагностиках профилей (docs/MIHOMO.md, NIGHT-05): «расчётный потолок outermost→inner», диагностический, YAML не меняет, auto-MTU выключен.
- PT Network Diagnostics (EVENING-02): заявленные MTU + overhead PARTIAL/UNKNOWN per-link, сквозной вердикт PARTIAL/UNKNOWN.

## 5. Backlog для field-test (данные, которых не хватает)

- Замеры path MTU между реальными VPS (DF-пинги ступенями 1500→1280).
- WG/AWG handshake+traffic снимки при разных MTU (для подтверждения 60/80-байт модели на конкретном пути).
- MASQUE/H3 PMTUD поведение через реальный Cloudflare WARP egress.
- Влияние IPv6-only звеньев на overhead (80-байт ветка).
