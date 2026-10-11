# WDTT in Builder — proposed design for v1.12+

Date: 2026-10-11. Owner proposal: [#250](https://github.com/saymer-alt/link-generators/issues/250), roadmap [#160](https://github.com/saymer-alt/link-generators/issues/160).
Status: DESIGN ONLY / NO PRODUCT CODE / NOT FIELD VERIFIED. Field trials expected during 12–18 October 2026; specific day and device not confirmed.
Production stable v1.11.0 is unchanged.

## Architecture

Mihomo remains a normal WireGuard outbound. WDTT is an EXTERNAL UDP transport managed on the target device, not a Mihomo protocol. Intended route:

    Mihomo WireGuard outbound (type: wireguard; 127.0.0.1:local UDP port)
       -> WDTT wt-client (same device and network namespace)
       -> real VK TURN transport
       -> WDTT remote server
       -> WG endpoint
       -> Internet

An alternative wg-obfuscator may offer direct UDP obfuscation, but it is not the same as WDTT/VK TURN. It needs its own proof and configuration contract; never invent protocol type wdtt, URL scheme wdtt:// or implicit WDTT support in Mihomo. AmneziaWG 3.x compatibility must be proven separately.

In containers 127.0.0.1 resolves inside a network namespace: a separate WDTT container may not be reachable from Mihomo via loopback. Never silently rewrite networking or bind local transport to a public interface to work around this.

## Proposed Builder controls — only after design and field gates

- For each imported WG profile: Transport = Direct UDP (current default) / Local UDP service (explicit opt-in).
- When local selected: external service WDTT (real VK TURN) or later separately validated wg-obfuscator; bind host 127.0.0.1 and numeric port 1–65535. Example 42000 is NOT a prescribed default.
- Keep original remote WG endpoint in the project; show it as read-only, and ensure switching back to Direct UDP restores the original server and port exactly.
- Transport mode and Auto Whitelist placement (#249 PRIMARY/FALLBACK) are independent axes: no implicit movement between primary and fallback.
- Show persistent visible warning: external wt-client must already be running on target; Builder cannot confirm actual VK access, handshake, DNS path, performance or service health.
- No VK login/token/cookies, TURN credentials, shell execution, installation, server control, external network probing or secrets upload from browser. Any companion-export of a wt-client config is a separately reviewed opt-in artifact, not extra keys in Mihomo YAML.

## Phased architecture decision

A0 source/read-only audit: test whether current WG .conf import and web4core already emit localhost/port in standard type: wireguard YAML; verify with real mihomo -t 1.19.31 and 1.19.32 using SYNTHETIC keys. If existing WG support suffices, prefer documentation over changing parsers.

A1 only if UX adds value: opt-in card settings, preserving original endpoint and transport selection in current Builder project model. Suggested transport.kind values direct/local are PROPOSAL, not approved schema. Old projects must default to Direct UDP with byte-identical generated YAML. Save/Load, Reset/Undo, Reverse Build and original credentials must remain consistent.

A2 only after W1–W10 real field gates: optional WDTT-specific diagnostics and companion instructions with explicit boundary KAS/Entware vs browser.

Engine semantics belong to saymer-alt/web4core branch link-generators, not manual changes to vendored web4core.runtime.js. entware-go builds/packages binaries after license approval; keenetic-auto-setup runs gated preflight/lifecycle; wt-client transports packets; Mihomo runs WG; Builder generates YAML.

## Safety and test matrix

| Test | Required behaviour |
|---|---|
| B01 | WG imported with synthetic Endpoint 127.0.0.1:42000 yields ordinary type: wireguard; mihomo -t 1.19.31/1.19.32 |
| B02 | Direct -> local -> direct restores original endpoint; old project output byte-identical |
| B03 | Reject port 0, 65536, negative, garbage/non-integer, non-loopback; invalid WG peer/key, unsupported AWG/multi-peer fail closed |
| B04 | Project Save/Load/Reset/Undo/Reverse; no loss of keys, no phantom services |
| B05 | WG dialer, two independent WG profiles, AWL PRIMARY/FALLBACK #249, static/proxy-provider mixtures; names and routing no cycles |
| B06 | Router, VPS local/Gateway, TUN/Per-Proxy/Tiered/DPR all retain current guards |
| B07 | Browser Chromium/Firefox/WebKit, keyboard, mobile, 200% zoom; no inert controls, no hidden auto-fetch |
| B08 | No secrets in logs/diagnostics/issues; exported user project containing credentials must warn |
| B09 | For every actual bug: reproducible RED test before fix -> GREEN afterwards; wire suite into Generator CI |
| B10 | Source runtime provenance, complete CI; distinguish config validation from live network proof |

## Evidence and blocking prerequisites

[KAS PR #124](https://github.com/saymer-alt/keenetic-auto-setup/pull/124): research and acceptance gates.
[KAS PR #125](https://github.com/saymer-alt/keenetic-auto-setup/pull/125): isolated gated sandbox / config conversion; laboratory TURN E2E.
[entware-go PR #10](https://github.com/saymer-alt/entware-go/pull/10): build-only, multiple CPU architectures, locally observed WG handshake + TCP + UDP + DNS through Pion TURN.
None of those constitutes REAL VK TURN / real Keenetic acceptance.

BLOCKERS: fhttp license/notice, real VK client-server credentials (private), production-server security review, installed hardware ABI/RAM/kernel, controlled device, reboot ordering, fail-closed/leaks and rollback. No distributable IPK/install while gates are open; do not reuse quarantined packages. A successful compile, emulator run, or mihomo -t cannot prove connectivity.

Field protocol: [WDTT-FIELD-PLAN.md](WDTT-FIELD-PLAN.md).

Release policy: staged research first; no automatic WDTT dependency for #249 or v1.12; separate owner GO before implementation and before eventual stable promotion.
