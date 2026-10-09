# DNS ↔ Routing Intelligence — v1.11 CANDIDATE

Дата независимой ревизии: 2026-10-09. PR #207 остаётся открытым: merge только после отдельного OWNER GO. Это диагностика Config Studio, не изменение YAML и не измерение сети.

## Источники и исправленные выводы

Проверены обе версии: [Mihomo 1.19.31 config.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.31/config/config.go), [1.19.32 config.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.32/config/config.go).

- `DefaultRawConfig` задаёт `DNS.Enable=false`. Наличие mapping `dns:` не включает DNS.
- `parseDNS` проверяет `respect-rules` и обязательный `proxy-server-nameserver` независимо от Enable. Структурная ошибка показывается даже при выключенном DNS.
- `parseNameServer` извлекает ProxyName из fragment: последний bare-компонент `#PROXY&ecs=...`; параметры `key=value` не являются селекторами. HTTPS/TLS/QUIC описывают транспорт DNS. Без fragment и respect-rules запрос прямой; с respect-rules используется RULES. Известный селектор означает explicit proxy selection, не доказанный tunnel (группа может выбрать DIRECT).
- Неизвестное имя fragment может быть интерфейсом: UNKNOWN, без догадки о прокси.
- [DNSDialer](https://github.com/MetaCubeX/mihomo/blob/v1.19.32/tunnel/dns_dialer.go) выбирает named proxy либо интерфейс; пустой ProxyName использует dialer напрямую. Прямой encrypted resolver не является автоматически доказанной утечкой.
- Предыдущий вывод PoC «IP-правила всегда видят fake 198.18/16» **опровергнут**: [preHandleMetadata и resolveMetadata](https://github.com/MetaCubeX/mihomo/blob/v1.19.32/tunnel/tunnel.go#L296) восстанавливают hostname и очищают fake DstIP до routing; ResolveIP при необходимости получает реальный IP. Панель сообщает UNKNOWN результата конкретного запроса.

## Поддерживаемая модель

`dnsRoutingAudit` переиспользует `rdParseRule`. DOMAIN/DOMAIN-SUFFIX/DOMAIN-KEYWORD/MATCH идут в исходном порядке: первое совпадение выигрывает. Exact policy key и `+.`/`.` suffix base проверяются по этой модели. Непрозрачное предшествующее GEOSITE/RULE-SET/IP/logical rule делает результат UNKNOWN; содержимое внешних providers не загружается.

Resolver и массивы nameserver-policy классифицируются по каждому endpoint: DIRECT / explicit-proxy / rules / UNKNOWN. Предупреждение о различии путей появляется только при доказанном DIRECT endpoint и поддерживаемом proxy-domain rule. Смешанный список не считается целиком проксированным. Окружение, bootstrap DNS, выбранный member группы, geolocation и реальные утечки **не наблюдались**.

CONFIRMED относится к structural parse error; INFERRED — возможному влиянию разницы путей; UNKNOWN — непокрытой семантике. Отсутствие finding не доказывает безопасность сети.

## UI и snapshot

Config Studio → Разобрать → DNS ↔ Routing. Анализ локальный; никаких запросов к nameservers/controllers. Изменение source/editor не обновляет snapshot автоматически: повторите Разобрать. Clear очищает панель. Все строки проходят csRedactText. Ошибки этой панели не подменяют validator/export gate. Quick Start синхронизирован.

## Проверки

- `dns-routing-core.cjs`: 15 групп, включая omitted/disabled Enable, безусловную structural check, URI fragments/parameters, policy arrays, first-match/duplicates/MATCH/suffix, unknown interface/provider, mixed endpoints, redaction.
- `dns-routing-browser.cjs`: rendering, redaction, disabled/structural, explicit-proxy, snapshot/clear.
- `dns-routing-mihomo-compat.cjs`: 5 parse-only synthetic cases; CI matrix 1.19.31/1.19.32. `-t` не запускает сервер и не доказывает трафик.
- Historical `research/poc/dns-routing` не является текущим semantic acceptance gate: его исходные выводы о схемах, first-match и fake-IP superseded этой ревизией. Research не переносился в production.

Финальный READY/NOT READY фиксируется в комментарии PR на точном head после завершения всех обязательных CI jobs. mergeable=true недостаточно. Field-test с реальными данными владельца NOT RUN.
