# Reverse Build / Config Studio 2.0 — архитектура (OWNER-REVERSE-01)

Дата: 2026-10-09. Связанные: [REVERSE-BUILD-RECOVERABILITY.md](REVERSE-BUILD-RECOVERABILITY.md) (поле-за-полем карта), [PORTABLE-BUILDER-PROJECT.md](PORTABLE-BUILDER-PROJECT.md) (формат проектного файла), [CONFIG-STUDIO.md](CONFIG-STUDIO.md) (существующий Studio), CONSTITUTION.md §2/§3/§5/§8.

## Текущая реализация после независимого аудита (2026-10-09)

Ниже сохранён исходный план PHASE A; фактическая карта — [REVERSE-BUILD-RECOVERABILITY.md](REVERSE-BUILD-RECOVERABILITY.md). Реальные entrypoints: `rbParseProjectText` / `rbYamlToProject` → Preview → `rbApplyProject` / `rbWriteProject`; сериализация `rbCollectProject`, Undo `rbUndoRestore`. Поле schemaVersion находится в корне; meta.origin = builder либо yaml-reverse.

Project Load использует native confirm с counts/Compare до применения. YAML Reverse использует отдельный Preview с Cancel/Confirm и acknowledgment потерь; stale snapshot отклоняется, CONFLICT/INVALID блокируются. Preview не является вторым редактируемым Builder: менять источники можно после Apply в обычных полях.

Apply валидирует/клонирует до мутации, откатывает ошибку и инвалидирует поздний Build. Passthrough сохраняет parsed source-config и переживает проект/Undo; это evidence, не автоматический merge в следующий YAML. Наличие поля в исходнике не означает реализованного reverse assignment. Исходный план ниже не является acceptance evidence.

## 1. Граница (по заданию, §PHASE H)

```text
Input YAML / Project File
       ↓
Recoverability Analyzer        (pure, marker-based — без regex-эвристик)
       ↓
Canonical Restored Project     (одна модель для обоих источников)
       ↓
Builder State Adapter          (apply → существующие DOM-поля/wgProfiles)
       ↓
Existing Builder / web4core    (НЕ переписывается; новая генерации-системы НЕТ)
       ↓
Generated YAML
```

Принципы:
- **Один source of truth** (CONSTITUTION §5): восстановленное состояние живёт в обычных полях Builder (`mihomoInput`, `wgProfiles`, чекбоксы, карточки) — никакого второго Builder внутри Studio. Studio 2.0 добавляет только «анализ → предпросмотр → apply → undo».
- **Diagnostics before mutation** (§2): до apply пользователь видит recoverability-отчёт (что EXACT/DERIVED/MISSING/UNSUPPORTED); apply — только по явному подтверждению; undo возвращает прежнее состояние Builder.
- **Semantic preservation** (§3): каждое распознанное значение получает статус; MISSING/UNSUPPORTED не исчезают — попадают в отчёт и passthrough-модель.
- **Fail-closed** (§8): существенная потеря (например, развёрнутые подписки + много UNSUPPORTED) → предложение остаться в source-preserving редакторе Studio вместо авто-перехода в Builder.

## 2. Компоненты

### 2.1 Recoverability Analyzer (pure, PHASE C ядро)

Вход: doc (js-yaml parse готового YAML) + опциональные подсказки. Выход: `{restored: CanonicalProject, findings[]}`.

- Работает ТОЛЬКО по детерминированным маркерам из RECOVERABILITY §2 (AWL-префиксы, `🪜`-группы, `policy-<slug>`, `SUB-*`, provider naming rule, dialer-proxy, external-ui, override-expr mlkem, vps-маркеры dns-hijack/sniffer/store-fake-ip/controller-bind).
- Ничего не «угадывает»: непонятное → UNKNOWN/UNSUPPORTED с raw-фактом.
- Переиспользует CDG (`cdgBuildGraph`) для проверок ссылок (dangling dialer/rule targets) — без параллельной модели графа.
- Секреты: значения остаются в модели (нужны для работы), в отчёты/логи не попадают (csRedactText на всём отображении).

### 2.2 Canonical Restored Project

Единая структура = расширенный проектный файл (PORTABLE-BUILDER-PROJECT.md §2): источники (subscriptions/links/wgProfiles с bean+filename), options, dpr, tiered, dialer, passthrough (UNSUPPORTED raw-объекты), `meta.schemaVersion`, `meta.origin: 'project'|'yaml'`.

Project-импорт заполняет её 1:1 (EXACT); YAML-импорт — через Analyzer с findings.

### 2.3 Builder State Adapter

`applyCanonicalProject(project, {dryRun})` → присваивает DOM-полям значения, восстанавливает wgProfiles (bean-объекты совместимы с parseWireGuardConf-выходом), карточки DPR/Tiered перерисовываются существующими рендерами. Snapshot/undo: перед apply — сериализация текущего состояния Builder тем же сериализатором проекта (см. PORTABLE §4) в память вкладки; «Отменить» = обратный apply.

### 2.4 Изменение после восстановления

Пользователь работает в ОБЫЧНОМ Builder: удаляет WG-карточку (existing delete), добавляет строки URL в mihomoInput, жмёт существующий Build. Спец-логики «пересборки поверх» нет — задача OWNER-REVERSE-01 §0 (удалить 1 AWG, добавить 2 подписки, Build) решается штатными средствами Builder после восстановления.

## 3. Studio 2.0 UX (PHASE D, план)

Новый блок Studio «🔁 Восстановить в Builder» рядом с импортом:
1. **Импорт**: `[ config.yaml ]` / `[ проект генератора (.lgproject.json) ]`.
2. **Отчёт**: counts (подписки/WG/прямые/политики) + recoverability-классы.
3. **Предпросмотр**: редактируемые списки источников (URL-подписки: добавить/удалить/заменить; WG/AWG: удалить/править поля/заменить файлом/таргет; настройки).
4. **«Восстановить Builder»**: apply через Adapter + переход на вкладку Builder; подтверждение при непустом текущем Builder (без перезаписи молча).
5. **Сравнение** (было/стало/неизвестно) — из findings до apply.

Старый source-preserving редактор остаётся как режим «Расширенное редактирование YAML» (не удаляется — контракт задания §PHASE D).

## 4. Секреты (PHASE E, политика)

- Приватная модель: значения секретов хранятся в памяти вкладки/проекта в restored-модели и wgBeans; masked input по умолчанию; кнопка показать/скрыть; замена значения — явная.
- Build сохраняет оригинальные значения (bean уже так работает — следствие EXACT-класса секретов).
- Запреты остаются: нет секретов в логах/статусах/diff/отчётах/csRedactText-выводах; нет localStorage для проекта/секретов; экспорт проекта — только по явному действию с предупреждением о конфиденциальности.
- Никакой самодельной криптографии; шифрованный экспорт (если будет) — только WebCrypto-стандарты (отдельное решение).

## 5. План поставки (PR-цепочка)

| PR | Содержимое | Гейт |
|---|---|---|
| A | Research: recoverability map + архитектура + формат проекта + synthetic fixtures анализа | этот PR |
| B | Project export/import + roundtrip parity (semantic + byte для детерминированных fixtures) | CI green + регрессии |
| C | Recoverability Analyzer (pure) + тесты маркеров | CI green |
| D | Studio 2.0 UX (restore flow, предпросмотр, apply/undo, сравнение) + секретная политика (reveal/edit) | CI green + browser-сюиты |
| E | E2E по PHASE F сценариям + mobile/a11y + docs (GUIDE/CONFIG-STUDIO/CHANGELOG) | CI green + полный regression |

Неготовые части остаются открытыми PR, а не объявляются готовыми (задание §PHASE I). Production-мерж — по общим правилам main; release — только OWNER GO.
