# UX Architecture 2.0

## Baseline и архитектурное решение

Baseline main: `89a046519b3492c450a4a0cf05f9fb4fbaf0c8c0`. UI-only scope; runtime/CDG/YAML generation не меняются. Сначала проектирование, затем три проверяемых изменения: организация разделов, рабочая область графа, runtime-список.

Раньше Builder объединял почти все инструменты в одной карточке «Настройки Mihomo»; диагностика была вложена в DPR, Physical Topology соседствовала с обычным TUN, Build находился после инженерных панелей. WARP и Config Studio — самостоятельные рабочие вкладки, сохраняются.

Первая версия: пять реальных областей Builder с компактными якорями и каталогом инструментов. Быстрый старт расположен первым и заканчивается Build/YAML. Остальные области идут после результата. Навигация открывает нужную существующую панель, переводит фокус и прокручивает к ней; не строит конфигурацию и не отправляет запросы. Единственный экземпляр каждого поля, прежние ID/event bindings и DOM внутри динамических карточек сохраняются. Формы остаются внутри tab-mihomo для project snapshot/fingerprint.

| Область | Функции и зависимости |
|---|---|
| Быстрый старт | Deployment profile; основной ввод proxy/URL; WG/AWG import/list; основные LAN/Mixed/WebUI/SubMode/TUN/MIPS; Build, Copy, Save/Load, YAML, validation/compatibility. Профиль продолжает менять прежние scenario options только по явному выбору. |
| Маршрутизация и DNS | AWL primary/fallback; subscription preview/выбор/Exclude Filter/device identity; runtime node import остаётся рядом с общей reconciliation/filter моделью; DPR/MagiTrickle и Tiered; WG DNS/AWG policies/manual dialer. DNS gateway controls остаются при выбранном gateway profile, поскольку lifecycle зависит от него. |
| Диагностика и визуализация | Inspector, Rule Provider Explorer, Coverage, Builder graph; переход в отдельную Config Studio для анализа/редактирования/DNS audit; ссылка на доступную validation. Диагностика больше не требует раскрытия DPR. Static Build ≠ runtime packet path. |
| Инженерная лаборатория | Physical Topology, What-if, per-node artifacts, Runtime Evidence. Это экспериментальная intended-модель, не обычный Build и не automatic physical failover. |
| Дополнительные параметры | Dashboard URL, health-check endpoint, selective Modern REALITY, advanced TUN/per-proxy. Контекстные предупреждения остаются при своих controls. |

Реальные зависимости изучены: checkbox parent clamps в updateMihomoOptionStates/buildMihomo, profile visibility, ID-only diagnostics, subscription reconciliation, WG-card delegated handlers, ordered policy cards, Build fingerprint и rbCollectProject/transactional restore. Переносится целая логическая группа, не её динамическое содержимое. Read-only Inspector controls остаются внутри routingDiagnostics; новый UI не добавляет build-relevant inputs.

## Уровни детализации

Простой путь: «платформа → данные → основные настройки → Build → YAML». Экспертный: явные разделы и каталог всех инструментов; редкие параметры группируются рядом с назначением. Глобальный Simple/Expert hide-toggle отложен в отдельный небольшой PR: включённые скрытые параметры продолжают менять YAML, поэтому перед внедрением нужен полный список активных overrides и постоянно доступный summary. Первая версия не скрывает активные настройки и предупреждения и не меняет значения ради режима. Это обоснованное проектирование двух уровней, а не обещание реализованного глобального переключателя.

## План проверки и ограничения

Owner Experience Gate v1.0, UX-01…09 сохраняются. Новые UX-ID: UX-10 — инженерные инструменты смешаны с первым Build; UX-11 — граф нельзя развернуть/изменить высоту; UX-12 — runtime-only label у правого края/длинные имена. Для каждого: baseline FAIL, candidate PASS, реальные browser visibility/focus/geometry checks. Chromium/Firefox/WebKit;1280×720,1366×768,1920×1080, узкие экраны и reduced-layout viewport для масштаба. Полный Generator CI, YAML byte parity, Save/Load, WG/AWG, subscription, DPR, Studio, graph, runtime reconciliation остаются обязательными.

Скрытие native details само по себе не отключает параметры. Static graph показывает только доказанные CDG-зависимости; runtime-состояние не доказывает путь пакетов. Реальные controllers/VPS/Keenetic/подписки не используются. Stable/tags/releases не изменяются. Human Owner GO даёт только владелец.

Следующее развитие: active-overrides summary для отдельного Simple/Expert PR и исследование поиска инструментов без сохранения пользовательских данных.

### Проверки первой части (навигация)

Первый CI37983702692: пять jobs PASS, browser FAIL на устаревшем требовании WebUI→DeviceModel→ExcludeFilter одной карточки. Новая проверка сохраняет DeviceModel→ExcludeFilter и явно требует routing workspace для устройства/фильтра, options workspace для dashboard. Функциональные assertions не ослаблены; исходный failure сохранён, rerun не выполнялся.

UX-10: исходный89a0465 —0/4 FAIL; candidate —4/4 PASS. Полный Owner UX suite —33/33 PASS каждый Chromium/Firefox/WebKit (включая UX-01…09). Desktop1280×720/1366×768/1920×1080, mobile320/390 и640×360 как reduced-layout viewport для200% масштаба1280px; реальное изменение browser chrome zoom не заявляется. Навигация проверяет фокус/видимость, отсутствие запросов и неизменность project/YAML/fingerprint/generation. YAML byte parity89a0465→candidate —10/10 ALL PARITY. Основной browser suite PASS, runtime63 PASS, Owner Gate registry PASS. Скриншот навигации проверен визуально. Существующие security/generation handlers не менялись; новая кнопка скачивания использует ту же VALID границу, что Copy.

### Рабочая область графа

В Builder и Config Studio кнопка «⛶ Развернуть граф» открывает граф на размер окна; Escape возвращает обычный вид и фокус кнопки. В обычном виде высота меняется ползунком «Высота» или вертикальной ручкой контейнера; «Сбросить размер» возвращает автоматическую высоту. Fit учитывает новый размер. Zoom, pan и выбор узла сохраняются; «Весь граф» снимает фокус узла. Граф показывает CDG-зависимости, не наблюдаемый путь пакетов. Текстовая версия доступна под обычным графом.

UX-11 baseline89a0465:0/2 FAIL (нет expand/height controls). Chromium/Firefox первоначально35/35 PASS; WebKit выявил ResizeObserver delivery loop и отсутствие фокуса после mouse-click (Escape не доходил до frame). ResizeObserver writes перенесены в отменяемый animation frame; expand явно фокусирует кнопку, Escape возвращает на неё. Проверки включают реальные pointer pan, keyboard,100-node Studio fixture, повторное раскрытие, mobile Fit и clear во время overlay.

### Список узлов runtime

В «Маршрутизация и DNS» включите «Показать серверы подписки», затем откройте импорт runtime. JSON можно загрузить локальным файлом. Длинные имена переносятся полностью; «ℹ только в runtime» означает отсутствие имени в browser preview, а не проверку пути пакетов. На узком экране метка переносится под имя. Список прокручивается и меняет высоту вертикальной ручкой; поиск меняет только отображение, checkbox — прежнюю модель исключений.

UX-12: исходный89a0465 —0/1 FAIL (нет внутреннего отступа); candidate —1/1 PASS. Реальный file chooser импортирует46 узлов с длинным именем; проверяются геометрия/перенос/scroll на1280/1366/1920/320/390/640px, поиск/checkbox и неизменность имён, происхождения, выбора и YAML при изменении размеров. Semantics reconciliation/Exclude Filter не менялись.

### Итог локальной проверки трёх частей

Owner UX Chromium/Firefox/WebKit:36/36 PASS каждый; UX-01…09 сохранены. Firefox scroll assertion ожидает завершение browser scroll update. YAML parity:10/10 byte-identical против89a0465; runtime63/63; runtime import18/18; subscription preview17/17; основной browser suite PASS; final-release-browser journey и72 layout checks PASS; Owner Gate registry PASS. Скриншоты графа и списка проверены визуально. Машиночитаемые результаты: [evidence/ux-architecture-2.json](evidence/ux-architecture-2.json).

PR: [230](https://github.com/saymer-alt/link-generators/pull/230) — навигация; [232](https://github.com/saymer-alt/link-generators/pull/232) — граф. Финальная интеграция требует green exact-head CI каждого PR и main; фактические SHA/CI фиксируются в handoff. Успех автоматических fixtures не заменяет ручную Owner acceptance и не доказывает real-network поведение.
Review correction: Escape сохраняет текущий pan развёрнутой области; фактическое перетаскивание/обычная прокрутка снимают auto-Fit, чтобы resize не сбрасывал позицию. Browser UX-11 проверяет pan внутри expanded, затем точные offsets после Escape. Справка графа размещена внутри светлого wrapper quick-start.

Каталог инструментов открывает runtime importer независимо от checkbox просмотра подписок: только раскрытие контейнера, без запроса, Build или изменения cfgServerList.

### Инвентаризация и границы видимости

Основные сценарии: WARP links; новый Builder из proxy/URL/WG/AWG; deployment profiles; ordered policy routing и Tiered; subscription/runtime reconciliation и исключения; диагностика статического Build; импорт/редактирование/экспорт Studio; экспериментальная topology/evidence; Save/Load проекта. Частые действия заканчиваются YAML в Quick Start. DNS audit, coverage и provider explorer объясняют уже созданный документ. Runtime importer читает имена, topology/evidence моделируют отдельный экспериментальный workflow.

Дублированные независимые формы не создаются. Builder и Studio намеренно сохраняют отдельные input/document lifecycle; они не взаимозаменяемы. Каталог содержит ссылки на существующие controls. Validation/ошибки Build/STALE/compatibility, предупреждения о secret/controller/CORS, ограничениях AWG/MIPS и активных исключениях остаются в исходных функциональных блоках. Навигация не скрывает ошибку результата и не отменяет активную настройку.

Названия пяти областей и короткие вводные объясняют назначение инструментов; технические названия сохранены для сопоставления с Mihomo. Дальнейший hide-mode требует списка активных overrides и проверок предупреждений во всех режимах. CSS resize не является фактическим browser chrome zoom; проверен reduced layout. Реальные URL/controllers не использовались.

Review-corrected product81424e9: полный Owner UX suite36/36 PASS каждый Chromium/Firefox/WebKit. Runtime import18/18 PASS повторно; origin-entry comparison UX-12 PASS. Снимок mobile390px подтверждает перенос badge под длинным именем, внутреннее поле справа и вертикальную ручку. PR runtime list: [233](https://github.com/saymer-alt/link-generators/pull/233).

## Дополнение Owner UX 2.1

Пять областей и их канонические controls сохранены. AWL следует сразу за профилем в Быстром старте; резервный ввод и просмотр подписок находятся рядом с основным вводом. Общие действия вынесены над навигацией в компактную sticky-панель; на мобильном навигация прокручивается, действия остаются доступны. Graph/Inspector используют текстовый fallback для лестницы только при отображении. Лаборатория сохраняет отдельную модель и видимые ограничения evidence.
