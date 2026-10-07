# WG/AWG generation detection — evidence matrix (#157)

Дата: 2026-10-07 (DAY-03). Канонический детектор: `web4core.detectWireGuardGeneration(bean)`
(runtime, branch `link-generators`, merged PR web4core#17). Детектор — **diagnostics-only**:
никогда не меняет YAML (существующая семантика `version: 3` при v3-полях — это поведение
`normalizeWgBeans`, не детектора).

Источники по приоритету (CONSTITUTION §7, §4):

1. amneziawg-go `device/uapi.go` (проверено напрямую 2026-10-07): параметры `jc/jmin/jmax` —
   `ParseUint(…, 32)`; `s1–s4` — `ParseUint(…, 16)`; `h1–h4`, `content_padding_addition`,
   таймеры — `UintRange.FromString`; `i1–i5` — obf-chain (теги `b/t/r/rc/rd/d/ds/dz`, тег `c`
   не зарегистрирован — SOURCE-PROVEN); `header_protection_key` — FromHex + проверки
   «S%d must be more then %d» и «headers must not overlap»; `random_trailers`/`disable_cookies`
   — ParseBool. Явных min/max лимитов ПОСТАВЩИК НЕ НАКЛАДЫВАЕТ — лимиты проверяет целевой движок.
2. Официальная документация AmneziaWG («AmneziaWG 3.1» на docs.amnezia.org): актуальная
   версия протокола 3.1; `Version` в `.conf` не пишется (SOURCE-PROVEN, docs/PROTOCOLS.md).
3. Локальный compatibility registry `data/upstream/architect-mihomo-compat.json` (#136):
   различение 3.0/3.1 (3.1 = +feature flags), клиентские лимиты mihomo — **UPSTREAM-OBSERVED**
   (reference, не source of truth; правило semantic-mutation=false соблюдено: всё, что
   только observed, даётся как diagnostic-note, без мутаций).
4. Mihomo source (docs/PROTOCOLS.md, wireguard.go-анализ v1.19.27/1.19.30): legacy vs v3
   (`amneziav3`) выбор движка; AWG 3.1 поддержка с 1.19.30 (SOURCE-PROVEN);
   проектный минимум 1.19.31 / рекомендуемый 1.19.32 (RUNTIME-PROVEN: combined-пробы +
   `mihomo -t` этой итерации — см. ниже).

## Матрица маркеров → поколение

| Маркер(ы) | WG | AWG 1.x | 1.5–2.x | 3.0 | 3.1 | Evidence | Итог детектора |
|---|---|---|---|---|---|---|---|
| нет AWG-полей | ✓ | | | | | SOURCE-PROVEN (отсутствие) | WireGuard, exact |
| `jc/jmin/jmax/s1/s2/h1–h4` одиночные | | ✓ | (+) | (+) | (+) | SOURCE-PROVEN (классический набор AmneziaWG) | AWG 1.x, range |
| `+ s3/s4/i1–i5` (CPS) | | | ✓ | | | SOURCE-PROVEN формат Amnezia Premium + UPSTREAM-OBSERVED (реестр: `supports_i1_i5`) | AWG 1.5–2.x, range — **1.5 vs 2.x по конфигу неразличимы** |
| `+ header-protection-key / content-padding-addition / rekey-after-time / rekey-timeout / reject-after-time / keepalive-timeout / max-handshake-attempts` | | | | ✓ | ✓ | SOURCE-PROVEN (uapi.go) + UPSTREAM-OBSERVED (реестр: 3.0 имеет HP без flags) | AWG 3.x (lower bound 3.0), range — 3.1-конфиг может не включать flags, точный 3.0 недоказуем |
| `+ random-trailers / disable-cookies` | | | | | ✓ | SOURCE-PROVEN (uapi.go ParseBool) + официальные docs 3.1 | AWG 3.1, **exact** |
| `j1–j3 / itime` без прочих маркеров | | ? | ? | ? | ? | UNKNOWN (поколение в локальных источниках не доказано) | non-discriminating: family AWG даёт, версию не даёт |
| `version: 3` без v3/v3.1 маркеров | | | | | | CONFLICT | AWG ?, conflict — версию не выдумываем |

Confidence: `exact` (WireGuard; AWG 3.1 по 3.1-only flags) / `range` (1.x, 1.5–2.x, 3.x) /
`conflict` (AWG ?). Никогда не пишется false exact version.

## Ограничения (diagnostics-only заметки детектора)

- `s1–s4 > 65535` → вне uint16 (SOURCE-PROVEN, uapi.go ParseUint16) — целевой движок отвергнет;
- `h1–h4 > uint32` → UPSTREAM-OBSERVED (реестр #136: max_h_value 4294967295);
- `jc > 10` → выше наблюденного клиентского лимита mihomo (UPSTREAM-OBSERVED `max_jc`);
  протокол — uint32, лимит проверяет целевой движок;
- header-protection: глубина S≥nonce и непересечение H проверяются целевым движком
  (SOURCE-PROVEN формулировка проверок в uapi.go; детектор их НЕ reimplement-ит).

## Target compatibility (VALID PROTOCOL ≠ SUPPORTED BY TARGET)

- legacy/1.x/1.5–2.x набор → legacy-движок всех поддерживаемых Mihomo (SOURCE-PROVEN).
- v3/3.x/3.1 семантика → требует Mihomo ≥ 1.19.30 (движок `amneziav3`); на ≤1.19.29 все
  3.1-ключи молча игнорируются — туннель с HP/trailers не поднимется (SOURCE-PROVEN).
  Проектный контракт: минимум 1.19.31, рекомендуемый 1.19.32.

## RUNTIME-PROVEN (эта итерация, 2026-10-07)

Сгенерированные детектор-классифицированные профили прогнаны через реальный `mihomo -t`:

| Класс (детектор) | fixture | mihomo 1.19.31 | mihomo 1.19.32 |
|---|---|---|---|
| WireGuard (exact) | wg-simple-a.conf | **successful** | **successful** |
| AmneziaWG 3.1 (exact) | awg31.conf | **successful** | **successful** |
| AmneziaWG 1.5–2.x (range) | wg-awg-i-like.conf | **successful** | **successful** |

## UI

Бейдж в карточке WG/AWG-профиля: `WG` / `AWG 1.x` / `AWG 1.5–2.x` / `AWG 3.x` / `AWG 3.1` /
`AWG ?` (conflict). Tooltip + диагностические строки в карточке: label, confidence,
compatible-диапазон, capability-маркеры (только имена), conflicts, целевые заметки
[SOURCE-PROVEN]/[UPSTREAM-OBSERVED]. Никаких значений полей и ключей. Бейдж не путает
поколение протокола с версией Mihomo, версией opkg-пакета или версией генератора.

Regression: `tests/wg-generation-badge.cjs` (8 групп, browser), форк-тест
`tools/tests/wg-generation-detect.test.mjs` (11 кейсов, в CI форка).
