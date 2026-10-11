# VPS SOCKS5 — Advanced/TUN/Per-Proxy regression matrix (v1.12+)

**Статус:** тест-план (NOT RUN), без изменения текущего поведения.  
**Источник:** полевое наблюдение владельца от 11.10.2026, Issue [#253](https://github.com/saymer-alt/link-generators/issues/253).  
**Связанный контракт:** [#252](https://github.com/saymer-alt/link-generators/issues/252) — возможный opt-in TUN/MIPS в SOCKS-only профиле.  
**База:** `main` v1.11.0-dev, `index.html` (`#cfgProfile`, `#perProxyAdvancedDetails`), `tests/profile-matrix.cjs` и `docs/GENERATOR-GUIDE.md`.  
**Область:** только будущая приёмка UX/логики; `stable` v1.11.0 не изменять.

## Наблюдение и граница достоверности

При выборе профиля `vps-local` («VPS — локальный Mihomo / SOCKS для Xray / 3X-UI») владелец увидел раскрытую секцию ADVANCED и неактивные переключатели «Расширенный TUN stack» / «Отдельный вход на каждый прокси». По сообщению пользователя, соответствующие блоки не удаётся ожидаемым образом закрыть или свернуть.

На данный момент **нельзя утверждать, что нативный `<details>` не закрывается**: нужно различить клик по `#perProxyAdvancedSummary` и клики по названиям внутренних подразделов.

Код `index.html` подтверждает:
- `#perProxyAdvancedDetails` — единственный раскрываемый `details` с `summary#perProxyAdvancedSummary`.
- «Расширенный TUN stack» и «Отдельный вход на каждый прокси» — обычные `.advanced-subsection-title`, **не отдельные кнопки/summary**; самостоятельное сворачивание пока не предусмотрено.
- `vps-local` принудительно отключает `cfgTun` и `cfgTunMips` (TUN OFF), advanced TUN stack зависит от `cfgTun`; Per-Proxy master имеет router-only ограничение. UI-disabled нельзя менять без согласования реального Build-контракта.

## TEST PLAN: существующий контракт и воспроизведение

| ID | Сценарий | Ожидаемое проверяемое поведение | Статус |
|---|---|---|---|
| VPS-ADV-01 | Новый Builder: `router` → `vps-local` | `cfgTun`, `cfgTunMips`, `cfgTunStackAdvanced`, `cfgPerProxyMaster` disabled, TUN/MIPS OFF; Sub Mode/обычные источники не сброшены | TODO browser assertions |
| VPS-ADV-02 | `vps-local`: открыть/закрыть `#perProxyAdvancedSummary` мышью дважды | `details.open` меняется `false→true→false`; содержимое скрыто при закрытии независимо от disabled-детей | FIELD REPRO REQUIRED |
| VPS-ADV-03 | То же с клавиатуры: Tab/Enter и Tab/Space | Фокус виден; `details.open` переключается в обе стороны; disabled controls не перехватывают событие | TODO browser |
| VPS-ADV-04 | Клик на «Расширенный TUN stack» или «Отдельный вход на каждый прокси» | Сейчас внутренние заголовки **не являются** toggles. При принятии UX-решения: либо сделать реальные отдельные disclosure с ARIA/клавиатурой, либо понятно указать, что сворачивается только ADVANCED; протестировать выбранный контракт | NEEDS UX DECISION |
| VPS-ADV-05 | Последовательность `router→vps-local→vps-gateway→router` с открытым/закрытым ADVANCED | Профиль не подменяется, `details` управляется пользователем, профильные настройки/данные router сохраняются | TODO browser |
| VPS-ADV-06 | Выключить TUN в допустимом профиле | MIPS и advanced system/mixed недоступны и не попадают в итоговый YAML; неверное состояние DOM принудительно исправляется/отклоняется Build | TODO browser + core |
| VPS-ADV-07 | `vps-local`, обычный Build с синтетическим VLESS | Получен VALID YAML без TUN, без несогласованных per-proxy listeners; ручное открытие/закрытие ADVANCED не изменяет YAML/fingerprint | TODO browser + mihomo -t |
| VPS-ADV-08 | Включить через DOM/DevTools запрещённые `cfgTun`, `cfgTunMips`, `cfgPerProxyMaster` | Build сохраняет текущий профильный fail-safe; обход disabled через DOM не включает скрытые listeners и не создаёт ложный TUN | TODO browser |
| VPS-ADV-09 | Save/Load проекта; Reset; Undo и Reverse; переход между профилями | Нет silent-применения запрещённых флагов, stale checked/disabled; старый `.lgproject.json` восстанавливается без потери данных | TODO browser |
| VPS-ADV-10 | Chromium / Firefox / WebKit на 320/390/768/1366 px; zoom 100/200% вручную | Summary доступен, без наложения, закрытое содержимое недоступно для Tab; подсказки про ограничения читаемы | TODO cross-browser / manual zoom |
| VPS-ADV-11 | Будущий opt-in SOCKS+TUN из #252, если одобрен | Старый `vps-local` по умолчанию byte-identical. Тот же профиль с явным TUN ON осмысленно включает MIPS/gVisor/system/mixed; `mihomo -t` 1.19.31 и 1.19.32 + безопасные DNS/route boundaries | BLOCKED BY #252 |
| VPS-ADV-12 | Перед выпуском каждой исправленной ошибки | Сначала **RED** на исходной версии (воспроизводится ошибка), затем **GREEN** на исправленной, suite подключена к Generator CI, полный CI/browser/real-core матрицы PASS | PROCESS REQUIREMENT |

## Варианты локальной ручной проверки

1. Открыть **dev main** через локальный HTTP-сервер с пустым/синтетическим проектом. Не использовать личные WG-ключи/подписки.
2. Builder → выбрать VPS — локальный Mihomo / SOCKS. Открыть «⚙ Дополнительно» → «🔧 Расширенные входы и TUN».
3. Нажать именно на заголовок **ADVANCED → Расширенные настройки**; проверить открытие/закрытие, затем повторить клавишами Enter и Space. Отдельно нажать внутренние заголовки — сейчас это статические подписи.
4. Записать `details.open` (через DevTools только read-only), activeElement, disabled состояний TUN/MIPS/advanced/Per-Proxy. Если summary не сворачивает, сохранить точные шаги и браузер.
5. Сменить профиль `vps-gateway` → `router` → `vps-local`, повторить шаги 3–4. Сравнить прежний Build/YAML до и после раскрытия.
6. При будущем исправлении: перенести таблицу в *выполняемые* Playwright-assertions в `tests/profile-matrix.cjs` или отдельную `tests/*.cjs` suite. Любой новый `tests/*.cjs` обязательно зарегистрировать в `.github/workflows/generator-ci.yml`.

## Политика тестов на будущее

Каждый исправляемый UI-баг получает воспроизводимый тест, который **падает до изменения кода и проходит после**. В тестах нужны также негативные случаи, безопасность DOM-tamper, переходы между профилями и cross-browser, где это влияет на работу. Нельзя подменять поведенческий тест проверкой только наличия HTML/строк в коде. Полевые браузерные утверждения не помечать PASS, пока они реально не выполнялись.

**На дату добавления файла:** это спецификация тестирования, **не выполненные автоматические тесты**. Никакого изменения функциональности, production `stable`, TUN/MIPS defaults, web4core, ключей или тестовых устройств.
