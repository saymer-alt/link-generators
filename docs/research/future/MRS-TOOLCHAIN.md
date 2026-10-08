# MRS Toolchain — будущее исследование (NIGHT-FUTURE-01)

Дата: 2026-10-08. Статус: **RESEARCHED + EMPIRICALLY PROVEN (domain payload)** — см. §5 (обновлено NIGHT-MEGA-01 B2).
Upstream: MetaCubeX/mihomo, **тег v1.19.32** (все ссылки — raw-fetch этого тега, 2026-10-08).

Evidence-метки: SOURCE-PROVEN (прочитано в исходниках указанного тега) / INFERRED / UNKNOWN / EMPIRICAL (сверено с выводом официального бинарника mihomo v1.19.31).

---

## 1. Что такое MRS

MRS (Meta Rule Set, внутреннее имя `MrsRule`) — бинарный формат rule-set'ов Mihomo. Хранит заранее развёрнутую структуру правил (succinct-трю для доменов, CIDR-сет для IP), что даёт быструю загрузку и малый расход памяти по сравнению с текстовыми/`yaml` rule-set'ами.

SOURCE-PROVEN: формат читается только стратегией с соответствующим behavior (`rules/provider/mrs_reader.go` — `if _behavior[0] != strategy.Behavior().Byte()` → «invalid behavior»); classical-стратегия MRS не поддерживает (`classical_strategy.go` не содержит FromMrs).

## 2. Контейнерный формат (SOURCE-PROVEN, v1.19.32)

Внешний контейнер — **zstd-поток** (klauspost/compress/zstd). Внутри после декомпрессии:

```text
offset  size  поле
0       4     magic: 'M','R','S',0x01   (MrsMagicBytes, "MRSv1")
4       1     behavior byte             (strategy.Behavior().Byte(); должен совпадать
                                         с ожидаемым behavior rule-set'а)
5       8     count: int64 big-endian   (число правил)
13      8     extra-length: int64 BE    (зарезервировано; отрицательное = ошибка)
21      N     extra                     (если extra-length > 0)
21+N    …     strategy payload          (зависит от behavior — см. §3)
```

Источники: `rules/provider/mrs_reader.go` (rulesMrsParse), `rules/provider/mrs_converter.go` (ConvertToMrs).

## 3. Strategy payload (SOURCE-PROVEN)

### 3.1 behavior=domain — `rules/provider/domain_strategy.go`

`FromMrs` → `trie.ReadDomainSetBin(r)` (domain_strategy.go:57-58); `WriteMrs` → `domainSet.WriteBin(w)`; `DumpMrs` — экспорт обратно в текст.

**Payload = DomainSet bin, и ТОЛЬКО он** (уточнено B2): `FromMrs` читает ровно `ReadDomainSetBin` — ни separator, ни values после него. (`DomainMap.WriteBin` из `domain_map_bin.go` с separator/version/values — другой путь записи, в MRS-payload не участвует; прежняя версия этого документа ошибочно приписывала его MRS.)

```text
0x01                version
int64 BE            leaves: число uint64 BE слов
leaves              бит-вектор терминальных узлов
int64 BE            labelBitmap: число uint64 BE слов
labelBitmap         LOUDS-битмап меток/закрытий
int64 BE            labels: число байт
labels              BFS-метки (байты реверсированных ключей)
```

### 3.2 behavior=ipcidr — `rules/provider/ipcidr_strategy.go`

`FromMrs/WriteMrs` на `cidr.IpCidrSet` (`component/ipcidr`) — radix-подобная CIDR-структура с用自己的 bin-форматом. Детали payload — UNKNOWN без отдельного чтения `component/ipcidr` (задача следующего прохода).

### 3.3 behavior=classical

MRS не поддерживается: `classical_strategy.go` не реализует FromMrs/WriteMrs; `rulesMrsParse` вернёт `ErrInvalidFormat`. SOURCE-PROVEN.

### 3.4 Succinct DomainSet — ядро формата (EMPIRICAL с B2)

`component/trie/domain_set.go` + `domain_set_bin.go` (порт «openacid/succinct sskv»):
- ключи = байт-реверс целиком домена, нормализованного в lowercase (`insert` → `utils.Reverse(joinDomain(parts))`); `+.dom` даёт ДВЕ вставки (точная `dom` + суффикс `+.dom`); `.dom` → `+`-форма;
- константы: `+` (complexWildcard — матчится любой хвост), `*` (ровно один label), `.` (шаг домена);
- сериализация — version(1) + leaves + labelBitmap + labels (см. §3.1), порядок байтов BE;
- `Has()` — обход входа с конца (revLowerAt) по LOUDS-правилу `nextNodeId = bmIdx − nodeId + 1`, `entry = select(nodeId−1)+1`, wildcard-стек для `*`, рестарт-переходы для `*`/`.`-веток;
- `Foreach` — DFS; `+.dom` выводится как пара `dom` + `.dom` (хвостовая точка реверсированного ключа после среза `+`).

**Эмпирическое доказательство (B2)**: JS-порт (`research/poc/mrs/decode-mrs.mjs`) воспроизводит payload официального бинарника байт-в-байт; декодер отвечает на членство с полной wildcard-семантикой. Фикстуры: `research/poc/mrs/fixtures/` (PROVENANCE.md внутри).

## 4. Повреждённые файлы — проверки (проект парсера)

SOURCE-PROVEN аналоги проверок из mrs_reader.go:
1. zstd-декодирование падает → «не MRS/повреждён»;
2. magic ≠ MRSv1 → отказ;
3. behavior byte ≠ ожидаемому → отказ (mismatch behavior);
4. count/extra-length < 0 → отказ;
5. усечённый extra/payload → io.ReadFull ошибка;
6. (для domain) DomainSet-структура с противоречивыми bitmap'ами → отказ декодера.

Для браузерного viewer'а добавить: лимит размера (расжатый ≤ N МБ), лимит count, лимит глубины рекурсии (0 в v1.11 — формат плоский).

## 5. Ограничения и honest gaps

Обновлено 2026-10-08 (NIGHT-MEGA-01 B2) — часть прежних gaps закрыта эмпирикой:

- ~~succinct-формат не подтверждён~~ → **EMPIRICAL**: JS-порт builder'а воспроизводит payload официального бинарника mihomo v1.19.31 байт-в-байт (тест «bit-for-bit» в `decode-mrs.test.mjs`).
- ~~behavior byte не зафиксирован~~ → **EMPIRICAL: domain=0, ipcidr=1** (фикстуры официального `convert-ruleset`). Прежнее INFERRED 1/2/3 опровергнуто.
- ~~values DomainMap — UNKNOWN~~ → **в MRS их нет**: `FromMrs` читает только `ReadDomainSetBin` (см. §3.1).
- Производительность PoC-декодера ~2 мс/lookup на 20k доменах (rank O(words), select — линейный скан слова). Production-парсер требует инкрементальных rank/select-кэшей (как `IndexSelect32R64` openacid/low/bitmap) — иначе только офлайн-инструменты, не UI.
- Не-ASCII домены: Go — rune-ToLower + реверс; PoC — JS `toLowerCase` (расхождение на отдельных codepoints). Для публичных geo-списков неактуально; граница задокументирована.
- zstd: `node:zlib` (v22.14) zstd не умеет; использован официальный CLI zstd v1.5.6 win64 (sha256 `6b5c50dde7062909b69b618fae228c72090596dc254efe498fb426f5f430a1f9`). В браузере — `DecompressionStream('zstd')` (Chrome 130+) или wasm; решение за будущим viewer'ом.
- ipcidr payload (`component/ipcidr`) не декодируется — header эмпирически сверен (behavior=1), payload — задача следующего прохода.

## 6. Модель будущего инструментария

| Инструмент | Фиджibility | Основание |
|---|---|---|
| MRS viewer (что внутри) | браузер: ДА (нужен zstd-decode + succinct-декодер) | формат читаемый, بدون сети |
| MRS parser (текст чтения) | браузер: ДА (DumpMrs-семантика известна: `+.domain` группировка) | SOURCE-PROVEN |
| MRS converter (text→mrs) | браузер: ТЯЖЕЛО — нужен succinct-Builder (байт-в-байт совместимость с Go-реализацией рискованна) | риск несовпадения битовых структур |
| MRS builder (генерация своих) | 同 converter; рекомендация v1.12+: вызывать локальный `mihomo convert-ruleset`, не переизобретать | safety > convenience |

Совместимость с генератором: MRS используется как `rule-providers[].format: mrs` + `url`/`path`; генератор уже эмитит формат-поле — viewer/parser лишь помогает понять содержимое, не меняя Builder.

## 7. План тестирования будущего парсера

1. Синтетический inner-payload (magic+behavior+count+extra) — happy path.
2. Битый magic → отказ.
3. Behavior mismatch → отказ.
4. Отрицательный extra-length → отказ.
5. Усечённый payload → отказ.
6. Реальный .mrs (владелец скачивает из легитимного источника) → сверка count с DumpMrs.
7. Крупный файл (1M доменов) — память/время.

## 8. PoC

- `research/poc/mrs/inspect-mrs.mjs` — заголовочный инспектор (первый проход): заголовок/behavior/count/extra + synthetic fixture; succint payload НЕ декодирует.
- `research/poc/mrs/decode-mrs.mjs` (B2, 2026-10-08) — полный JS-порт: builder (`insertKeys`/`buildDomainSet`), serializer (`domainSetWriteBin`), reader (`parseMrsContainer`/`readDomainSetBin`), запросы (`has`/`foreach`). Зависимости: нет (node:buffer + BigInt).
- `research/poc/mrs/decode-mrs.test.mjs` — 10 проверок node --test: заголовки обоих behaviors, членство (позитив/негатив/wildcard/регистр), Foreach-семантика, **байт-в-байт сверка с официальным бинарником**, round-trip, мусорные входы.
- `research/poc/mrs/fixtures/` — синтетические фикстуры официального бинарника + PROVENANCE.md (без реальных geo-данных).

## 9. Следующие шаги (implementation tasks, v1.12+ candidate)

1. ~~Верифицировать behavior byte~~ — СДЕЛАНО (B2: domain=0, ipcidr=1).
2. ~~Перенести succinct decode в JS + fixture-сверка~~ — СДЕЛАНО (B2, байт-в-байт).
3. MRS viewer как отдельная research-страница (нужен zstd-decode в браузере + инкрементальные rank/select-кэши).
4. Решение по converter: паритет с `mihomo convert-ruleset` (builder уже байт-совместим — осталось обвязать zstd-сжатие) против «вызывать mihomo локально».
5. ipcidr payload: прочитать `component/ipcidr` bin-формат, эмпирически сверить на CIDR-фикстуре.
