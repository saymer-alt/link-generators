# AmneziaWG overhead / MTU parameter model (NIGHT-03 research)

Status: research document. No production behavior changed by this file.
Depends on NIGHT-02 (`WG-MTU-MIHOMO.md`) for the ordinary WireGuard base:
**data overhead = inner + align_pad(0..15) + 32; wire = inner + pad + 60 (IPv4) / + 80 (IPv6)**.

## Implementations (source-pinned)

Both Mihomo tags use `metacubex/amneziawg-go@0c1c6f40ecd7a0c83b8dcd3e54b938eda8cccc8d`.
`adapter/outbound/wireguard.go` (both versions):

```go
if option.AmneziaWGOption.Version == 3 {
    outbound.device = amneziav3.NewDevice(...)  // package device/   — AWG v3 / v3.1
} else {
    outbound.device = amnezia.NewDevice(...)    // package device_v1/ — AWG 1.5 / 2.x (legacy)
}
```

Two independent implementations behind one option struct; `Version: 3` is the only
explicit switch (no 2.x-specific implementation — `device_v1` serves 1.5 and 2.x, with
`J1–J3`/`ITime` documented as «v1.5 only (removed in v2+)» in the option comments).
wireguard-go base `@a6cecdd7f57f` is shared; mipstack is unrelated to AWG parameters
(it is the IP stack, see NIGHT-02).

## Parameter classification

Categories: **A** per-data-packet fixed, **B** per-data-packet variable,
**C** handshake packet size, **D** separate junk packet, **E** separate signature packet,
**F** header/type substitution (same length), **G** timing/lifecycle, **I** no packet-size effect.

| Parameter | v1.5 (`device_v1`) | v3 (`device`) | Category | Data-MTU effect | Deterministic |
|---|---|---|---|---|---|
| Jc / Jmin / Jmax | `JunkCreator.CreateJunkPackets` before handshake initiation (`send.go:149`) | `device.junk.count/min/max`, same semantics | **D** | **no** — separate datagrams `[Jmin..Jmax]`, may exceed path MTU | size range deterministic (config) |
| S1 | `CreateInitHeaderJunk` → initiation (`send.go:161`) | `paddings.init` | **C (B-class size)** | no | yes |
| S2 | `CreateResponseHeaderJunk` (`send.go:202`) | `paddings.response` | **C** | no | yes |
| S3 | `CreateCookieReplyHeaderJunk` (`send.go:264`) | `paddings.cookie` | **C** | no | yes |
| **S4** | `CreateTransportHeaderJunk(len(packet))`, **`elem.packet = append(junkedHeader, elem.packet...)`** (`send.go:612`) — prepended to every transport message | `elem.padding = paddings.transport` random-filled before the header (`send.go:68,598`) | **A** | **YES: +S4 bytes on every data packet** | yes |
| H1–H4 | `GetMsgType(...)` for initiation/response/cookie/transport (`noise-protocol.go:199,388`, `send.go:245,545`) | `headers.*.PickOne()` written into the same 4-byte type field (`send.go:611`) | **F** | **no** — value substitution, length unchanged | n/a (not in MTU arithmetic) |
| I1–I5 | `GenerateSpecialJunk` (`send.go:135`) — separate packets sent with the handshake; size = `ObfuscatedLen(0)`, computable from the tag spec | `ipackets[5]*obfChain`, same pattern (`send.go:138`) | **E** | **no**; signature packet size is computable and can exceed path MTU (WARN, not MTU) | yes (unknown tags → WARN) |
| HeaderProtectionKey | not supported | `HeaderProtectionCipher(crypt[:16]).XORKeyStream(header, header)` — 16-byte header transform, same length (`send.go:641`) | **F** | **no** | n/a |
| ContentPaddingAddition | not supported | `randomPaddingAddition` = `PickOne(range)` capped by `udpWindow − packetSize` (`send.go:536–553,615`) | **B** | **YES (v3 only): worst case = max(range)** | yes when set (range is config) |
| RandomTrailers | not supported | fallback branch when CPA is unset: `randomTrailer` = `fastrandn(DefaultUdpWindow − packetSize)` (`send.go:556–565,617`); also applied to handshake | **B/J** | **YES (v3 only)**: random per packet, **no config-derived upper bound** (window constant 500 is implementation state) | **no → auto-MTU unsafe** for such profiles |
| RekeyAfterTime / RekeyTimeout / RejectAfterTime / KeepaliveTimeout / MaxHandshakeAttempts | wireguard-go timers (`constants.go`) | `timings.*` AtomicUintRange (`uapi.go`) | **G** | no | n/a |
| PersistentKeepalive | keepalive timer; keepalive message is a fixed 32-byte empty transport message | same | **G** | no (fixed 32 B wire message) | n/a |
| ITime | junk send interval (v1.5-only) | absent | **G** | no | n/a |
| J1–J3 | raw hex junk packets (v1.5-only, removed in v2+) | absent | **D** | no | yes |
| DisableCookies | absent | disables underload/cookie path (upstream commit `0c1c6f40`) | **G** | no | n/a |
| Version | implementation selector (`device_v1` for anything ≠ 3) | selects `device/` | meta | — | — |

v3 transport assembly priority (`send.go:615–631`): `ContentPaddingAddition` → else
`RandomTrailers` → else plain 16-alignment padding (capped at `mtu`). The branches are
mutually exclusive, so the model is:

```text
AWG v1.5 data overhead = 32 (WG base) + S4            + align_pad(0..15)
AWG v3 (no CPA/RT)     = 32              + S4         + align_pad(0..15)
AWG v3 with CPA        = 32              + S4         + PickOne(range)  → max = max(range)
AWG v3 with RT         = 32              + S4         + random ≤ window(500)  ← NOT config-bounded
```

`align_pad` is only reached when CPA and RT are both unset, so it disappears from the
worst case whenever CPA or RT is present.

## Handshake / junk / signature packet safety model

These never influence the tunnel MTU; they are standalone datagrams that can exceed the
path MTU and fragment. Diagnostics only (already shipped in
`web4core.analyzeWireGuardProfile`):

```text
⚠ AWG Jmax = 1500 exceeds the default transport budget 1408 (junk datagrams may fragment)
⚠ AWG I1 = N B signature packet exceeds the budget
⚠ AWG Ix: unrecognized tags — size not computable
```

Signature size formula (verified against `device_v1/awg/tag_generator.go` and
`device/obf*`): `b` → hex/2, `r`/`rc`/`rd` → N, `t`/`c` → 8 (overridable param),
`wt`/`wr`/`d`/`ds` → 0, `dz` → N.

## PersistentKeepalive (PHASE 12)

> **Update v1.9 (#137):** pre-#137 этот раздел описывал consumer collapse `25-35 → 25`
> как deliberate normalization. После merged #137 collapse больше НЕ является
> поведением по умолчанию: фиксированный 25 под диапазон применяется только как
> **explicit user-visible policy** с trace-записью в diagnostic report. Текущий контракт —
> ниже; исторические пункты (1, 2, 4–5) про source semantics и Mihomo ограничение
> остаются верными.

Source semantics vs runtime limitation vs v1.9 policy:

1. **Source AWG semantics**: config format accepts `25` and ranges `25-35`
   (seen in real Amnezia exports).
2. **Mihomo scalar limitation**: `PersistentKeepalive int` — raw
   `persistent-keepalive: "25-35"` in YAML is **rejected by both 1.19.31 and
   1.19.32** (`cannot parse 'persistent-keepalive' as int: strconv.ParseInt:
   parsing "25-35"`). Этот research fact остаётся верным.
3. **Strict parser/report behavior (v1.8 NIGHT-06, действует при policy OFF)**:
   web4core raw parser — integer only; range сохраняется как raw fact в
   `awgFieldReport` (UNSUPPORTED), поле НЕ эмитится, карточка показывает WARN.
   Никакого silent collapse; `PK = 0` различается (disabled, поле опускается).
4. **Current v1.9 policy — stability toggle ON (DEFAULT, #137)**: у AWG-профиля
   без совместимого целого PK (отсутствует или диапазон) при сборке эмитится
   `persistent-keepalive: 25`; диапазон → trace
   `SUPPORTED_NORMALIZED — explicit user-enabled compatibility fallback` с
   обязательной пометкой, что **fixed 25 НЕ эквивалентен** исходной random-range
   semantics (random-per-interval детерминированно теряется). Валидный integer
   из источника (включая 0 = disabled) никогда не заменяется. Scope — только
   AWG-профили (`amnezia-wg-option`); plain WireGuard вне политики.
5. **Policy OFF**: строгий контракт п.3 — raw range как fact, поле omitted,
   WARN/UNSUPPORTED, без silent collapse.

Политика применяется к копиям бинов на пути сборки (`wgEngineBeans`) —
оригинальные профили не мутируются; выключение тоггла байт-в-байт возвращает
строгий контракт. Regression: `tests/awg-stability.cjs` (матрица A/B/C).
Auto-MTU по-прежнему disabled (PARTIALLY PROVEN) — эта policy ничего не меняет
в overhead-модели ниже: 25 B/keepalive-пакет не входит в data-path overhead.

## Parser fidelity (PHASE 17)

`parseWireGuardConf` (web4core, tested): all Mihomo `AmneziaWGOption` fields survive —
verified by the matrix below (`emitted(awg)` equals the input set in every case).
Type mapping matches Mihomo's expectations: ints (`jc..s4`, `itime`, `version`),
booleans (`random-trailers`, `disable-cookies`, `1/true/yes` — `on/off` normalized by
the consumer first), strings (`h1–h4`, `i1–i5`, `header-protection-key`,
`content-padding-addition`, `rekey-*`, `keepalive-*`, `max-handshake-attempts`).
Unknown AWG keys: since NIGHT-06 (v1.8) the parser records an UNKNOWN entry in
`awgFieldReport` instead of dropping them silently (J1–J3/ITime are mapped) —
no Mihomo-facing impact. No supported field is silently lost.

## Mihomo compatibility matrix (PHASE 18, `mihomo -t`, synthetic configs)

| Case | 1.19.31 | 1.19.32 | amnezia-wg-option emitted |
|---|---|---|---|
| base (S1,S2) | PASS | PASS | s1,s2 |
| S1–S4 | PASS | PASS | s1..s4 |
| Junk (Jc4, 100–1300) | PASS | PASS | jc,jmin,jmax |
| Junk over MTU (500–1500) | PASS | PASS | jc,jmin,jmax |
| H1–H4 | PASS | PASS | h1..h4 |
| I1–I5 (tag specs) | PASS | PASS | i1..i5 |
| HPK | PASS | PASS | header-protection-key |
| CPA 10-100 (v3) | PASS | PASS | content-padding-addition,version |
| CPA + S4 (v3) | PASS | PASS | content-padding-addition,s4,version |
| RandomTrailers (v3) | PASS | PASS | random-trailers,version |
| PK integer 25 | PASS | PASS | — (proxy-level persistent-keepalive: 25) |
| PK integer 30 + stability ON | PASS | PASS | — (persisted as 30; #137 никогда не заменяет валидный integer) |
| PK range raw to Mihomo `"25-35"` | **FAIL** | **FAIL** | cannot parse as int |
| PK range `25-35` + stability ON | PASS | PASS | — (persistent-keepalive: 25 — explicit user-visible normalization, fixed 25 НЕ эквивалентен random-range) |
| PK range `25-35` + stability OFF | PASS | PASS | — (field omitted; WARN/UNSUPPORTED в отчёте) |
| PK missing + stability ON | PASS | PASS | — (persistent-keepalive: 25) |

`mihomo -t` proves acceptance only, **not semantic equivalence** с исходной
random-range семантикой: PASS строки «range + stability ON» означают лишь, что
`25` принимается движком, а не что поведение идентично диапазону (см. PHASE 12,
п.4).

## Deterministic data-overhead model (PHASE 19)

| Profile shape | min overhead | max overhead | deterministic |
|---|---|---|---|
| plain WG / AWG (no S4, no CPA, no RT) | 32 | 32 + 15 | yes |
| AWG v1.5/v3 with S4 | 32 + S4 | 32 + S4 + 15 | yes |
| AWG v3 with CPA | 32 + S4 + min(range) | 32 + S4 + max(range) | yes (max from config) |
| AWG v3 with RandomTrailers | 32 + S4 + 0 | **not config-bounded** (window) | **no → auto-MTU unsafe** |

Planner rule (for NIGHT-05): use **max**; profiles with RandomTrailers get WARN and are
excluded from auto-MTU. Separate junk/signature packets never adjust the MTU — WARN only.

## NIGHT-05 API shape (proposal, extends the shipped `analyzeWireGuardProfile`)

```js
awg: {
  ..., // existing fields
  dataOverhead: { min: 32, max: 47, deterministic: true },  // bytes beyond the inner IP packet
  separatePackets: [ { type: 'junk', key: 'J', min: 100, max: 1300 },
                     { type: 'signature', key: 'I1', size: 123 } ],
}
```

## Unknowns

- mipstack runtime interaction with AWG paddings (same device code, different IP stack —
  padding is applied before the stack, so expected equal; UNPROVEN by runtime test).
- Live crypto capture end-to-end (as in NIGHT-02).
- `align_pad` distribution for real TCP flows (bounded, worst case covered).
