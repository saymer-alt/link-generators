# Engineering Status — handoff for the next agent (NIGHT-MEGA-01)

Дата: 2026-10-08. Назначение: самодостаточная точка входа в инженерное состояние v1.11-complete + future-research. Читай вместе с [../../V1.11-FINAL-INTEGRATION-REPORT.md](../V1.11-FINAL-INTEGRATION-REPORT.md) и [V1.12-V1.14-CANDIDATE-ROADMAP.md](V1.12-V1.14-CANDIDATE-ROADMAP.md).

## 1. Где что лежит

| Поток | Состояние | Где |
|---|---|---|
| v1.11 production (`main`) | feature-complete; VRG-интеграция добита (PR #204) | `index.html` (маркер-блоки RD-CORE/CS-CORE/CS-EDITOR/PT-*/VRG-CORE), `tests/` |
| v1.11 PT/CS/VRG тесты | зелёные; CI-контракт: каждый `tests/*.cjs` (не manual) ОБЯЗАН быть в `generator-ci.yml` (wiring-guard в job static+node) | `.github/workflows/generator-ci.yml` |
| Future research (B1–B5) | PoC-и реализованы и протестированы | `research/poc/{dns-routing,mrs,wg-awg-collector,warpscout-engine,known-services}/`, `docs/research/future/` |
| Roadmap | сводка v1.12–v1.14 | `docs/research/future/V1.12-V1.14-CANDIDATE-ROADMAP.md` |

## 2. Что сделано в NIGHT-MEGA-01 (основа для следующих проходов)

- **PR #204 (TRACK A, СМЕРЖЕН)**: VRG Builder auto-render, Config Studio VRG-панель, SVG focus (click+клавиатура), текстовая альтернатива, глубокое копирование в `vrgBuildView`, детерминированное усечение. Добор: метки узлов CS-VRG прогоняются через `csRedactText` (редакция ДО усечения — обрезанный секрет не матчится; тест security-stress 51 проверка), CI-wiring `vrg-integration-browser.cjs`.
- **B1 DNS↔Routing**: чистый аудитор `dnsRoutingAudit(doc)` — 4 находки (respect-rules валидация CONFIRMED, DNS-байпас, policy-vs-rule, fake-ip+IP-правила). 13/13.
- **B2 MRS**: полный JS-порт DomainSet (builder+serializer+reader+has+foreach). Эмпирика: **builder воспроизводит payload официального mihomo v1.19.31 байт-в-байт**; behavior-enum исправлен (domain=0, ipcidr=1); domain-MRS НЕ содержит values. 10/10. Фикстуры официального бинарника — в репо (fixtures/PROVENANCE.md).
- **B3 WG/AWG collector**: read-only снимок инцидента; маскирование private key (строка 1 dump) и PSK пиров (поле 2) — первый вариант маскировал НЕ ТЕ поля (поймано тестами). 14/14 offline на стабах.
- **B4 WARPSCOUT engine**: validate/aggregate/freshness/dedup/mask по контракту §3–§7. 10/10.
- **B5 Known-services**: validate/lookup/merge/review-due; конфликты видимы, слабый источник не перезаписывает сильный. 9/9.
- **TRACK C**: roadmap + обновлённый индекс future/README.md (статусы и «следующие шаги» актуализированы).

## 3. Как проверять (воспроизведение)

```sh
# все PoC-тесты (Node 22, без зависимостей):
node --test research/poc/dns-routing/dns-routing-audit.test.mjs      # 13
node --test research/poc/mrs/decode-mrs.test.mjs                     # 10 (байт-в-байт с официальным бинарником)
node --test research/poc/warpscout-engine/engine.test.mjs            # 10
node --test research/poc/known-services/provenance.test.mjs          # 9
sh research/poc/wg-awg-collector/collector.test.sh                   # 14 (POSIX sh; на Windows — LF-копии)

# production-регрессия — см. docs/TESTING.md (браузерные требуют Playwright/msedge)
```

Воспроизведение MRS-эмпирики (если понадобится пересоздать фикстуры): официальный бинарник `mihomo convert-ruleset domain text domains.list out.mrs` (аргументов ровно 4 — target-format НЕ передаётся) + zstd CLI v1.5.6 (`zstd -d -c out.mrs > out.inner`). Проверенный sha256 zstd.exe: `6b5c50dde7062909b69b618fae228c72090596dc254efe498fb426f5f430a1f9`.

## 4. Открытые гейты / что блокирует production

1. **v1.11 release** — ждёт owner field-test (это решение владельца, не агента).
2. **v1.12 start** — только по явному owner GO. Дешёвый первый кандидат — DNS↔Routing (тест-план §7 документа).
3. **FIELD-OBSERVED данные отсутствуют**: path MTU (auto-MTU), реальные WG-инциденты (auto-restart), реальные WARPSCOUT-перепроверки — всё остаётся PoC до сбора данных на живых системах (по operator-задачам).
4. **ipcidr payload MRS** — следующий исследовательский шаг (header сверен, payload нет).

## 5. Ловушки, найденные в этом проходе (экономь время следующего)

- `research/poc/**/*.test.mjs` НЕ кладите в `tests/` — wiring-guard CI требует явного шага для каждого `tests/*.cjs`.
- LOUDS-навигация DomainSet: `nextNodeId = bmIdx − nodeId + 1`, entry ребёнка = `select(nodeId−1)+1`; в Go-циклах пост-инкремент — первый сравниваемый бит ВХОДНОЙ bmIdx (частый порт-баг — off-by-one на входе узла).
- `select(i)` — i-я единица 0-based; бинарный поиск по слову проще заменить линейным сканом 64 бит (PoC-стиль) — производительность добирается инкрементальными кэшами, не «умным» поиском.
- `awg show <iface> dump`: строка 1 — интерфейс (поле 1 = private key), пиры — поле 2 = preshared key. Маскирование «$1 и $4 везде» портит публичные ключи и ПРОПУСКАЕТ PSK.
- Go-битмапы uint64 → в JS только BigInt-слова; `&` возвращает int32 — сравнения с unsigned требуют `>>> 0` на обеих сторонах.
- sh-тесты на Windows: прогонять `tr -d '\r'` копии; `set -u` ловит неиспользуемые позиции `$2` в функциях-обёртках.
