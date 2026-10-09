# Reverse Build Recoverability Map (OWNER-REVERSE-01, PHASE A)

Дата: 2026-10-09. Базис: main `7f62e0f` (NIGHT-MEGA-01 смержен; PR #207 — открытый v1.11 CANDIDATE, не является базисом). Версии-источники семантики: web4core `src/core/mihomo.js` (ветка `link-generators`), `index.html` buildMihomo() (строки ~9207–9470).

Evidence-метки: SOURCE-PROVEN (прочитано в коде указанных функций) / INFERRED / UNKNOWN. Словарь состояний — CONSTITUTION.md §3: `EXACT` (достоверно восстановимо), `DERIVED` (восстановимо с нормализацией), `AMBIGUOUS` (несколько исходных состояний дают один YAML), `MISSING` (информация уничтожена Build), `UNSUPPORTED` (в Builder нет представления), `CONFLICT` (восстановленные данные противоречат друг другу).

## 0. Главный вывод

**Полный обратный цикл возможен только через проектный файл (`.lgproject.json`).** Build в режиме URL-подписок (Sub Mode ON) сохраняет в YAML все входы (URL провайдеров, порядок, опции); в режиме развёрнутых подписок (Sub Mode OFF) содержимое подписок разворачивается fetch'ем, и **оригинальные URL в YAML не попадают никогда** — это принципиальная потеря, которую Reverse Build обязан показывать честно (`MISSING`), а не заполнять догадками (CONSTITUTION §3).

## 1. Прямой путь (что читает buildMihomo)

```text
Builder UI
  ├─ mihomoInput (ссылки/URL, порядок значим)
  ├─ whitelistInput (только при cfgAutoWhitelist; разворачивается fetch'ем)
  ├─ cfgSubMode, excludeFilterInput + server-list выбор, deviceModelInput + deviceHwid
  ├─ wgProfiles[]: {id, filename, bean (parseWireGuardConf), mode: direct|proxy, target}
  │   └─ wgEngineBeans() = applyAwgStabilityPolicy(wgProfileBuildBean(p)) — dialerProxy в клоне
  ├─ wgCustomDns (общее поле DNS всех WG), cfgAwgKeepalive/cfgAwgRtDiag
  ├─ cfgTun/cfgSocks/cfgTunMips/cfgTunStackAdvanced/cfgTunStackEx/cfgPerProxy{Master,Tun,Socks}
  ├─ cfgProfile (router|vps-local|vps-gateway), cfgLan, cfgAutoWhitelist
  ├─ cfgWebUI + webUiSelect + webUiCustomUrl
  ├─ pingSelect/pingCustomUrl (urlTest), realityModernInput
  ├─ cfgPolicyRouting + policy-cards (collectPolicyRouting: {name, domains, target})
  ├─ cfgTieredFailover + tier-cards (readTierCards: {name, strategy, members})
  ├─ wgDialerInput/wgDialerMembers/wgDialerProviders (dialer-ГРУППА)
  └─ options → web4core.buildFromRequest → пост-патчи (injectWgDns → applyProviderDialerTargets
      → applyTieredFailover → applyDeploymentProfile(vps) → allow-lan → vps-controller-bind)
```

## 2. Обратная карта по полям

### 2.1 Источники

| Builder-поле | YAML-след | Обратимость | Обоснование |
|---|---|---|---|
| Подписки (Sub ON): URL список | `proxy-providers.<name>.url`, порядок ключей = порядок ввода | **EXACT** | computeProviderName — детерминированная функция (hostname→sanitize→дедуп `-N`, SOURCE-PROVEN mihomo.js:42); порядок объектов сохраняется при emite |
| Имена провайдеров | ключи `proxy-providers` | **DERIVED-EXACT** | восстанавливаются пересчётом из URL+порядка; при ручной правке имени в YAML — CONFLICT-детект (пересчёт ≠ факт) |
| Подписки (Sub OFF): URL | **нет следа** | **MISSING** | разворачивание делает inspectSubscriptionInput(expand) — в YAML только развёрнутые узлы; C2-кейс задания: «Источник: UNKNOWN / URL: NOT RECOVERABLE» |
| Развёрнутые узлы (Sub OFF) | `proxies[]` | **EXACT** (как узлы) | каждый узел — самостоятельный объект Builder (строка ссылки); grouping в «бывшие подписки» запрещён |
| whitelistInput (AWL) | узлы с префиксами `PRIMARY-N: `/`FALLBACK-N: `, провайдеры `primary-*`/`fallback-*` с additional-prefix, GLOBAL→fallback c фильтром `^(PRIMARY-…` | **EXACT** как узлы / **MISSING** как URL | маркер режима AWL SOURCE-PROVEN (mihomo.js:893–922); URL fallback-подписок развёрнуты fetch'ем — как Sub OFF |
| mihomoInput: прямые ссылки | `proxies[]` | **EXACT** | ссылки парсятся в узлы 1:1 (vless/ss/…, ссылки-строки восстанавливаются линком-сериализатором web4core или из полей) |
| deviceModelInput | provider `header` (device-model?) / x-hwid | **PARTIAL** | x-hwid — случайный 32-hex на сборку (identity не несёт); device-model — отдельная опция подписки, след в header проверяется; отсутствие следа → MISSING без догадок |

### 2.2 WG/AWG-профили

| Builder-поле | YAML-след | Обратимость | Обоснование |
|---|---|---|---|
| bean (PrivateKey, Endpoint, Address, MTU, keepalive, peers, AWG H1–H4/S1–S4) | wireguard-outbound `proxies[]` | **EXACT** | генератор эмитит ВСЕ поля bean, включая приватные ключи; обратный bean = поля узла; совместимость с wgProfiles — прямой структурой |
| WG vs AWG различение | `amnezia-optimization`/H/S-поля наличие | **EXACT** | AWG-поля присутствуют ⟺ AWG (по фактическим признакам, не угадывание); чистый WG без них |
| filename (.conf) | **нет следа** | **MISSING** | UI обязан показать «RECOVERED_FROM_YAML / Original filename: UNKNOWN / formatting: NOT RECOVERABLE» (C3) |
| mode='proxy' + target | `dialer-proxy: <target>` на узле | **EXACT** | значение таргета в YAML байт-в-байт |
| mode='direct' | нет `dialer-proxy` | **EXACT** | отсутствие следа = direct (генератор не эмитит dialer-proxy для direct) |
| wgCustomDns (общее поле) | `dns` + `remote-dns-resolve` на WG-узлах | **DERIVED** | поле общее для всех профилей; восстанавливается как одно значение (разные dns на узлах = ручная правка → CONFLICT-флаг) |
| cfgAwgKeepalive | persistent-keepalive в bean/узлах | **DERIVED** | значение в YAML; факт «override был включён» vs «значение из .conf» — AMBIGUOUS (восстанавливаем как override-значение) |
| cfgAwgRtDiag | **нет следа** (UI-only WARN) | **MISSING** (не влияет на YAML) | восстанавливается в default OFF — поведение эквивалентно |

### 2.3 Опции и режимы

| Builder-поле | YAML-след | Обратимость | Обоснование |
|---|---|---|---|
| cfgProfile | router: нет спец-следа; vps-local: no-TUN+socks+controller 127.0.0.1; vps-gateway: TUN(auto-route:false, dns-hijack, sniffer, store-fake-ip)+controller 127.0.0.1 | **DERIVED** | маркеры профилей детерминированы (applyDeploymentProfile); router = отсутствие VPS-маркеров — вывод по умолчанию, помечается как вывод |
| cfgTun | секция `tun:` | **EXACT** | |
| cfgTunMips | `stack: mips` | **EXACT** | gvisor/system — значения cfgTunStackEx; advanced-cover OFF + mips OFF → gvisor (default) — AMBIGUOUS только «default не трогали vs сбросили» — поведение эквивалентно, помечаем DERIVED |
| cfgSocks | `mixed-port`/listeners | **EXACT** | |
| cfgPerProxy{Master,Tun,Socks} | per-proxy TUN/listeners следы | **EXACT** (факт) / режим Master — DERIVED | router-only контракт и несовместимость с AWL известны |
| cfgLan | `allow-lan: true` + `bind-address: "*"` | **EXACT** | пост-патч детерминирован; router-only |
| cfgAutoWhitelist | AWL-маркеры (см. 2.1) | **EXACT** | |
| cfgWebUI + выбор дашборда | `external-ui` + `external-ui-url` | **EXACT** | кастомный URL байт-в-байт; известный дашборд сопоставляется с пресетом (AMBIGUOUS только custom-vs-preset при совпадении URL — эквивалентно) |
| pingSelect/pingCustomUrl | `url` в url-test группах / health-check | **EXACT** URL / **DERIVED** пресет | пресет восстанавливается если URL совпал с известным списком, иначе custom |
| excludeFilterInput (+server-list выбор) | `exclude-filter` провайдеров (Sub ON) | **DERIVED** | восстанавливается суммарное выражение в ручное поле (нормализация: split ручное×выбор не различима — AMBIGUOUS, поведение эквивалентно); Sub OFF: фильтр применён при разворачивании — в YAML отсутствует → виден только по отсутствию отфильтрованных узлов → MISSING (факт фильтра) |
| realityModernInput | `support-x25519mlkem768: true` на REALITY-узлах + provider override-expr | **DERIVED-EXACT** | хосты восстанавливаются из помеченных узлов (server:port); полный исходный список, включая не совпавшие узлы, — AMBIGUOUS |
| cfgPolicyRouting + карточки | `rule-providers policy-<slug>` (inline payload=домены), категории-группы, RULE-SET правила | **EXACT** (name/domains/target) | структура DPR детерминирована; порядок карточек = порядок правил |
| cfgTieredFailover + карточки | группы «🪜 N <name>» (strategy/members) + корень «🪜 TIERED-AUTO» + правило MATCH | **EXACT** | канонические имена SOURCE-PROVEN (index.html:7305/7322); порядок карточек = порядок групп |
| dialer-группа (имя/members/providers) | provider-dialer select-группы (applyProviderDialerTargets) | **EXACT** | имя группы и use/members в YAML |
| Опции с byte-parity OFF (v1.11 контракт) | отсутствие патча | **EXACT** | Tiered/DRP/vps-gateway патчи применяются только при явном включении; отсутствие маркеров = OFF |

### 2.4 Классы объектов вне модели Builder (C5/UNSUPPORTED)

Произвольные ключи верхнего уровня (`tproxy-config`, кастомные `dns:`-поля, `tunnels`, `script`, `listeners` вне контракта генератора), неизвестные типы прокси, правила с неизвестными целями, `proxy-providers` с полями вне генераторного контракта (отличные interval/health-check/заголовки) — **UNSUPPORTED**: сохраняются в отдельную модель `passthrough` (см. PORTABLE-BUILDER-PROJECT.md) и показываются списком с предупреждением о риске; повторная сборка НЕ претендует на них молча (CONSTITUTION §3: raw-факт сохраняется; §8: существенная потеря = отказ от авто-перехода в Builder).

## 3. Сводка классов

- **EXACT**: подписки (Sub ON), WG/AWG beans целиком (включая секреты), dialer-таргеты профилей, DPR-карточки, Tiered-карточки, WebUI, allow-lan, TUN/stack, socks, AWL-режим, dialer-группа, WG DNS.
- **DERIVED**: имена провайдеров (пересчёт), пресеты health-check,Deployment-профиль (по маркерам), realityModern-хосты, cfgAwgKeepalive, exclude-filter (суммарно).
- **AMBIGUOUS**: split ручной×серверный exclude; «default vs сброшен» для gvisor/advanced-cover; custom-vs-preset health-check при совпадении URL; поведение эквивалентно во всех случаях — помечается, не блокирует.
- **MISSING**: URL подписок и whitelistInput в развёрнутых режимах; оригинальные имена WG-файлов; форматирование исходных .conf; deviceHwid (случайный); cfgAwgRtDiag (YAML-neutral).
- **UNSUPPORTED**: произвольные ключи/объекты вне генераторной модели (→ passthrough-модель).
- **CONFLICT**: обнаруживается на импорте (пересчитанное имя провайдера ≠ фактическое; разные dns на WG-узлах; правила, ссылающиеся на отсутствующие цели) — показывается, не чинится молча (CONSTITUTION §2).

## 4. Что из этого следует для реализации

1. Project Restore (`.lgproject.json`) — единственный путь к **EXACT-восстановлению всего**, включая MISSING-поля (URL развёрнутых подписок, имена файлов) — PHASE B.
2. YAML Reverse Build — honest mapping по §2: EXACT-поля восстанавливаются, MISSING показываются как NOT RECOVERABLE, UNSUPPORTED — в passthrough — PHASE C.
3. Никаких эвристических «подписок из развёрнутых узлов» и никакого угадывания галочек по похожим структурам (C4) — только детерминированные маркеры из §2.
