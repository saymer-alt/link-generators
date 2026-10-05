# Mihomo WireGuard MTU model (NIGHT-02 research)

Status: research document. No production behavior changed by this file.
Verdict summary at the end: **PARTIALLY PROVEN** — auto-MTU remains disabled in v1.8.0.

## Scope

Ordinary WireGuard only. AWG parameters (S4, Jc/Jmin/Jmax, I1–I5, AWG 3.1 padding/trailers)
are intentionally out of scope here (NIGHT-03). Covers Mihomo 1.19.31 and 1.19.32 —
the exact code these versions run, plus a userspace runtime PoC.

## Relevant sources (pinned)

| Component | Version / commit |
|---|---|
| Mihomo | tags `v1.19.31`, `v1.19.32` (adapter/outbound/wireguard.go) |
| wireguard-go | `metacubex/wireguard-go@a6cecdd7f57f01c6b90b9f113a692b767bca64cf` (identical in both tags) |
| amneziawg-go | `metacubex/amneziawg-go@0c1c6f40ecd7a0c83b8dcd3e54b938eda8cccc8d` (identical in both tags) |
| sing-wireguard | `metacubex/sing-wireguard@c3ae17d19f9e7f29aef38a31c7616688a9fe0d9e` (identical in both tags) |
| mipstack | `metacubex/mipstack@ba762df4c91d` (1.19.31) → `961d4b1c1983` (1.19.32) — **differs** |
| sing-tun | 0.4.24 → 0.4.27 (top-level `tun:` only, not the WG proxy) |

go.mod fact-check: the earlier statement «the only difference is sing-tun» was **incomplete** —
`metacubex/mipstack` also differs between the tags, and it matters for the WG proxy
(see 1.19.31 vs 1.19.32 below).

## Data flow of `MTU =` (link-generators → Mihomo)

1. `parseWireGuardConf()` (web4core `src/core/wireguard.js:122`) reads `MTU =` →
   `bean.wireguard.mtu` (int, faithful; absent → `undefined`).
2. web4core never modifies it; the Mihomo builder emits `p.mtu = wg.mtu` only when
   finite (`src/core/mihomo.js`). Missing → no `mtu:` key in YAML.
3. The same value is used for single WG and every chained WG (no hidden normalization
   anywhere in the chain).

## Mihomo `mtu:` semantics (source)

`adapter/outbound/wireguard.go`:

```go
mtu := option.MTU
if mtu == 0 { mtu = 1408 }          // default, family-independent, both 1.19.31 and 1.19.32
...
outbound.localPrefixes, ...         // from ip / ipv6
newIPStack(option.IPStackOption, localPrefixes, uint32(mtu))
```

`newIPStack` builds the userspace IP stack that terminates the WG virtual interface:

```go
// 1.19.31: if features.WithGVisor { mode = gvisor } else { mode = mips }
// 1.19.32: mode = mips        // unconditional for auto
//          case gvisor: ...   // only an explicit `ip-stack: gvisor` selects gvisor now
case gvisor: wireguard.NewStackDevice(localAddresses, mtu)   // sing-wireguard, gVisor NIC
case mips:   mipstack.New(Config{LocalAddresses: ..., MTU: mtu, ...})
```

**Answer (19.1): `mtu:` is the MTU of the virtual WG interface — the maximum inner IP
packet size the userspace stack will hand to the WG encryption path.** It is not a UDP
payload limit and not a plaintext-with-header limit.

Stack selection fact for 1.19.32: `auto` became **unconditional mips** (the
`features.WithGVisor` branch was removed from `auto`), so a with_gvisor binary now uses
mipstack for WG proxies unless the config explicitly sets `ip-stack: gvisor`.
This is the source-level explanation of the field observation: 1.19.31 (auto→gvisor)
accepted WARP `MTU=1200` + IPv6 address; 1.19.32 (auto→mipstack) rejects it with
`mipstack: IPv6 requires an MTU of at least 1280` — the check `ipv6MinimumMTU = 1280`
exists in both mipstack versions, but 1.19.31 never selected mipstack on with_gvisor
builds. (web4core emits no `ip-stack:` key, so generated configs follow `auto`.)
→ hand over to NIGHT-04: do not fix here.

## WireGuard overhead (source constants)

`wireguard-go@a6cecdd7 device/noise-protocol.go`:

```go
MessageTransportHeaderSize = 16  // type(1)+pad(3) + receiver(4) + counter(8)
MessageTransportSize       = 16 + 16 // + poly1305.TagSize → 32 = empty keepalive
MessageInitiationSize      = 148
MessageResponseSize        = 92
MessageCookieReplySize     = 64
```

`device/send.go`: transport content is padded to a multiple of `PaddingMultiple = 16`
(`calculatePaddingSize`, AWG v3 additionally caps it at `mtu`).

Data-path breakdown for one inner IP packet of size `S`:

```text
UDP payload (WG data message) = S + align_pad(0..15) + 32   // 16 header + 16 tag
outer UDP datagram over IPv4  = S + align_pad + 32 + 20 + 8 = S + align_pad + 60
outer UDP datagram over IPv6  = S + align_pad + 32 + 40 + 8 = S + align_pad + 80
```

Handshake sizes (148/92/64) are a separate path — irrelevant to the data MTU budget,
except they are the packets most likely to exceed a tiny path MTU.

## dialer-proxy data path (source)

`wireguard.go`: the outbound creates
`outbound.bind = wireguard.NewClientBind(..., proxydialer.NewSingDialer(dialer), ...)`.
`sing-wireguard/client_bind.go`: the WG device sends/receives its messages over a UDP
socket created by that dialer (`DialContext(N.NetworkUDP, addr)` / `ListenPacket`).

For `dialer-proxy: B` the dialer chain resolves to outbound B. WireGuard outbound B is
an L3 outbound (`IsL3Protocol() == true`): its `DialContext/ListenUDP` are
`w.tunDevice.DialUDP / ListenUDP` (`wireguard.go:247,825`) — i.e. **UDP sockets inside
B's userspace IP stack**.

**Answer (19.6): with `dialer-proxy: B`, A's WG messages are UDP payloads of flows
inside B's netstack.** B's stack wraps every such payload with an inner IP(+20/+40) +
UDP(+8) header — **+28 bytes (IPv4) / +48 (IPv6) per nesting level** — and the WG data
message then encrypts that inner packet (source: StackDevice writes IP packets to the
wire; wireguard-go adds 32 on encryption).

There is **no PMTU feedback** between A's stack and B's stack: they are independent
userspace stacks; A knows only `MTU_A`.

## Runtime PoC (userspace, exact sing-wireguard code)

`metacubex/sing-wireguard@c3ae17d1` `StackDevice` (the gVisor stack mihomo selects on
with_gvisor builds), Go 1.27, `-tags with_gvisor`; synthetic addresses only; no keys,
no handshake — the stack ends at the WG boundary, which is exactly the surface whose
size behavior we verify.

Measured (UDP payloads written into the stack, IP packets read at the WG boundary):

| Stack MTU | UDP payload | WG-bound IP packets |
|---|---|---|
| 1408 | 1000 | one packet, 1028 (= payload+28) |
| 1408 | 1380 | one packet, 1408 (exactly at MTU) |
| 1408 | 1381 | two packets, 1404 + 25 (IP-fragmented; total 1429 = payload+28+20) |
| 1408 | 1400 | two packets, 1404 + 44 |
| 1200 | 1172 | one packet, 1200 (exactly at MTU) |
| 1200 | 1173 | two packets, 1196 + 25 |
| 1200 | 1200 | two packets, 1196 + 52 |

Conclusions (runtime-verified, gVisor path):

- UDP payload budget inside a WG stack = **MTU − 28** (IPv4) / MTU − 48 (IPv6);
- payloads beyond it are **IP-fragmented by the stack itself** — no error is returned
  to the writer, and no PMTU signal is produced;
- every WG-bound packet is `payload + 28` per non-fragmented message.

Combined with the wireguard-go constants this yields the nested-chain budget below.

## Candidate formula

Definitions: `MTU_X` — the configured `mtu:` (virtual interface budget) of hop X;
`overhead(X)` — what hop X adds when it encrypts one packet: `32 + align_pad(0..15)`;
transport into the next hop adds `28` (inner IPv4) / `48` (inner IPv6).

```text
A → B            (unfragmented requirement):
  MTU_A + align_A + 32 + 28 ≤ MTU_B        (IPv4 transport)
  MTU_A + align_A + 32 + 48 ≤ MTU_B        (IPv6 transport)

A → B → C:  apply the same inequality pairwise B→C first, then A→B with the
            reduced MTU_B:
  MTU_B_eff = MTU_C − 60 − align_B   (worst case −75)
  MTU_A_eff = MTU_B_eff − 60 − align_A
```

**Answer (19.7/19.8):** pairwise inequality `MTU_inner + align + 60 ≤ MTU_outer`
(IPv4), recursion **outermost → innermost**. Worst-case per hop: **−75**
(60 + worst align 15); exact per-packet align depends on the inner packet size, so a
guaranteed constant budget per hop is 75, and 60 is the no-padding case (padded only
when the inner size is not a multiple of 16).

UNPROVEN: mipstack (mips mode) — the same inequalities are expected (it is also a
userspace netstack with an interface MTU), but no runtime PoC has been run for it.

## Explicit MTU semantics

**Answer (19.9): yes — an explicit imported MTU is a user decision recorded in the
`.conf` and must be treated as an upper bound** (`effectiveMtu ≤ importedMtu`).
**Answer (19.10): auto-decrease only.** Auto-increase would override an explicit user
choice and can re-introduce path fragmentation that the user explicitly configured
against.

Minimum values: IPv4 minimum MTU per RFC 791 is 68; practical WG minimum is ≥ 576,
and IPv6 requires ≥ 1280 (RFC 8200; enforced by mipstack at stack creation, see the
field observation). Mihomo does not enforce an IPv4 minimum (source: no check besides
the mipstack IPv6 one). A too-low IPv4 MTU does not make the WG proxy invalid, it only
degrades throughput.

## Missing MTU semantics

`MTU =` absent → web4core emits no `mtu:` key → **Mihomo default 1408**
(`if mtu == 0 { mtu = 1408 }`, both versions, family-independent).
Current web4core behavior is already Variant A («emit nothing, trust Mihomo») and it is
the correct default: 1408 is a Mihomo-owned implementation choice that may change
between versions, and inventing a fixed number in the engine would desynchronize from
the core. Variant B (engine-computed deterministic MTU) becomes relevant only together
with auto-MTU after the PoC gate (see verdict).

## 1.19.31 vs 1.19.32 (summary for NIGHT-04)

- WG data path (wireguard-go, sing-wireguard): **identical**.
- WG proxy IP stack selection: **changed** — `auto` is unconditional mips in 1.19.32
  (was: gvisor on with_gvisor builds in 1.19.31); explicit `ip-stack: gvisor` still
  selects gVisor.
- Consequence: the `IPv6 requires an MTU of at least 1280` rejection of a dual-stack
  WG profile with `MTU = 1200` is a **mipstack creation check**, newly reachable
  because of the auto→mips change. link-generators v1.8.0 already avoids it via the
  IPv4-only contract (web4core PR #14): no IPv6 address → no IPv6 minimum applies.
- The same auto→mips change means **all WG proxies in 1.19.32 default builds run on
  mipstack**, so any future MTU logic must be proven on mipstack too (UNPROVEN today).

## Unknowns / UNPROVEN items

1. mipstack runtime size behavior (fragmentation vs error, exact budgets) — UNPROVEN,
   needs the same PoC against `mipstack.New` stacks.
2. Live crypto end-to-end PoC (real handshake, real remote): not performed — the
   formulas above are proven at the netstack boundary, which is where all size
   decisions are made, but a full live capture through two crypto devices was not run.
3. Exact `align_pad` distribution for TCP flows (depends on segment sizes; bounded
   by 15, worst-case budget already covers it).
4. IPv6 inner transport (+48) nesting — derived from header sizes, not PoC'd.

## Recommendation

- NIGHT-03 (AWG overhead): reuse `computeAmneziaTagJunkSize` /
  `analyzeWireGuardProfile` classification; add S4/content-padding per-packet terms to
  `overhead(X)` once auto-MTU is approved.
- NIGHT-04 (IPv6/1.19.32): root cause confirmed here — `auto` → unconditional mips +
  mipstack IPv6-1280 check. IPv4-only contract already protects generated configs;
  optional follow-up: surface an `ip-stack: gvisor` escape hatch only if the owner
  wants dual-stack WG back.
- NIGHT-05 (auto-MTU): prerequisites to flip PARTIALLY PROVEN → PROVEN:
  mipstack runtime PoC, one live crypto 2-hop capture, IPv6-nesting PoC. The engine
  ownership and API are already in place (`web4core.analyzeWireGuardProfile` — single
  source of truth; UI renders only). Formula direction: outermost → innermost;
  conservative per-hop budget: −75 (IPv4) / −95 (IPv6).
