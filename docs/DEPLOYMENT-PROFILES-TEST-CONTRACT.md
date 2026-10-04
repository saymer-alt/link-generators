# Deployment profiles: обязательный regression/test contract

Этот документ фиксирует **минимальный проверочный контракт** для UX-профилей Mihomo Builder и их взаимодействия с Auto-Whitelist, Per-Proxy, DPR, WireGuard/dialer и остальными независимыми настройками.

Цель — не просто «чтобы тесты были зелёными», а чтобы каждый важный эксплуатационный инвариант имел конкретную regression-проверку и было понятно, **какую поломку она предотвращает**.

Документ относится к профилям:

- `router` — «Роутер / обычный TUN (Keenetic)»;
- `vps-local` — «VPS — локальный Mihomo / SOCKS для Xray / 3X-UI»;
- `vps-gateway` — «VPS Transparent Gateway (amnezia-mihomo-gateway)».

Если код/названия профилей ещё находятся в candidate PR, тесты должны выполняться на candidate-ветке. После merge источник истины — актуальный `main`.

---

## 1. Правило интеграции параллельных веток

`main` — единственная интеграционная ветка. `stable` — только production promotion.

Параллельные candidate-ветки **не следует сливать друг в друга как постоянную схему интеграции**. Безопасный порядок:

1. каждая задача работает в своей ветке/PR;
2. перед финальной проверкой агент делает `git fetch --all --prune` и сравнивает свою базу с актуальным `origin/main`;
3. если `main` продвинулся, candidate обязан сначала интегрировать свежий `main` и вручную сохранить семантику обеих сторон;
4. после зелёных тестов первый готовый PR merge'ится в `main`;
5. следующий параллельный PR **снова** обновляется от уже нового `main`, особенно если затронуты те же файлы (`index.html`, browser-тесты, docs, runtime-related paths);
6. после каждого такого обновления полный relevant regression battery запускается заново;
7. только когда все нужные задачи объединены и проверены в `main`, создаётся отдельный promotion PR `main → stable` без новых функциональных изменений;
8. после зелёного `stable` и Pages acceptance — tag/release.

Запрещено использовать `ours/theirs`, force-push, reset чужой ветки или копирование старого `index.html` поверх нового `main` как замену semantic merge.

Если две параллельные ветки меняют одни и те же участки, **правильный путь — последовательная интеграция через `main`**, а не попытка заранее собрать «супер-ветку» из нескольких незавершённых кандидатов.

---

## 2. Профильный контракт UI и YAML

### `router`

Дефолт при чистой загрузке:

- TUN: ON;
- MIPS: ON;
- Mixed Port 7890: ON;
- Allow LAN: ON — router-only опция, доступна пользователю только здесь;
- пользователь может менять router-owned параметры вручную.

Ключевой инвариант: уход из `router` и последующий возврат обязан восстановить пользовательский router-owned state.

### `vps-local`

UI должен механически обеспечивать:

- TUN: OFF + disabled;
- MIPS: OFF + disabled;
- Advanced TUN stack: OFF/недоступен;
- Mixed Port 7890: ON + disabled;
- Allow LAN: OFF + disabled;
- Per-Proxy TUN: OFF.

Сгенерированный YAML обязан иметь:

- **без** top-level `tun:`;
- `mixed-port: 7890`;
- `allow-lan: false`;
- **без** `bind-address: "*"`.

Это fail-safe контракт: прямое изменение DOM не должно его обходить.

### `vps-gateway`

UI должен механически обеспечивать:

- TUN: ON + locked;
- gateway panel: visible;
- `device: tun-mihomo` по текущему deployment contract;
- MIPS / Advanced TUN stack / Mixed получают корректный gateway-owned enabled-state независимо от предыдущего профиля;
- Allow LAN: OFF + disabled (router-only контракт, v1.7.x: чекбокс не протекает из router и не влияет на YAML даже при DOM-tamper).

Сгенерированный YAML обязан иметь:

- `tun:`;
- `device: tun-mihomo`;
- `auto-route: false`;
- `allow-lan: false`;
- **без** `bind-address: "*"`;
- **никогда** `auto-route: true`.

`auto-route: false` — hard invariant, а не UI default.

---

## 3. Все шесть прямых переходов профилей

Browser regression обязан проверять **каждый** переход:

1. `router → vps-local`;
2. `router → vps-gateway`;
3. `vps-local → router`;
4. `vps-local → vps-gateway`;
5. `vps-gateway → router`;
6. `vps-gateway → vps-local`.

Для каждого конечного состояния проверяются минимум:

- `checked`;
- `disabled`;
- visibility gateway panel;
- фактический YAML-контракт.

### Зачем

Проверка только «чистой загрузки» не ловит path-dependent bugs. Пример уже найденной регрессии: `vps-local` мог оставить `Mixed`/`Allow LAN` disabled при переходе в `vps-gateway`, хотя прямой `router → vps-gateway` выглядел нормально.

Конечный UI-state должен зависеть от **целевого профиля**, а не от маршрута, по которому пользователь туда пришёл.

---

## 4. Обязательный router snapshot regression

Это отдельный тест, его нельзя заменять простой проверкой значения select.

Минимальная последовательность:

```text
router
→ вручную изменить router-owned state
→ vps-local
→ Auto-Whitelist ON
→ Auto-Whitelist OFF
→ router
```

Перед уходом из `router` задать минимум одно нестандартное значение, например:

```text
TUN = ON
MIPS = OFF
LAN = OFF
```

После финального возврата в `router` эти значения должны восстановиться.

Повторить эквивалентный сценарий через `vps-gateway`:

```text
router(custom state)
→ vps-gateway
→ Auto-Whitelist ON
→ OFF
→ router
```

### Зачем

Auto-Whitelist временно применяет router/effective contract, но не должен считаться реальным пользовательским переходом профиля и не должен потреблять/очищать сохранённый `routerOwnedSnapshot`.

Проверка вида «после БС select снова показывает vps-local/vps-gateway» **недостаточна**: она не доказывает сохранность router snapshot.

---

## 5. Auto-Whitelist round trips

Минимум проверить:

```text
router → БС ON → OFF → router
vps-local → БС ON → OFF → vps-local
vps-gateway → БС ON → OFF → vps-gateway
```

Во время БС:

- user-selected profile сохраняется логически;
- effective profile соответствует безопасному БС-контракту;
- выбор профиля заблокирован/скрыт согласно текущему UX;
- gateway panel не должен ошибочно оставаться активным;
- Per-Proxy несовместимые опции выключены;
- после OFF профиль и его собственный UI-state восстанавливаются.

Отдельно выполнить snapshot-сценарии из предыдущего раздела.

### Зачем

Нужно различать:

- **selected profile** — что выбрал пользователь;
- **effective profile** — что временно применено Auto-Whitelist;
- **saved router-owned state** — ручные настройки router.

Смешение этих трёх состояний уже приводило к потере snapshot.

---

## 6. ADVANCED контейнер («Расширенные настройки»)

Контейнер с 2026-10-01 содержит две подсекции: «⚙ Расширенный TUN stack»
(system/mixed) и «🔀 Отдельный вход на каждый прокси». Заголовок summary —
«Расширенные настройки»; бейдж `ADVANCED` и маркер `▶/▼` сохранены. Контракты
спойлера прежние:

Regression должен проверять:

1. `<details>` закрыт по умолчанию;
2. раскрытие **не включает** master switch;
3. закрытие **не сбрасывает** master/children;
4. после нескольких open/close циклов остаётся DOM-элемент `.advanced-badge` с текстом `ADVANCED`;
5. отдельный disclosure marker меняется `▶ ↔ ▼`;
6. marker не накапливает пробелы/текст;
7. `summary` не переписывается через `textContent`, уничтожая дочернюю разметку.

### Зачем

Тест только свойства `details.open` пропускает визуальную/DOM-регрессию. Уже был найден вариант, где спойлер открывался, но `summary.textContent = ...` уничтожало `<span class="advanced-badge">`.

---

## 7. DOM tamper / fail-safe build

UI `disabled` — это только UX, не защита контракта.

### `vps-local`

Перед Build программно подменить DOM, например:

```javascript
cfgTun.checked = true;
cfgTun.disabled = false;
cfgLan.checked = true;
```

И всё равно получить:

- no `tun:`;
- `mixed-port: 7890`;
- `allow-lan: false`;
- no wildcard bind.

### `vps-gateway`

Аналогично попытаться выключить/испортить обязательные deployment значения через DOM и проверить, что итог сохраняет:

- TUN;
- `device: tun-mihomo`;
- `auto-route: false`;
- `allow-lan: false` (в т.ч. при `cfgLan.disabled = false; cfgLan.checked = true` через консоль);
- отсутствие `auto-route: true` и `bind-address: "*"`.

### Зачем

`buildMihomo()` обязан повторно применять profile clamps и не доверять browser DOM как источнику безопасности/валидности.

---

## 8. Независимые поля обязаны переживать profile round trip

Перед серией переходов заполнить synthetic значениями все независимые поля, существующие в **актуальном main**, затем проверить побайтное/семантическое сохранение.

Минимум на текущей архитектуре:

- `mihomoInput` / proxy links;
- URL subscriptions;
- Exclude Filter;
- Device Model;
- Modern REALITY hosts;
- WG/AWG profiles и WireGuard DNS;
- `wgDialerInput`;
- dialer group members;
- dialer provider URLs;
- Web UI/dashboard settings;
- Ping/health-check;
- DPR / Domain Policy Routing fields and policies;
- другие новые поля, добавленные в `main` после написания этого документа.

Проверочный цикл:

```text
router
→ vps-local
→ vps-gateway
→ router
```

и отдельный цикл через Auto-Whitelist.

### Зачем

Deployment profile владеет только deployment/inbound state. Он не имеет права очищать transport, provider, routing-policy или пользовательские данные.

Перед каждым новым profile-related PR список survival fields нужно сверять с актуальным UI: фиксированный старый список быстро устаревает.

---

## 9. Mandatory test battery

Точный набор всегда сверять с актуальным `AGENTS.md`, `docs/TESTING.md` и фактическим содержимым `tests/`. Если появились новые обязательные проверки, они имеют приоритет.

### 9.1. Базовый UI/runtime battery для profile/UX change

```bash
node tests/browser.cjs
node tests/whitelist.cjs
node tests/runtime.cjs web4core.runtime.js
node tests/masque-dpi-regression.cjs
node tests/policy-routing.cjs
node tests/policy-routing-browser.cjs
```

### 9.2. Реальный Mihomo для БС/failover

С обязательными env (`MIHOMO_BIN`, `JS_YAML_PATH`, `TEST_OUTPUT_DIR`) согласно `docs/TESTING.md`:

```text
tests/mihomo-failover.cjs
tests/mihomo-awl-priority.cjs
```

`mihomo-awl-priority.cjs` особенно важен для изменений, затрагивающих Auto-Whitelist или profile/БС state machine: browser UI может быть правильным, а фактический priority/failback contract — сломан.

### 9.3. Manual suites — только когда затронута их семантика

Не запускать тяжёлые лаборатории «для галочки», но запускать, если задача меняет соответствующий механизм:

- `tests/mihomo-awl-soak.manual.cjs` — если менялись production intervals, health-check/failback timing, keep-warm или поведение AWL на длительном интервале;
- `tests/mihomo-reality-handshake.manual.cjs` — если менялась selective Modern REALITY/ML-KEM генерация или совместимость;
- `tools/warp-dialer-fieldtest/` — если менялись dialer-proxy, WG/WARP transport switching, fresh-handshake, MTU/endpoint semantics.

### Почему эти уровни разные

- `browser.cjs` — доказывает реальный DOM/state-machine/Build UX, а не только helper-функции;
- `whitelist.cjs` — закрывает БС, dependency matrix и её взаимодействие с профилями;
- `runtime.cjs` — ловит несовпадение UI assumptions с vendored web4core runtime;
- `masque-dpi-regression.cjs` — защищает независимую load-bearing WARP/MASQUE стратегию от случайной побочной регрессии в большом `index.html`;
- `policy-routing.cjs` — фиксирует DPR/domain-policy генерацию и правила;
- `policy-routing-browser.cjs` — доказывает, что browser UI и профильные переходы не ломают DPR-поля/сборку;
- `mihomo-failover.cjs` — проверяет живую failover-семантику реальным Mihomo, чего YAML parser/browser validator доказать не могут;
- `mihomo-awl-priority.cjs` — проверяет priority/failback семантику Auto-Whitelist реальным Mihomo.

Зелёный GitHub Actions runtime workflow **не заменяет** browser/whitelist/DPR/real-Mihomo regression battery: workflow проверяет другой слой.

---

## 10. `mihomo -t` для каждого deployment profile

На текущем целевом ядре проекта (на момент записи — Mihomo v1.19.31) сгенерировать synthetic YAML для:

1. `router`;
2. `vps-local`;
3. `vps-gateway`.

Каждый прогнать настоящим ядром:

```bash
mihomo -t -f <config.yaml>
```

Проверка browser validator `VALID` не заменяет `mihomo -t`.

Если target Mihomo version в проекте изменится, использовать новую зафиксированную target version и обновить доказательства совместимости.

---

## 11. Dialer/WireGuard regression boundary

Если profile/UX change **не меняет** dialer transport semantics, реальные VPS field tests повторять не требуется, но нельзя сломать существующие offline/runtime/browser контракты dialer-proxy.

Если изменение затрагивает:

- `dialer-proxy` graph;
- provider-backed `use:`;
- WG/WARP transport switching;
- fresh-handshake logic;
- endpoint/MTU behavior;

тогда применяются соответствующие source/runtime/browser tests и `tools/warp-dialer-fieldtest/` по его README.

Полевые результаты (например FRA/AMS) — evidence конкретной сети, а не гарантируемый Cloudflare routing contract.

---

## 12. Runtime provenance и параллельные изменения

`web4core.runtime.js` нельзя править руками.

Перед финалом candidate:

1. проверить, не изменился ли `origin/main`;
2. проверить, не появился ли runtime bot commit;
3. если runtime изменился — интегрировать свежий `main` и повторить как минимум runtime/browser/whitelist/DPR и реальные проверки, зависимые от генерации;
4. проверить provenance через CI workflow;
5. не откатывать runtime просто потому, что candidate начинался от старого SHA.

### Зачем

Даже без изменения `index.html` новый runtime может изменить парсинг/YAML и сделать старые browser assumptions неверными.

---

## 13. Diff discipline

Для большого inline `index.html` перед commit/PR review обязательно:

```bash
git diff --check
git diff --stat origin/main...
git diff origin/main... -- index.html
```

Дополнительно проверить changed-file list.

Если UX-fix внезапно показывает сотни несвязанных удалений/переформатирования — STOP и переделать patch минимально.

---

## 14. Acceptance evidence в отчёте агента

Фраза «все тесты зелёные» недостаточна. Финальный отчёт profile-related задачи должен явно перечислять:

- base `origin/main` SHA на старте;
- `origin/main` SHA перед финалом;
- candidate HEAD;
- изменённые файлы и diff-stat;
- результаты `browser`, `whitelist`, `runtime`, `masque-dpi`, `policy-routing`, `policy-routing-browser`;
- результаты real-Mihomo `mihomo-failover` и `mihomo-awl-priority`, когда задача затрагивает БС/profile interaction;
- `mihomo -t` для `router`, `vps-local`, `vps-gateway`;
- PASS всех 6 прямых profile transitions;
- PASS router snapshot через `vps-local + БС ON/OFF + router`;
- PASS router snapshot через `vps-gateway + БС ON/OFF + router`;
- PASS Auto-Whitelist round trips для всех 3 profiles;
- PASS ADVANCED badge/marker multi-cycle;
- PASS DOM tamper обоих VPS profiles;
- PASS independent-field survival, включая актуальный DPR и новые поля;
- подтверждение, что `web4core.runtime.js` не редактировался вручную;
- подтверждение, что `stable`, tags и releases не тронуты;
- verdict о готовности candidate к merge в **актуальный** `main`.

---

## 15. Promotion gate

После merge profile/UX PR в `main` тест считается завершённым только после проверки итогового интеграционного дерева, а не только head candidate-ветки.

Если затем merge'ится ещё одна параллельная задача, затрагивающая `index.html`, tests, runtime или builder behavior, relevant regression battery нужно выполнить **снова на новом итоговом main**.

Только после объединения всех выбранных задач и зелёного acceptance итоговый `main` можно продвигать отдельным PR в `stable`.

---

## 16. Контракт v1.6.2: router-only режимы, per-profile snapshots, dialer registry

Действует с PR #91 (v1.6.2). Три слоя защиты контракта: UI-gating, обработчики
состояния и build-клампы (DOM не доверяется).

### 16.1 Router-only режимы

- **Auto-Whitelist** и **Per-Proxy (master + children)** доступны только в профиле
  `router`. В `vps-local`/`vps-gateway`: чекбоксы `disabled` + сняты, рядом подсказка
  «Доступно только для профиля "Роутер / обычный TUN"».
- **Silent profile substitution запрещён.** Механизм временного router-контракта БС
  (прежний `deploymentProfile = autoWhitelist ? 'router' : …`, скрытие селектора
  профиля, `bsTemporaryRouter`) удалён. Выбранный профиль не меняется никогда.
- **Build-level fail-safe** (не доверяет DOM): БС + VPS-профиль → явная ошибка сборки
  («доступен только в профиле "Роутер"»), без генерации и без конверсии; Per-Proxy +
  VPS-профиль → Per-Proxy конфигурация не генерируется (кламп), профиль сохраняется.
- Взаимная несовместимость БС × Per-Proxy внутри router сохранена (существующий
  контракт движка).

### 16.2 Per-profile snapshots

- Каждый профиль владеет своим ручным состоянием: Sub Mode, БС, Per-Proxy master
  (+ children perTun/perSocks) и сценарные переключатели router. Уход из профиля
  сохраняет snapshot; вход применяет его; профиль без snapshot получает дефолты
  (Sub Mode ON, БС/Per-Proxy off).
- Следствия (проверены tests/profile-matrix.cjs): ручной Sub Mode OFF в router
  восстанавливается после визита в VPS; первый вход в VPS = Sub Mode ON независимо
  от router-ручного OFF; Per-Proxy ON в router переживает визит в VPS (в VPS
  эффективно OFF/disabled); БС ON в router восстанавливается при возврате.

### 16.3 Dialer target registry (WG/AWG «Промежуточный выход»)

- Список целей НЕ ведётся вручную: строится префлайт-сборкой текущего состояния
  движком web4core (computeDialerTargetsSync) ⇒ значения опций = точные итоговые
  имена YAML (дедупликация, AW-переименования). Алгоритм именования в UI не
  дублируется.
- Исключения из списка: собственный outbound профиля (по итоговому имени, включая
  коллизии), `GLOBAL`/`⚡ Fastest`, группы со статическими ссылками на них (гарантированный
  цикл). Подписочные узлы не разворачиваются — для подписок предлагается
  provider-backed dialer-группа.
- Ручной ввод = «Другое / вручную… (ADVANCED)»; при сборке цель проверяется против
  свежего реестра; неизвестная — ошибка «цель «…» не существует в генерируемом
  конфиге» (никаких dangling dialer-proxy). Циклы ловит централизованный детектор
  web4core (движок + валидатор).
- Dynamic refresh: ввод прокси/подписок, WG upload/remove/clear, поля dialer-группы,
  Sub Mode, БС, DPR-политики, переключение профиля. Исчезнувшая цель сбрасывается с
  видимой пометкой «недоступна для этого профиля»; выбор, ставший именем самого
  профиля (схлопывание коллизии), сбрасывается так же.

### 16.4 Матрица проверки (owner acceptance)

См. tests/profile-matrix.cjs (11), tests/wg-dialer-selector.cjs (12),
tests/browser.cjs (profiles/БС/snapshot/tamper блоки), tests/whitelist.cjs
(router-only открытие + tamper), tests/help-ux-browser.cjs (16, hover-контракт).
