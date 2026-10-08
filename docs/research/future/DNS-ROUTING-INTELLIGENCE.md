# DNS↔Routing Intelligence (v1.12 candidate)

Дата: 2026-10-08 (NIGHT-MEGA-01, TRACK B1). Статус: **RESEARCHED + PoC WORKING** (анализатор на синтетике 13/13; реальный конфиг не прогонялся). Версии-источники: mihomo **v1.19.32**. Всё ниже — кандидат v1.12, **не утверждённый scope**; начало работ — только по явному owner GO после релиза v1.11.

## 1. Вопрос

Генератор производит `dns:` и `rules:` согласованно для своих профилей, но Config Studio принимает **чужие** конфиги, где эти секции рассинхронизированы. Типовые реальные дефекты: DNS-утечка при прокси-маршрутизации, невалидный `respect-rules`, гео-рассинхрон `nameserver-policy` против правил, «слепые» IP-правила в fake-ip. v1.12-кандидат: статический аудитор `dnsRoutingAudit(doc)` для Config Studio (диагностика рядом с `csDiagnostics`) и Builder.

## 2. SOURCE-PROVEN факты (mihomo v1.19.32)

| # | Факт | Источник |
|---|---|---|
| F1 | `dns.respect-rules: true` при пустом `dns.proxy-server-nameserver` → конфиг невалиден, mihomo не стартует: `if “respect-rules” is turned on, “proxy-server-nameserver” cannot be empty` | `config/config.go:1420-1421` |
| F2 | nameserver без `proxy-name` при `respect-rules: true` получает proxyName `RULES` (`dns.RespectRules`) — и его соединения маршрутизируются через rule engine (`resolveMetadata`) | `config/config.go:1291`, `tunnel/dns_dialer.go:18,57-70` |
| F3 | nameserver без `proxy-name` и без respect-rules → `proxyAdapter == nil` → прямое соединение (`dialer.DialContext`), минуя туннель | `tunnel/dns_dialer.go:88-91,103-107` |
| F4 | `proxy-server-nameserver-policy` без `proxy-server-nameserver` → ошибка конфигурации `disallow empty "proxy-server-nameserver" when "proxy-server-nameserver-policy" is set` | `config/config.go:1457-1459` |
| F5 | IP-правила (`IP-CIDR`, `GEOIP`, …): при `no-resolve` пропускают разрешение и матчатся по текущему `DstIP`; без него дёргают `helper.ResolveIP()` | `rules/common/ipcidr.go:35-45` |
| F6 | `ResolveIP`-хелпер резолвит хост ТОЛЬКО если `!resolved` — соединение с fake-ip уже имеет `DstIP` из 198.18.0.0/16, IP-правила видят фейковый адрес | `tunnel/tunnel.go:337-350` |

Проверка исходников: `raw.githubusercontent.com/MetaCubeX/mihomo/v1.19.32/...` (NIGHT-MEGA-01, копии в `%TEMP%\mega-b-src` в момент исследования).

## 3. Каталог находок PoC

| id | severity | evidence | Условие | Обоснование |
|---|---|---|---|---|
| `dns-respect-rules-no-psns` | error | CONFIRMED | F1 | копия валидатора mihomo до деплоя |
| `dns-bypass-for-proxied-domains` | warning | INFERRED | есть прокси-доменные правила ∧ ¬respect-rules | F3: DNS идёт напрямую; влияние зависит от окружения (утечка/подмена резолвером) |
| `dns-policy-vs-rule-mismatch` | warning | INFERRED | `nameserver-policy[dom]` — direct-цель ∧ правило на `dom` → прокси-группа | F2/F3: гео-рассинхрон ответа и пути |
| `fake-ip-with-ip-rules` | info | CONFIRMED | `enhanced-mode: fake-ip` ∧ есть IP-правила | F5/F6: IP-правила видят 198.18/16 |

INFERRED = код-уровень доказан, влияние — гипотеза об окружении; формулировки находок это честно называют (без «утечка гарантирована»).

## 4. PoC

`research/poc/dns-routing/dns-routing-audit.mjs` — чистая функция, вход: разобранный doc (объект), выход: findings с `id/severity/evidence/message/refs`. Реестр `AUDIT_FINDINGS` — стабильные id для UI. Тесты: `research/poc/dns-routing/dns-routing-audit.test.mjs` (node --test, 13 проверок: позитив/негатив каждой находки, мусорный вход, согласованность реестра).

Запуск: `node --test research/poc/dns-routing/dns-routing-audit.test.mjs`

## 5. Интеграция (выполнена — v1.11 CANDIDATE, ожидает OWNER GO)

Реализовано в candidate-PR (политика v1.11 CANDIDATE от 2026-10-09; мерж — только отдельный OWNER GO):

1. Ядро — маркер-блок DNS-CORE внутри CS-CORE (index.html): `dnsRoutingAudit(doc)` (чистая функция, самодостаточна) + `csDnsRoutingText(doc)` (отображение через `csRedactText`).
2. Точка вызова: `csRunAnalysis` после «Разобрать» → панель «DNS ↔ Routing» (`csDnsRoutingPanel`/`csDnsRoutingOut`); «Очистить» опустошает; снапшот-семантика как у VRG (правки редактора панель не перетирают).
3. Builder-хук (аудит после Build) — сознательно НЕ в candidate-PR: foreign-config-сценарий Config Studio закрывает основную ценность; Builder-вариант — отдельным шагом после GO, если нужен.
4. UI-правило выполнено: `error`-находки НЕ блокируют Copy (валидатор экспорта остаётся единственным блокером).
5. Regression: `tests/dns-routing-core.cjs` (9 cases, извлечение DNS-CORE из index.html) + `tests/dns-routing-browser.cjs` (7 проверок: находки/redaction/clear/dns-off/снапшот) — оба в Generator CI.

## 6. Ограничения (честные)

- DOMAIN-SUFFIX-семантика против wildcard-ключей политики сведена к точному совпадению после снятия `+.`/`.`-префикса — суффиксные совпадения (`a.b` политика против `x.a.b` правило) НЕ матчатся (ложноотрицательный gap, не ложное срабатывание).
- GEOSITE/RULE-SET/под-правила/sub-rules не разворачиваются — домены внутри провайдеров недоступны статически; это честный UNKNOWN (как в RD-кондишенах).
- `no-resolve`-зависимость обхода правил (частичное разрешение в порядке правил) не моделируется — PoC не претендует на предсказание мэтча, только на рассинхрон секций.
- Аудит не знает о реальном окружении (доверенный ли локальный резолвер) — поэтому INFERRED-находки не «ошибка», а предупреждение.

## 7. Тест-план (field-test v1.11)

1. Прогон на реальных конфигах владельца (read-only, локально) — подтвердить отсутствие ложных срабатываний на живых fleet-профилях.
2. Позитивные контроль-кейсы из §2 источников (ошибка respect-rules воспроизводится `mihomo -t`).
3. Сравнение с `mihomo -t`: каждая `error`-находка должна соответствовать отказу `-t` (и наоборот — расхождения задокументировать).
