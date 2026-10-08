# Runtime Evidence (#188): controller API, evidence model, security contract

Документ цикла v1.11 (#177; #188). Дата: 2026-10-08. Базис: main `391298b`.
Evidence-метки: SOURCE-PROVEN (raw-fetch исходников тега v1.19.32), FIELD-OBSERVED, INFERRED, UNKNOWN.

## 1. Controller API — SOURCE-PROVEN (тег v1.19.32)

| Вопрос | Ответ | Источник |
|---|---|---|
| auth | `Authorization: Bearer <secret>`; неверный/пустой секрет → HTTP 401; websocket `?token=` — исключение, не используется | `hub/route/server.go` authentication() |
| CORS | middleware `cors.New{AllowedOrigins: cfg.allow-origins, AllowedHeaders: [Content-Type, Authorization], Methods: [GET,POST,PUT,PATCH,DELETE]}`; **дефолт allow-origins = `["*"]` + allow-private-network: true** | server.go + config.go defaults |
| GET /version | существует (route), отдаёт `{version: …}` | server.go |
| GET /proxies | `{"proxies": {name: ProxyJSON}}` — все прокси и группы | hub/route/proxies.go getProxies |
| ProxyJSON | name/type/udp/alive/history/extra/… (+ dialer-proxy/provider-name) | adapter/adapter.go MarshalJSON |
| группа `now` | Selector.Now() = выбранный вручную/по умолчанию участник; URLTest.Now() = живой с лучшей задержкой; Fallback.Now() = первый живой по порядку — все три MarshalJSON сериализуют `"now"` и `"all"` | adapter/outboundgroup/{selector,urltest,fallback}.go |
| вложенные группы | `now` может указывать на другую группу; разрешение цепочки — клиентская задача (bounded recursion, см. §3) | INFERRED из MarshalJSON (all+now) |
| providers | GET /providers/proxies смонтирован (Runtime Import #159 уже использует) | server.go |

## 2. Браузерные ограничения (P2.8)

- HTTPS Pages → HTTP controller: localhost/127.0.0.1 браузеры считают «potentially trustworthy» — запрос из HTTPS-страницы на `http://127.0.0.1:PORT` обычно проходит (mixed-content не применяется к trustworthy origins). INFERRED (стандартное поведение Chromium/Firefox); на не-localhost HTTP-контроллерах mixed-content блокирует — честно сообщаем в диагностике.
- CORS: сервер mihomo по умолчанию `*` — браузерный cross-origin fetch допустим; если владелец сузил allow-origins — fetch упадёт, диагностика говорит «offline/CORS/mixed-content/нет SSH forward», НЕ интерпретируя это как «узел выключен».
- Рекомендуемая модель: `ssh -L 19090:127.0.0.1:9090 user@node` → endpoint `127.0.0.1:19090`. Генератор SSH-туннели не создаёт и не автоматизирует.

## 3. Evidence-модель (P2.4–P2.6)

- Профили: `ptRuntimeProfiles[nodeId] = {endpoint, secret, group, members}` — **memory-only**, никакого storage; ввод через per-node инпуты PT-панели.
- Состояния: NOT_CHECKED / FETCHING / OBSERVED / PARTIAL / UNREACHABLE / AUTH_ERROR / STALE / UNKNOWN (PT_RT_STATES). UNREACHABLE CONTROLLER ≠ NODE DOWN.
- Binding — только явный: `group` + `expectedMembers` на физическое ребро. Имена прокси («Estonia») физикой не считаются; альтернативные кандидаты одного ребра (Mieru→VLESS) = LOCAL POLICY changed, PHYSICAL TOPOLOGY unchanged.
- Selection chain: bounded recursion (≤8) + cycle detection; неизвестный лист — unverified tail → UNKNOWN (динамический provider-узел не классифицируется INCONSISTENT); built-in (DIRECT/REJECT/GLOBAL/PASS/REJECT-DROP/COMPATIBLE) известны независимо от /proxies → INCONSISTENT при выборе в обход контракта ребра.
- Классификация ребра: CONSISTENT (выбор ∈ ожидаемым кандидатам) / INCONSISTENT (built-in обходной таргет) / UNKNOWN (неизвестный кандидат) / PARTIAL (binding неполон, группа отсутствует на этом контроллере, цикл). Агрегат цепочки: INCONSISTENT > PARTIAL(UNREACHABLE/AUTH_ERROR/STALE) > UNKNOWN > CONSISTENT — детерминированный приоритет.
- STALE — структурный: fingerprint топологии/профилей; время НЕ меняет классификацию (timestamp виден, но инертен).

## 4. Секреты (P2.6)

`secret` профиля — memory-only: не localStorage/sessionStorage, не URL, не логи, не диагностике/рендеру (секрет используется только в Authorization-заголовке fetch-оркестратора), не manifest/deployment-map/generated configs. Проверено тестом SUPER_SECRET_RUNTIME_TOKEN_123 (body text + URL).

## 5. Потолок доказательности

Инструмент доказывает: контроллер reachable, версию, наблюдаемый выбор группы (с точностью до доверия контроллеру). Формулировка-потолок: «наблюдаемое состояние контроллеров согласуется с intended-топологией». НЕ доказывает: путь пакета, физическую достижимость ребра, сквозной канал. Дисклеймер присутствует в каждом отчёте UI.
