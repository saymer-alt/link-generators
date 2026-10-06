# Release Field Test — Owner Acceptance Checklist (v1.8.0 RC)

Authoritative human acceptance checklist для production promotion. Заполняется
владельцем (вручную, в реальном браузере и на реальном роутере) **перед**
`main → stable`. Документ переиспользуемый: для будущих версий копируется и
актуализируется; блоки, специфичные для v1.8, помечены `v1.8-specific`.

Правила:

- агент/CI **не** выставляет GO — только владелец (см. финальный gate);
- обнаруженная проблема фиксируется как blocker, **не исправляется** по ходу теста;
- реальные ключи/credentials не вставляются в этот документ, PR/issues/логи.

## 0. Release lifecycle (фактический контракт проекта)

```text
development (main)
  ↓ owner field-test (этот документ)
  ↓ owner approval (GO/NO-GO ниже)
  ↓ promotion PR main → stable
  ↓ stable CI green
  ↓ Pages production verification
  ↓ tag на production commit
  ↓ GitHub Release
```

Automated-гейт (CI) и ручной field-test дополняют друг друга: CI не покрывает
реальные подписки, роутер, трафик и UX — их проверяет этот чеклист.

## Automated gate (кратко; полный прогон — в Generator CI)

CI (зелёный на RC-коммите) покрывает: unit/browser/parity-регрессии, runtime
provenance, mihomo -t матрицу, fixture security, version badge, Routing
Diagnostics/Inspector, WG/AWG (включая 5-profile sequential regression), Policy
Routing, scalar hardening, версии Mihomo 1.19.31/1.19.32. Ручной прогон этих
проверок по чеклисту не дублируется — фиксируется только ссылка на CI run.

```text
[ ] CI run на RC-коммите зелёный (ссылка: ____________)
```

## 1. Environment header

```text
Date:            ____________
Tester:          ____________
Commit SHA:      ____________  (RC-коммит в main)
Branch:          main
Generator badge: v1.8.0-dev · MAIN
Browser/version: ____________
OS:              ____________
Mihomo version:  1.19.31 / 1.19.32
Router model:    ____________
KeeneticOS:      ____________
VPS OS:          ____________ (если используется)
```

## 2. Release candidate identity

```text
[ ] Бейдж страницы = v1.8.0-dev · MAIN (ожидаемый RC)
[ ] Протестированный commit SHA записан в header
[ ] Runtime provenance верифицирован (stacked job PASS / сборка из заявленного источника)
[ ] main snapshot artifact (Actions preview) собран и открыт без аномалий
[ ] production Pages smoke (ручной dispatch) PASS против stable
[ ] Browser hard refresh выполнен (Ctrl+Shift+R)
```

## 3. Clean browser session

```text
[ ] Свежая вкладка, без устаревшего локального состояния
[ ] Консоль без блокирующих ошибок
[ ] Ожидаемое: safe UI-настройки персистятся; WG/AWG-профили — НЕТ (см. §16)
```

## 4. Basic page smoke

```text
[ ] Страница открывается
[ ] Обе вкладки работают
[ ] Нет горизонтального overflow (desktop)
[ ] 360px: вкладки/кнопки/карточки/textarea пригодны
[ ] Версионный бейдж виден (v1.8.0-dev · MAIN)
[ ] Дефолтная вкладка — Mihomo Builder
```

## 5. Обычный статический прокси

```text
[ ] paste/import ссылки
[ ] карточка/имя корректны
[ ] Build успешен
[ ] YAML визуально осмыслен
[ ] Copy/Download работают
[ ] mihomo -t PASS (выбранная версия)
```

## 6. Subscription mode

```text
[ ] валидная HTTPS-подписка собирается
[ ] несколько подписок (если используется) работают
[ ] invalid/non-http input отвергается явно
[ ] пустой ввод при Sub-ON отвергается явно (без silent fallback)
```

## 7. Health-check URL

```text
[ ] default = https://www.gstatic.com/generate_204
[ ] Cloudflare preset применяется
[ ] другой preset применяется
[ ] валидный Custom URL применяется
[ ] невалидный Custom URL отвергается
[ ] legacy google.com production fallback отсутствует
```

## 8. Policy Routing — базовые таргеты

```text
[ ] SELECT
[ ] GLOBAL
[ ] DIRECT
[ ] REJECT
```

Минимум одна политика. Acceptance: RULE-SET корректен, таргет корректен,
Inspector видит правило, Preview объясняет путь.

## 9. Direct — свои домены

```text
[ ] домен/поддомен → DIRECT правило
[ ] CIDR (если используется) → IP-CIDR,no-resolve
[ ] порядок правил корректен
[ ] Inspector показывает DIRECT
```

## 10. Duplicate / Shadow diagnostics

Создать намеренный конфликт (одинаковый домен, более общий suffix выше частного):

```text
[ ] Duplicate Detector реагирует
[ ] Shadow Analyzer реагирует
[ ] формулировка понятна
[ ] поведение Build ожидаемое (порядок решает)
[ ] конфликт после теста удалён
```

## 11. Rule Provider Explorer

```text
[ ] инвентарь провайдеров корректен (counts)
[ ] used/unused статусы корректны
[ ] отсутствующая ссылка (missing ref) показана
[ ] payload search работает
[ ] cap больших payload показан явно
[ ] MRS: metadata-only, без декодирования
[ ] внешних запросов нет
```

## 12. Human-readable Routing Preview

Конфиг с несколькими policy-таргетами:

```text
[ ] порядок совпадает с правилами
[ ] путь читаем (цель → группа → лист)
[ ] DIRECT/REJECT/GLOBAL названы корректно
[ ] выдуманных путей нет
```

## 13. WG/AWG import (owner path)

Реальные профили владельца (EE/DE/FI/WARP/amnezia_for_awg или актуальный набор).
**Ключи в документ/логи не вставлять.** Загрузка строго **по одному файлу**:

```text
[ ] предыдущие профили остаются (append-модель)
[ ] карточка распознана, имя корректно
[ ] endpoint-инфо осмысленна
[ ] каждый dialer-dropdown видит N-1 других WG/AWG
[ ] self-таргет исключён
```

## 14. WG/AWG privacy

```text
[ ] приватных ключей нет в URL
[ ] нет в localStorage
[ ] нет в sessionStorage
[ ] F5 удаляет загруженные WG/AWG профили
[ ] privacy-подсказка видна у кнопки загрузки
```

## 15. WG-only + Sub-ON degraded registry

```text
[ ] Sub Mode ON, обычный ввод пуст
[ ] загружены WG/AWG-профили
[ ] dialer-dropdown ПО-ПРЕЖНЕМУ перечисляет другие WG/AWG (degraded registry)
[ ] degraded/preliminary hint виден
[ ] реальный Build отвергает отсутствие HTTP(S) подписки
      (authoritative validation не обходится)
```

## 16. WG/AWG chain

Owner path: EE → DE → FI → WARP → amnezia_for_awg (или безопасный subset):

```text
[ ] каждый таргет выбирается
[ ] self-таргет отсутствует
[ ] Build VALID
[ ] dialer-proxy на ожидаемых хопах
[ ] непредвиденного цикла нет
```

## 17. Cycle rejection

```text
[ ] EE → DE, DE → EE: Build отклонён
[ ] сообщение о circular dialer-proxy понятно
[ ] старый успешный вывод не подаётся как актуальный
[ ] после теста возвращено валидное состояние
```

## 18. IPv4-only WG/AWG (v1.8-specific)

Если контрак принят в RC (PR #112/#114 chain):

```text
[ ] dual-stack профиль: IPv4 сохранён
[ ] IPv6 interface address удалён из вывода
[ ] IPv6 AllowedIPs (::/0 и др.) удалены
[ ] IPv6 DNS литерал удалён
[ ] поля wg ipv6 в YAML нет
[ ] MTU не повышен молча
[ ] известный кейс WARP MTU=1200 + IPv6: mihomo 1.19.32 -t PASS
[ ] IPv6-only профиль: отвергнут с понятной ошибкой
```

## 19. MTU planner / chain diagnostics (v1.8-specific, diagnostics-only)

```text
[ ] imported MTU показан на карточке
[ ] chain note показана для профилей в dialer-цепочке
[ ] explicit MTU никогда не повышается
[ ] причина/уровень доверия видны
[ ] RandomTrailers/unknown overhead → WARN вместо угаданного MTU
[ ] известный WARP: imported 1200 → effective ≤ 1200
[ ] generated YAML планировщиком не меняется
```

## 20. AWG option diagnostics (v1.8-specific)

```text
[ ] PersistentKeepalive = integer сохранён
[ ] PersistentKeepalive = range (25-35): raw-факт сохранён в отчёте,
    пользователь видит WARN, поле в YAML НЕ эмитится (никакого
    свёртывания 25-35 -> 25), профиль рабочий
[ ] неизвестная AWG-опция: предупреждение (UNKNOWN), не silent drop
[ ] никакое значение ключей не печатается в диагностике
```

## 21. Mihomo 1.19.31 validation

Для RC-выводов:

```text
[ ] static PASS
[ ] subscription PASS
[ ] Policy Routing PASS
[ ] WG PASS
[ ] AWG PASS
[ ] WG/AWG chain PASS
```

## 22. Mihomo 1.19.32 validation

Те же сценарии + новые ограничения 1.19.32 (например, mipstack IPv6-MTU —
покрыт IPv4-only контрактом выше):

```text
[ ] static PASS
[ ] subscription PASS
[ ] Policy Routing PASS
[ ] WG PASS
[ ] AWG PASS
[ ] chain PASS
```

## 23. Реальный трафик (где возможно)

```text
[ ] DIRECT-трафик
[ ] GLOBAL/прокси-трафик
[ ] policy-routed домен
[ ] WG/AWG-трафик
[ ] узел подписки
```

Каждый прокси тестировать не требуется.

## 24. VPS config path (если используется)

```text
[ ] Build
[ ] конфиг сгенерирован
[ ] mihomo -t
[ ] ожидаемые TUN/DNS/listen
[ ] очевидных host-specific утечек нет
```

## 25. MagiTrickle import

```text
[ ] импорт образца (реального/synthetic)
[ ] group mapping корректен
[ ] DOMAIN-WILDCARD
[ ] IP-CIDR no-resolve
[ ] сгенерированная политика валидна
```

## 26. AUTO-WHITELIST

```text
[ ] Build
[ ] ожидаемый priority/fallback (PRIMARY→FALLBACK)
[ ] URL health checks на месте
[ ] url-test не вложен в fallback (контракт #2588)
```

## 27. Failover behavior

Только безопасный сценарий (синтетический/controlled harness). Специально
ломать реальную сеть field-test не должен.

```text
[ ] поведение соответствует контракту PRIMARY→FALLBACK
```

## 28. Copy/download artifacts

```text
[ ] Copy
[ ] Download
[ ] содержимое файла корректно
[ ] имя файла корректно
[ ] кодировка без BOM/garbling
```

## 29. Console / network privacy (DevTools)

```text
[ ] нет неожиданных внешних запросов
[ ] нет фонового provider fetch
[ ] Custom URL не браузер-фетчится (если не предусмотрено дизайном)
[ ] приватный WG материал не появляется в запросах
```

## 30. Reset / reload

```text
[ ] F5: поведение ожидаемо
[ ] safe UI-настройки персистятся ожидаемо
[ ] WG приватные конфиги исчезли
[ ] устаревший generated output не подаётся как актуальный
```

## 31. Negative validation

```text
[ ] invalid URL → ясная ошибка
[ ] bad WG endpoint → ясная ошибка
[ ] cycle → отклонение
[ ] duplicate name → отклонение
[ ] missing critical field → отклонение
[ ] ни одного крэша / silent partial build
```

## 32. Secrets

```text
[ ] генерируемые выводы/артефакты без реальных PrivateKey/PSK/HPK
[ ] без tokens/subscription credentials
[ ] приватные owner endpoints не раскрыты
```

**Напоминание: НЕ вставлять owner secrets в issue/PR/report.**

## 33. Итог release candidate

| Section | PASS | FAIL | N/A | Notes |
|---|---|---|---|---|
| §2 RC identity | | | | |
| §3 Clean session | | | | |
| §4 Basic smoke | | | | |
| §5 Static proxy | | | | |
| §6 Subscription | | | | |
| §7 Health-check | | | | |
| §8 Policy targets | | | | |
| §9 Direct домены | | | | |
| §10 Duplicate/Shadow | | | | |
| §11 Provider Explorer | | | | |
| §12 Routing Preview | | | | |
| §13 WG/AWG import | | | | |
| §14 WG privacy | | | | |
| §15 WG-only + Sub-ON | | | | |
| §16 WG chain | | | | |
| §17 Cycle rejection | | | | |
| §18 IPv4-only (v1.8) | | | | |
| §19 MTU planner (v1.8) | | | | |
| §20 AWG options (v1.8) | | | | |
| §21 Mihomo 1.19.31 | | | | |
| §22 Mihomo 1.19.32 | | | | |
| §23 Real traffic | | | | |
| §24 VPS path | | | | |
| §25 MagiTrickle | | | | |
| §26 AUTO-WHITELIST | | | | |
| §27 Failover | | | | |
| §28 Copy/download | | | | |
| §29 Console/privacy | | | | |
| §30 Reset/reload | | | | |
| §31 Negative validation | | | | |
| §32 Secrets | | | | |

```text
Critical failures:      ____________
Non-blocking issues:    ____________
Deferred issues:        ____________
```

## 34. Severity

**RELEASE BLOCKER** (примеры): crash сборки; утечка секрета; невалидный YAML;
нарушен runtime provenance; принят cycle; сломан нормальный путь пользователя;
сломана поддержка цели на 1.19.32.

**NON-BLOCKING** (примеры): формулировки; косметика макета; отсутствие
опциональной диагностики.

## 35. GO / NO-GO (только владелец)

```text
[ ] GO  — approve promotion to stable
[ ] NO-GO — возврат в development
```

Агент/CI этот выбор не делает.

## 36. Post-promotion (выполняется ПОСЛЕ owner GO)

```text
[ ] main/stable в ожидаемом соотношении
[ ] stable CI зелёный
[ ] Pages задеплоен
[ ] production URL открывается
[ ] бейдж = v1.8.0 · STABLE
[ ] один production build smoke
[ ] tag указывает на точный production commit
[ ] GitHub Release указывает на тот же tag
```

## 37. Evidence template (сохранять вне репо при необходимости)

```text
Date: ____  Commit: ____  Mihomo: ____  Result: ____
Section fails: ____  Notes: ____
```

## Связанные документы

- [DEVELOPMENT](DEVELOPMENT.md) — version/channel metadata, процесс
- [VALIDATION](VALIDATION.md) — валидатор и scalar safety
- [ROADMAP](ROADMAP.md) — отложенные пункты (auto-MTU PoC и др.)
- [TESTING](TESTING.md) — automated suite
