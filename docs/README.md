# docs — навигатор технической базы знаний

README.md в корне репозитория — пользовательская landing page; здесь — внутренняя
документация. Источник истины — код; при расхождении чинить документацию.

Для обычного пользователя начинать с [quick-start.html](../quick-start.html) — простой
быстрый старт; [GENERATOR-GUIDE.md](GENERATOR-GUIDE.md) — короткая инструкция по всем
режимам генератора.

## Быстрый старт по задачам

### Для пользователя

| Задача | Документы |
|---|---|
| Быстро понять, что нажимать | [quick-start.html](../quick-start.html) |
| Короткая инструкция по генератору | [GENERATOR-GUIDE.md](GENERATOR-GUIDE.md) |
| Своя URL-подписка через Secret GitHub Gist | [GIST-SUBSCRIPTION.md](GIST-SUBSCRIPTION.md) |
| Фильтр узлов подписки (в т.ч. кириллица) | [EXCLUDE-FILTER.md](EXCLUDE-FILTER.md) |
| WARPSCOUT: Windows / Keenetic / VPS | [WARPSCOUT-WINDOWS.md](WARPSCOUT-WINDOWS.md), [WARPSCOUT-KEENETIC.md](WARPSCOUT-KEENETIC.md), [WARPSCOUT-VPS.md](WARPSCOUT-VPS.md) |

### Для разработчика / агента

| Задача | Документы |
|---|---|
| Понять, как работает страница | [ARCHITECTURE.md](ARCHITECTURE.md), [DATAFLOW.md](DATAFLOW.md) |
| Какие опции/поля что генерируют | [MIHOMO.md](MIHOMO.md) |
| Как добавить опцию/прототип UI | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Протоколы: форматы ссылок и поддержка | [PROTOCOLS.md](PROTOCOLS.md) |
| Валидатор: что проверяется | [VALIDATION.md](VALIDATION.md) |
| Тесты: как запускать и что покрыто | [TESTING.md](TESTING.md) |
| Backlog после v1.8.0 (только документация, без обязательств) | [ROADMAP.md](ROADMAP.md) |
| Автообновление рантайма из fork | [UPDATES.md](UPDATES.md), [WEB4CORE-FORK.md](WEB4CORE-FORK.md) |
| Auto-Whitelist (резерв БС) | [AUTO-WHITELIST.md](AUTO-WHITELIST.md) |
| Профили развёртывания: обязательный тест-контракт | [DEPLOYMENT-PROFILES-TEST-CONTRACT.md](DEPLOYMENT-PROFILES-TEST-CONTRACT.md) |
| Политики по доменам + домен-детект (VPS Gateway) | [POLICY-ROUTING.md](POLICY-ROUTING.md), [VPS-GATEWAY.md](VPS-GATEWAY.md) |

### Исторические аудиты и обзоры

| Задача | Документы |
|---|---|
| История решений по fallback | [FALLBACK-REVIEW.md](FALLBACK-REVIEW.md) |
| Аудит поддержки Mihomo (снимок 1.19.31) | [AUDIT-MIHOMO-1.19.31.md](AUDIT-MIHOMO-1.19.31.md) |

## Ключевые контракты (не нарушать молча)

- `masque://` формат и anti-DPI стратегия — описаны в AGENTS.md (корень).
- Версионный контракт Mihomo: **minimum 1.19.31, recommended/current 1.19.32**;
  MIPS stack требует >= 1.19.31 (warning в валидаторе, не блокер); gVisor — fallback;
  исторические минимумы функций (AWG 3.1 >= 1.19.30, DPR >= 1.19.27) — отдельно.
- Модель профилей развёртывания: `router` (по умолчанию) / `vps-local` / `vps-gateway`;
  устаревшие идентификаторы `generic`/`vps` не используются как пользовательская модель.
- Flat GLOBAL fallback в Auto-Whitelist; nested-группы запрещены (#2588).
- DDP (домен-детект) — инвариант профиля vps-gateway: `tun.dns-hijack` + пассивный
  `sniffer` + `store-fake-ip: true` при включённом fake-ip DNS; патчер установщика
  gateway сохраняет значение (PR #33 amnezia-mihomo-gateway, merged).
- `web4core.runtime.js` — generated; меняется только через fork `saymer-alt/web4core@link-generators` + workflow.
