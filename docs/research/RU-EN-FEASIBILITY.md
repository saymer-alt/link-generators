# RU/EN: аудит и план реализации (#265 / #268)

Дата первоначального аудита: 13.10.2026. База: `4b0113627f0a9b86b9692cdb127a337401624b8e`.

> **Решение владельца 31.10.2026 — следующий цикл разработки:** реализовать RU/EN небольшим локальным слоем словарей поверх существующих `index.html` / JavaScript, без смены технологического стека, без отдельного сервера и без новых сетевых запросов. RU остаётся по умолчанию. Реализацию делать при **следующем функциональном обновлении после приёмки текущего кандидата v1.12.0**, возможные версии v1.12.1/v1.13; номер уточнить при планировании. [Каноническая задача и acceptance #265](https://github.com/saymer-alt/link-generators/issues/265).
>
> Это **owner GO на метод и приоритет планирования, а не на автоматический релиз/производственный деплой**. Текущий `stable` и v1.12.0 RC не менять ради локализации. Полный английский интерфейс ещё не реализован. Исторические цифры ниже — оценка объёма ручной работы, а не доказательство, что потребуется новый фреймворк или сервер.

## Owner-approved implementation — simplest useful approach (31.10.2026)

**Цель:** один и тот же генератор и одна и та же модель конфигурации работают на русском и английском. Меняется только presentation layer: надписи, подсказки, сообщения, `aria-label`, `placeholder`, `title`, инструкции. **Не** меняются YAML/API/URL/UUID/HWID/regex, proxy/group identifiers, build fingerprint, secrets, state/Undo и поведение сети.

**Минимальная схема:**
- Использовать локальный classic script (совместимый с `file://`) с двумя словарями `ru` и `en` и одной функцией `t(key, params)`. Ключи семантические, например `builder.build`, а не поиск русских фраз по DOM.
- Статические элементы обновлять по `data-i18n` или небольшой явной DOM-таблице; динамический UI и notifications рендерить из ключей/параметров. Не делать массовый перевод `innerHTML`, обход всего документа с `replace`, не подключать React/Vue, i18next/CDN, новый backend или heavy build system только ради двух языков.
- Добавить переключатель `Русский | English` (RU default), синхронизацию `html lang` и accessibility attributes. Допустимо хранить только код `ru|en` в отдельном versioned localStorage key с memory fallback; никак не объединять это с реестром HWID или проектом.
- Не пересоздавать inputs, textarea и stateful карточки при переключении. Изменять текст/доступные подписи существующих элементов, переотрисовывать только безопасные presentation fragments. Для rich help использовать DOM-node constructors и `textContent`, не HTML от переводчика.
- Для внешних неструктурированных ошибок локализовать **обрамляющую** UI-ошибку и отдельно показывать безопасную техническую деталь без опасной regex-замены внутри exception.
- Использовать уже выполненный `I18N-INVENTORY.json` и `i18n-inventory.cjs`, но **обновить инвентарь на актуальном main** — после октября появились новые UI тексты; инвентарь содержит кандидаты, не готовые ключи.

**Порядок самостоятельных PR:** (1) foundation/словарь/переключатель RU default и тест без потери формы; (2) Mihomo Builder/подписки/HWID/AWL/Tiered/DPR; (3) Config Studio/portable projects/Physical Topology/VRG; (4) WARP/quick-start/help; (5) coverage и совместимость. Нельзя выдавать промежуточные PR за `EN complete`.

**Обязательная приёмка:** browser RU→EN→RU, реальные dynamic ошибки/toasts/dialogs/ARIA, layouts 320/390/768/1366/Firefox zoom, сохранение input/textarea/secret/Studio dirty+Undo/v1/v2 identity, побайтовое равенство Build/YAML/project output и отсутствие лишних network requests; key parity, XSS/privacy checks и сохранение ранее зелёного CI/Mihomo. Если затронута логика маршрутизации или формат конфигурации — STOP: это не часть перевода.

**Цена/риски:** написание переводов относительно механическое, но покрытие динамического UI, терминология и cross-browser тесты требуют внимательной работы. Оценку 80–140 человеко-часов из первоначального аудита нельзя превращать в обязательную оценку времени Z AI.

---

**Исторический research-only baseline (13.10.2026):** исходный аудит предлагал v1.12 как кандидат; новая договорённость выше определяет фактический приоритет следующего цикла. Код и `stable` не менялись этим документом.

## Измерение

В `I18N-INVENTORY.json` — координаты и исходные тексты кандидатов, а не готовый
словарь. Воспроизведение: распаковать внешний npm-пакет `acorn@8.15.0`, задать
`ACORN_PATH` на его каталог, выполнить из корня `node docs/research/i18n-inventory.cjs`.
Зависимость не добавляется приложению. Acorn tokenizer исключает JS-комментарии;
HTML text/атрибуты считаются отдельно, script/style/comments исключены из HTML.

| Измерение | index.html | quick-start.html |
|---|---:|---:|
| Строки файла | 11655 | 316 |
| Байты | 789892 | 46376 |
| Все JS string tokens | 6942 | 0 |
| Все JS template chunks | 53 | 0 |
| Кириллические HTML text fragments | 338 | 172 |
| Кириллические placeholder / aria-label / title | 18 / 31 / 7 | 0 |
| Кириллические JS strings / template chunks | 1219 / 9 | 0 |

Всего **1794 вхождения / 1641 уникальный текст**. Это воспроизводимая нижняя
граница объёма классификации: английские подписи уже существуют, runtime errors
приходят извне, отдельные fragments образуют одно сообщение, технические строки
с кириллицей могут быть именами групп/комментариями YAML. Нельзя считать каждое
вхождение отдельным ключом или обещать 100% покрытия по этому счётчику.
HTML entities и concatenation требуют ручной нормализации. Inline onclick и
сторонние parser messages требуют отдельного прохода. Hidden experimental PT
входит в source inventory, но не в обязательный публичный GUI.

`rg` по текущему index: 6 строк содержат innerHTML (одна — комментарий),
328 строк — присваивание textContent, 71 строка — showToast call/declaration.
Это число строк совпадения, не AST call sites и не число сообщений.
Общего словаря, data-i18n, language control и navigator.language policy нет.
`lang="ru"` статический. Есть toLocaleTimeString в runtime/PT и locale-sensitive
поиск VRG: локаль отображения нельзя смешивать с matching доменов/идентификаторов.

## Обязательное покрытие источников

| Область | Что переводить | Особые риски |
|---|---|---|
| WARP MASQUE | import selectors, ambiguity/identity errors, endpoint help, outputs/actions | ключи и готовые URI не трогать; label ≠ значение |
| Builder | профили, основные/fallback источники, AWL/Tiered/DPR, DNS/TUN, WG/AWG cards, health-check, device identity, warnings | имена групп, filename, targets и registry IDs имеют смысл в YAML |
| Runtime importer / preview | controls, progress, partial/errors, reconciliation, HTTP/PNA/CORS пояснения | endpoint/secret/raw response не переводить и не интерполировать в HTML |
| Config Studio | bounded import, validation, rule probe/trace, diff, Undo/Reset, providers/editor, dialogs, export | source-preserving YAML и секреты неизменны; сначала redact, потом display |
| Project / Reverse | preview, confirmation, counts, conflict categories, stale/VALID guards | schema/keys/EXACT и другие машинные категории стабильны; переводить подпись |
| Routing / VRG | node kind/status labels, details, search, fullscreen, keyboard text, empty/unknown states | canonical graph IDs/edges и fingerprints не зависят от языка |
| Общий UI | tabs, footer/badge labels, ARIA, title, placeholder, tooltips, confirm/prompt/toast, loading/empty/error | native dialogs тоже входят в покрытие; language switch не remount формы |
| quick-start | весь видимый текст, заголовки, навигация и help | страница остаётся читаемой без JS; не превращать её в raw Markdown |

README/GENERATOR-GUIDE, DATAFLOW, PROTOCOLS, MIHOMO, VALIDATION, TESTING и SECURITY
нужны пользователям, но могут переводиться отдельным документационным PR.
AGENTS, research/history и CI logs не обязательны для английского GUI. В Pages
есть index, quick-start и Google verification HTML; verification не переводить.
Не восстанавливать удалённую mihomo.html. Инструкции, связанные из UI, должны
явно указывать доступный язык, пока английская версия не готова.

## Архитектура и безопасность

1. Локальный classic script словаря (совместимость file://), без CDN/нового fetch.
   Стабильные semantic keys `studio.import.tooLarge`, `builder.subMode.help`;
   словарь RU/EN с одинаковыми ключами. Не делать replace всех русских строк
   в document.body и не переводить по исходному тексту.
2. `t(key, params)` возвращает текст; DOM — textContent/createTextNode, attributes
   через allowlist setters. Для форматирования rich help собирать безопасные узлы
   b/code/a; URL links заданы кодом. Не отдавать translator HTML/handlers.
3. В renderMihomoValidationBox (`innerHTML` ~3311) validationIssueHtml уже
   экранирует payload; renderCompatSummary (~3419) использует escapeHtml.
   Нельзя удалить экранирование ради переводимого HTML. Очистки out/box/objSel
   через innerHTML='' не являются переводами. showToast уже выводит textContent.
   Новых подтверждённых XSS здесь аудит не заявляет; риск — будущая регрессия.
4. Dynamic renderers получают presentation locale, но не меняют модель.
   Не пересоздавать input/textarea/file nodes, WG beans, selections, dirty Studio,
   отменённые операции/Undo stack. Обновлять только подписи/атрибуты и rendered
   статус по сохранённым code+params. Для runtime/source errors — wrapper code
   плюс безопасный исходный diagnostic, не перевод regex/заменой внутри exception.
5. Default RU; явный dropdown `Русский / English`, без автоопределения по IP.
   document.documentElement.lang + aria-label/title/placeholders обновляются вместе.
   Optional localStorage хранит только enum ru/en в отдельном versioned key,
   try/catch + memory fallback; без cookies/telemetry и изменения HWID registry.
   Язык не включать в project, YAML или build fingerprint. Privacy/dataflow doc
   обновить в foundation PR до добавления persistence.
6. Plural — Intl.PluralRules или явные формы; даты/числа — display locale.
   Не менять YAML/API keys, URL schemes, proxy IDs/names, domains, regex,
   config blobs, secrets, generated group names и download payloads. Разделить
   машинную категорию и её подпись; source text/redaction не зависит от языка.

## Оценка труда (один разработчик, review отдельными итерациями)

| Этап | Человеко-часы | Итерации / PR | Предпосылки |
|---|---:|---:|---|
| Завершение классификации + инфраструктура i18n | 16–28 | 1–2 | source inventory уже есть; API и privacy согласованы |
| Полный UI RU↔EN, включая динамику/error/ARIA | 40–72 | 3–5 | перевод и терминология проверяются вручную; без нового redesign |
| Help/документация + полная QA | 24–40 | 2–3 | 3 движка, desktop/mobile, native Firefox zoom и owner review |

Итого **80–140 часов**, примерно 2–4 рабочих недели одного исполнителя с
review/исправлениями, не обещание календарной даты. Ошибки в shared runtime,
изменение scope документации или новые UX PR увеличат оценку. Нижняя граница
предполагает reuse renderers и отсутствие изменений parser/generation.

## Последовательность отдельных PR

1. Foundation: dictionary/API, key parity/type checks, safe node formatting,
   language control RU default, lang/ARIA policy, privacy, сохранение формы;
   не представлять этот промежуточный PR готовой English версией.
2. Builder: profiles/options/DNS/AWL/Tiered/DPR/WG/runtime/preview, alerts.
3. Studio + Project/Reverse + VRG: code-based messages, diff/trace/redaction,
   dirty state/Undo/canonical graph сохранность.
4. WARP + quick-start/help + общие dialogs/footer; техническая документация
   отдельным PR, с честными language links.
5. Coverage/QA: remaining visible and dynamic strings, layout/keyboard/zoom,
   owner field smoke, только затем EN complete и minor release scope freeze.

## Тест-план и proof RU→EN→RU

Сейчас **NOT RUN / отсутствует language-switch implementation**: production
интерфейс только RU. Изменять продукт ради proof в research PR запрещено;
нижеследующий proof — acceptance spec, не выданный за выполненный тест.

- Пин input с synthetic WG/AWG secret, custom group/target, subscription URL,
  dirty Studio и Undo, VALID YAML + buildStateFingerprint + rbCollectProject
  (metadata.created нормализовать). RU→EN→RU реальными mouse/keyboard actions.
- После каждого переключения те же node identities для inputs, значения/secret,
  YAML bytes, graph IDs/edges, fingerprint и Build validity; никаких network
  requests/нового HWID/rebuild/project mutation; export roundtrip неизменен.
- lang/ARIA/placeholder/tooltips/error/empty/loading states соответствуют locale;
  trigger each inventoried message via fixture; missing key hard fail. Cyrillic
  detector только в presentation surfaces с allowlist пользовательского текста,
  не во всём DOM/YAML. Не выдавать source grep за UX coverage.
- Chromium/Firefox/WebKit 320/390/768/1366, focus/Tab/Enter/Space/Escape,
  long labels и native Firefox zoom 150–300% вручную; уменьшенный CSS viewport
  отдельно, он не доказывает native zoom.
- Injection fixtures `<img onerror>`, `${...}`, angle brackets, token URLs:
  перевод/formatting не исполняет HTML, diagnostics masked in both languages.
- CI: key parity/placeholder/plural inventory + all-browser locale suite +
  Owner Experience Gate, existing owner-ux, help, project/reverse, Studio,
  security/stress, parity, runtime provenance, Mihomo 1.19.31/32 unchanged.

## Старые #252 / #253

#252 — намеренный SOCKS-only контракт `applyProfileUiState('vps-local')` и
Build clamp. Disabled-only patch недопустим. Отложить opt-in SOCKS+TUN до v1.12
и согласования сценария; required matrix: router/local/gateway switches,
old project/Undo/Reverse/reset, DNS/routes/bind/controller, tamper, AWL/DPR/
Per-Proxy guards, default byte parity, реальные Mihomo 1.19.31/32; отдельная
WAN/routing приёмка при расширении профиля.

#253 — native outer summary отличается от статических subsection headings;
не делать nested disclosures без UX-решения. Отдельная регрессия проверяет
click/Enter/Space outer details, guards, transitions, project и YAML. Пустой
select возникает потому, что updateMihomoOptionStates сбрасывает value='',
а HTML содержит лишь system/mixed. Безопасная правка — явный placeholder
«Выберите system / mixed» без выбора за пользователя и без изменений YAML.
Независимые TUN/Per-Proxy возможности остаются v1.12/backlog.
