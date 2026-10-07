# Research: Preview ↔ Runtime parity подписочных узлов (#158)

Дата: 2026-10-07 (DAY-02). Статус: **PARTIAL** — механики потерь доказаны по коду (SOURCE-PROVEN),
конкретная причина кейса владельца (AEZA) остаётся UNKNOWN до полевого захвата payload.

FIELD-OBSERVED исходная точка (owner, 2026-10-07): browser preview ~109 узлов, `AEZA` отсутствует;
работающий Mihomo/MetaCubeXD показывает `AEZA` как живой provider-узел.

## R1. Потеря узлов из ТОГО ЖЕ payload: scheme-filter (SOURCE-PROVEN)

Preview-канал (`web4core` `fetchSubscription`) возвращает только строки со схемами из
`SUPPORTED_SCHEMES`: vmess, vless, trojan, anytls, ss, socks*, http(s), hy2, hysteria2, tuic, tt,
mieru(*s), sdns, masque. Незнакомые схемы **молча отбрасываются** финальным фильтром:

```
const filtered = lines.filter((line) => allowedSchemes.has((line.split(':', 1)[0] || '').toLowerCase()));
return filtered.join('\n');
```

Реальный Mihomo загружает заметно больше протоколов, чем web4core умеет парсить (ядро поддерживает,
например, ssr, snell, hysteria v1, ssh, wireguard-ссылки и др.). Следствие: узел, присутствующий в
том же payload, чья схема не входит в SUPPORTED_SCHEMES, **не попадает в preview и в selectable-список**,
но загружается работающим Mihomo. Это SOURCE-PROVEN механизм потери без изменения payload.

- Механика: SOURCE-PROVEN (код обеих сторон).
- Что конкретно у провайдера владельца: UNKNOWN (нет доступа к payload/панели).
- Возможный последующий fix (не в этой итерации): подсчёт отброшенных строк и честная диагностика
  «N строк неизвестных схем отброшено preview» (diagnostics before mutation; без попыток парсинга).

## R2. Clash YAML payload: полный отказ preview-канала (SOURCE-PROVEN)

```
if (/\bproxies\s*:/i.test(body) && !looksLikeLinksList(body))
  throw new Error('Clash YAML subscription is not supported here');
```

Если панель отдаёт браузерному UA Clash/Mihomo YAML, preview-канал падает целиком (в Sub Mode ON —
warning «provider YAML будет собран без preview»; в Sub Mode OFF — отказ сборки), а Mihomo тот же
payload загружает. Потеря не по-узловая, а всего источника разом.

- Отказ на YAML: SOURCE-PROVEN.
- Что реально отдаёт панель владельца браузеру: UNKNOWN.

## R3. Per-client (UA-зависимый) payload панели (HYPOTHESIS)

Сильное объяснение FIELD-OBSERVED-кейса: панель отдаёт разным клиентам разное представление/состав
(base64-ссылки браузеру, YAML/другой набор — clash-клиенту). Согласуется с наблюдаемым
(«в Mihomo есть, в preview нет»), но **не доказано**: нет захвата обоих payload и нет доступа к
логике панели. Статус: HYPOTHESIS. Специально НЕ внедрялось: подмена User-Agent через fallback-воркер
требует (по контракту задачи) проверенного исходника воркера, фиксированного allowlist-UA, невозможности
произвольных заголовков, privacy/security review и не должна ломать #156 identity — условия не проверены,
автоматическое внедрение запрещено.

## Authoritative mitigation (реализовано в этой итерации)

#159 Mihomo Runtime Node Import — запрос фактических provider-узлов у работающего Mihomo
(GET /providers/proxies; paste/upload fallback; read-only; см. CHANGELOG). Runtime-only узлы
(например AEZA) видны, находятся поиском, отмечаются галочкой и попадают в обычный exact
exclude-filter; reconciliation ∩/only показывает расхождение напрямую. Это escape-hatch,
не зависящий от того, какая из гипотез R1–R3 верна.

## Кандидаты на следующую итерацию (НЕ реализовано здесь)

1. Честный счётчик отброшенных схем в preview (R1) — diagnostics only.
2. Безопасное извлечение имён из Clash YAML (R2): parse `proxies[].name` only, без
   server/UUID/паролей/ключей; deterministic fixtures; privacy regression. Требует отдельного
   решения владельца (новый код на пути данных).
3. Полевой захват payload (preview vs Mihomo) на Geodema для перевода R3 из HYPOTHESIS в
   PROVEN/REFUTED.
