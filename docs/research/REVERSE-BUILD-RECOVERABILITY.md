# Reverse Build: фактическая карта обратимости

Проверено 2026-10-09, main после #218 (`00c4c334`). Эта карта заменяет проектные обещания PHASE A. Источник: `index.html`, `rbYamlToProject`, `rbWgProxyToBean`, `rbCollectProject`, `rbWriteProject`.

## Две разные гарантии

`.lgproject.json` сохраняет поддерживаемое состояние Builder: исходный текст источников, WG/AWG beans и имена файлов, опции, выбранные серверы, dialer, DPR/Tiered и passthrough. Это предпочтительный путь продолжения работы; это не снимок работающего Mihomo, UI-фокуса или всех состояний вкладки.

YAML Reverse восстанавливает только доступные признаки. **Новый Build генерирует конфигурацию по модели Builder; произвольные исходные правила, группы и вложенные настройки автоматически не накладываются.** EXACT finding отдельного WG-узла не доказывает parity всего документа.

## Реализованная карта

| Область | Что делает код | Ограничение / статус |
|---|---|---|
| HTTP proxy-providers | URL в порядке ключей → mainInput, Sub ON; имя пересчитывается | Изменённое имя → CONFLICT; произвольные provider headers/intervals не восстанавливаются |
| Sub OFF / AWL fallback | Исходные URL неизвестны | MISSING; не выдумываются по узлам |
| Прямые не-WG узлы | Passthrough `proxies:direct` и исходная модель | UNSUPPORTED: link-emitter отсутствует, новый Build их не переносит |
| WG/AWG | Из известных outbound полей восстанавливаются bean, mode и dialer target | Ключи функциональны; filename UNKNOWN, форматирование NOT RECOVERABLE; raw keepalive-диапазон может быть потерян |
| WG DNS | Одно согласованное значение → общее поле | Разные значения → CONFLICT; точность неизвестных вложенных полей не обещается |
| Deployment | Gateway: TUN enable + auto-route:false + loopback controller; прежний DNS marker также поддержан. Local: нет enabled TUN + loopback controller | DERIVED; похожий произвольный YAML не доказывает намерение владельца |
| Gateway device / MTU / DNS | Переносятся в соответствующие поля; DNS включён только при enable:true | Byte parity проверена для generated fixtures DNS OFF/ON и custom device/MTU/resolvers |
| TUN / stack / socks / allow-lan | enable:true, известный stack, порты, allow-lan | enable:false с device не включает TUN; произвольные listeners не превращаются в Per-Proxy controls |
| Dashboard | metacubexd / yacd / zashboard либо custom URL | Признаки пути не доказывают произвольное содержимое UI |
| Health check | Единый URL → preset либо `__custom__` | Несколько URL → CONFLICT |
| Exclude | Единое выражение → ручное поле | Manual/selected split неизвестен; разные выражения → CONFLICT |
| AWL | Из известных маркеров восстанавливается режим | Не восстанавливает fallback URL и произвольную схему групп |
| DPR | policy-* payload/rules → карточки | Неизвестная group target нормализуется к SELECT с DERIVED finding; исходный label из slug не доказан |
| Tiered | Канонические группы `🪜 N …` и `🪜 TIERED-AUTO` → карточки | Произвольные use/filter/extra поля не обещаются |
| Dialer-группа | Не различима от иных select/use групп | UNKNOWN, восстановить вручную |
| REALITY modern list, device-model, Per-Proxy controls, AWG UI overrides | Нет полного обратного присваивания исходного пользовательского ввода | Не объявлять восстановленными; остаются defaults, исходная модель доступна как evidence |
| Неизвестные top-level и вложенные поля | Полный parsed document → `passthrough['source-config']`; отдельные неизвестные keys также сохранены | Evidence в проекте, **не merge в Build**; JSON-модель не сохраняет комментарии/исходные байты |

## Подтверждение и потери

YAML → Preview не меняет Builder. Counts, typed Compare и findings видны до Apply. Для не-EXACT findings требуется acknowledgment; CONFLICT/INVALID блокируют Apply. Изменение YAML или Builder требует нового Preview. Cancel оставляет состояние прежним; после Apply доступен Undo.

Загрузка проекта тоже требует подтверждения с counts/Compare, даже в новой сессии. Ошибка применения откатывает Builder; поздний async Build не публикуется. Passthrough переживает Collect/Save/Load/Undo, но не попадает в выходной YAML автоматически.

Для произвольного YAML используйте source-preserving редактор Studio. Экспорт без правок сохраняет исходный текст; проект YAML Reverse сохраняет parsed evidence, а не форматирование.

## Проверка

`project-roundtrip-browser`, `reverse-yaml-browser`, `qa-reverse-integration`, `independent-product-browser`, `independent-boundaries-browser`, `independent-reverse-profiles-browser`. Parity доказана для конкретных generated fixtures, включая gateway DNS OFF/ON; общая обратимость произвольного YAML — UNKNOWN. [Независимый аудит](V1.11-CODEX-INDEPENDENT-AUDIT-AND-REPAIR.md).
