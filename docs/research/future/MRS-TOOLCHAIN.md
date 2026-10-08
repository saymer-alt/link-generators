# MRS Toolchain — будущее исследование (NIGHT-FUTURE-01)

Дата: 2026-10-08. Статус: **RESEARCHED (частично — см. §5 Ограничения)**.
Upstream: MetaCubeX/mihomo, **тег v1.19.32** (все ссылки — raw-fetch этого тега, 2026-10-08).

Evidence-метки: SOURCE-PROVEN (прочитано в исходниках указанного тега) / INFERRED / UNKNOWN.

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

`FromMrs` → `trie.ReadDomainSetBin(r)`; `WriteMrs` → `domainSet.WriteBin(w)`; `DumpMrs` — экспорт обратно в текст (группирует `domain` + `.domain` в `+.domain`).

Payload = `DomainMap.WriteBin` (`component/trie/domain_map_bin.go`):

```text
succinct DomainSet (см. §3.2)
0x00                separator
0x01                version
int64 BE            values count
values              (для domain-behavior — зависимости от версии; формат values
                     определяется writeValue-колбэком)
```

### 3.2 behavior=ipcidr — `rules/provider/ipcidr_strategy.go`

`FromMrs/WriteMrs` на `cidr.IpCidrSet` (`component/ipcidr`) — radix-подобная CIDR-структура с用自己的 bin-форматом. Детали payload — UNKNOWN без отдельного чтения `component/ipcidr` (задача следующего прохода).

### 3.3 behavior=classical

MRS не поддерживается: `classical_strategy.go` не реализует FromMrs/WriteMrs; `rulesMrsParse` вернёт `ErrInvalidFormat`. SOURCE-PROVEN.

### 3.4 Succinct DomainSet — ядро формата

`component/trie/domain_set.go` (заголовок: «Modify from https://github.com/openacid/succinct/blob/…/sskv.go»):
- домены вставляются **в обратном порядке частей** (`insert(parts []string)` — reversed labels) в succinct-трие;
- структура — labelStream + bitmap'ы (label/childStart/leaf) openacid-succinct-формата;
- `Has(key)` декодирует по этим стримам; `Foreach` — полный обход.

Точная байтовая раскладка стримов — SOURCE-PROVEN только по факту «это модифицированный openacid/succinct sskv»; для рабочего парсера потребуется перенос openacid/succinct в JS (или чтение обоих репозиториев построчно). Это **главная трудоёмкость** будущего MRS-парсера.

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

- **Точный succinct-бинарный формат DomainSet не подтверждён побайтовой реализацией** — формат обёртки SOURCE-PROVEN, внутренности succinct-трие — INFERRED из openacid/succinct (файл указан в комментарии upstream). UNKNOWN до первого рабочего парсера.
- **behavior byte числовые значения не зафиксированы в этом проходе** (INFERRED: Domain/IPCIDR/Classical — iota-порядок; эмпирически проверяется на реальном .mrs).
- `values` DomainMap для behavior=domain — формат writeValue-колбэка не найден в прочитанных файлах (UNKNOWN).
- Node-side zstd в браузере: `DecompressionStream('zstd')` поддержан не везде (Chrome 130+); для надёжного viewer'а — wasm-библиотека или предраспакованный inner-payload. Решение — за будущей задачей.

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

`research/poc/mrs/inspect-mrs.mjs` — автономный Node-скрипт (без зависимостей):
- принимает декомпрессированный inner-payload (stdin/файл) и проверяет заголовок/behavior/count/extra по §2;
- генерирует synthetic inner-payload fixture (`--make-fixture`);
- НЕ декодирует succinct DomainSet (см. §5) — честная граница PoC.

## 9. Следующие шаги (implementation tasks, v1.12+ candidate)

1. Верифицировать behavior byte на реальном .mrs (эмпирика).
2. Перенести openacid/succinct sskv decode в JS (или переиспользовать готовый порт) + fixture-сверка с Go.
3. MRS viewer как отдельная research-страница (не в production bundle).
4. Решение по converter: паритет с `mihomo convert-ruleset` против «вызывать mihomo локально».
5. Расширить исследование на ipcidr payload (`component/ipcidr`).
