# Known-Services DB & Provenance — архитектура будущего (NIGHT-FUTURE-01)

Дата: 2026-10-08. Статус: **RESEARCHED** (архитектура; никакой базы в приложение не встраивается).
Переиспользование: Routing Intelligence (docs/CONFIGURATION-INTELLIGENCE.md — CDG/Domain Coverage), GeoSite/RuleProvider-модель (rule-providers + MRS — future/MRS-TOOLCHAIN.md), Rule Provider Explorer (инвентарь/поиск), Upstream compatibility registry (#136 — tracked-blob-SHA модель).

---

## 1. Назначение

База известных сервисов отвечает на вопрос «что это за домен/CIDR и откуда мы это знаем» — для диагностики (почему правило сработало), а не для автогенерации правил. Ключевой принцип: **каждая запись несёт происхождение и степень достоверности**, конфликты источников — видимы, а не молча разрешаются.

## 2. Формат записи (v1 — проект)

```json
{
  "entryId": "ks-<hash8>",
  "kind": "domain | domain-suffix | domain-keyword | ip-cidr | ip-asn",
  "value": "example.invalid",
  "service": "Пример-сервис (человекочитаемая метка)",
  "category": "ai | media | telegram | google | microsoft | shopping | …",
  "provenance": {
    "source": "ed74c… | manual:owner | warpscout-obs | github:<repo>@<sha>",
    "observedAt": "2026-10-08",
    "confidence": "SOURCE-VERIFIED | FIELD-OBSERVED | COMMUNITY | HEURISTIC"
  },
  "freshness": { "reviewIntervalDays": 180, "reviewDue": "2027-04-07" },
  "conflicts": [ { "source": "другой источник", "value": "альтернативное значение" } ]
}
```

Правила:
- `confidence` — упорядоченный уровень; конфликт источников НЕ разрешается автоматически — обе записи показываются с пометкой;
- `observedAt` обязателен; записи без него — `HEURISTIC` принудительно;
- значения доменов — lower-case, punycode-нормализация, без путей.

## 3. Переиспользование существующего

| Существующее | Что берём |
|---|---|
| Domain Coverage Checker | движок «домен → победившее правило + путь» — точка входа для обогащения known-services подсказками |
| Rule Provider Explorer | уже умеет искать по inline-провайдерам — known-services прослойка показывает provenance рядом |
| Upstream compat registry (#136) | модель «tracked blob SHA + красный CI при смене» — тот же паттерн для сторонних списков |
| GeoSite `.mrs`/текстовые списки | внешние источники — через provenance-обёртку (source/observedAt), не встроенные в bundle |

## 4. Безопасное обновление

1. Обновление источника = новый commit с трекнутым blob-SHA (#136-паттерн) — изменение видно в CI.
2. Записи с confidence COMMUNITY/HEURISTIC не могут перезаписать SOURCE-VERIFIED — конфликт остаётся видимым.
3. Review-due не удаляет записи автоматически — только помечает «пора перепроверить».
4. Никакой авто-загрузки в приложение; база — файлы в репозитории + поисковая прослойка.

## 5. Чего не делать

- Не встраивать «огромную базу всех сервисов» в bundle (размер + риск устаревания + юридические вопросы источников).
- Не подменять GeoSite/GeoIP-списки пользователя извест-services записями.
- Не скрывать конфликты источников молча.

## 6. Тесты (проект)

1. Валидная запись — парсится.
2. Конфликт SOURCE-VERIFIED vs COMMUNITY — обе записи видны.
3. Запись без observedAt → HEURISTIC.
4. Review-due просрочен → пометка, не удаление.
5. Нормализация домена (punycode/case).
6. CIDR-нормализация и проверка маски.

**Обновлено (NIGHT-MEGA-01 B5)**: все 6 пунктов реализованы — `research/poc/known-services/provenance.mjs` (validate/enforceConfidence/lookup/merge/isReviewDue; lookup: exact/suffix/keyword/cidr/asn, сортировка по confidence; merge: слабый источник не перезаписывает сильный, любая замена регистрируется в conflicts — молчаливых разрешений нет) + `provenance.test.mjs` (9 проверок node --test, включая punycode через URL API и голый IPv4 как /32). PoC, никакая база не встроена.
