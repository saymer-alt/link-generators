# MSK V2/V3: requirements and regression matrix for Mihomo Builder

**Date:** 2026-11-07. **Owner evidence:** operator's private MSK Mihomo YAML exports and [VPS field record](https://github.com/saymer-alt/vps-gateway-bootstrap/pull/66). **Status: research + acceptance only, not implemented and not a release approval.** No live credentials, private subscription URLs, HWID, WARP identities or large AWG I1 payload in this repository.

## 1. Distinguish what really failed from what the generator currently does

| Evidence | Owner / classification | Builder implication |
| --- | --- | --- |
| The first raw MSK export had a router-oriented TUN/profile, permissive listener and unauthenticated controller. The operator then switched to VPS Transparent Gateway export with loopback controller, TUN `tun-mihomo`, DNS/sniffer and `allow-lan:false`. | **Wrong UI profile selected by operator**, not proven generator profile-switch bug. | Make selected scenario prominent in downloaded YAML/preview and add operator preflight guidance. Do not change router defaults by assumption. |
| The gateway export still emitted `stack:mips`; the actual MSK production gateway used `gvisor`. | **Expected template vs host-state mismatch**, not evidence that `mips` is universally broken. | Explain that *VPS Transparent Gateway* selects a template, NOT a live config migration. Before replacing a working host config, preserve its actual TUN stack/device, DNS and routing; provide warning/diff, not automatic host mutation. |
| Basic `⚡ Fastest` uses `url-test` and pools several providers with direct Estonia Mieru/TUIC/WARP. | **Missing per-host ordered policy authoring** relative to owner design. | Owner needs explicit fixed **ordered fallback** and individually addressed provider-only groups, not fastest or a shared subscription pool. |
| MSK V2 manually edited Mieru as `transport: TCP`, although owner intended UDP; V3 corrected to UDP. | **Manual/offline edit error.** The generator was capable of serializing the supplied transport; no engine/parser bug has been demonstrated. | Offer field-level visibility/preservation and a diff to flag Mieru UDP↔TCP changes. Verify exact Mieru protocol/port range, not just YAML parse. |
| MSK V2 manual adaptation included extra **visible** REJECT members in `AUTO-EXIT` and `ESTONIA`, removed in V3. | **Manual rewrite error**, not confirmed generator bug. | Explain `REJECT` member vs `empty-fallback:REJECT` option, and avoid accidentally sprinkling REJECT members into every nested tier. Do not remove true fail-secure behavior. |
| V2 WARP MSK AWG `alive=false`; V3 changed AWG identity/obfuscation options. | Runtime health observed for V2 only; V3 **not yet remeasured**. | WG/AWG import must preserve complete identity/variant, including `i1`, not assume that changed params repair handshake. Never log secret data. |
| User reported “Mihomo fell”, but first snapshot still showed old PID while on-disk config was new. After explicit restart new PID and HTTP 204 observed. | **Disk-vs-runtime mismatch; not an observed YAML crash.** | Generated file is not a deployment. Teach operator `test -s`, `mihomo -t`, verified backup, process restart/new MainPID, new-process journal, TUN, DNS, policy routing. |
| V2 group API: TUIC `alive:true`, Mieru/WARP `alive:false`; GEODEMA/KYRA/GIST `alive:false` one-time; GIST-EE `alive:true`. | **Bounded runtime observation**, not causal proof of subscription defects. | Differentiate provider refresh, individual node alive, selector/group selection and actual user traffic. No false "V3 all fixed" claim. |

## 2. Desired private MSK end state (not a hard-coded application preset)

Owner-specific order:

```text
mode: rule
Gemini-only 24 domain rules -> GEODEMA
MATCH -> GLOBAL (select, default AUTO-EXIT)
AUTO-EXIT (ordered fallback):
   1 Estonia Mieru UDP
   2 Estonia TUIC
   3 GEODEMA provider-only url-test
   4 KYRA provider-only url-test
   5 GIST provider-only url-test
   6 WARP MSK (AWG, last)
GLOBAL also offers GIST-EE manually and one manual REJECT.
```

No visible repeated `REJECT` members inside `AUTO-EXIT`, `ESTONIA` or provider groups. Keep `empty-fallback:REJECT` where applicable as an **empty-member** safety setting; it does **not prove** packets fail closed when all nodes are unhealthy. Preserve `store-selected:false` when the intent is automatic recovery after reboot. No unexpected user-data-plane `DIRECT`; provider `proxy:DIRECT` may remain for control-plane subscription fetch under an explicit, separately evaluated privacy trade-off.

All 24 Gemini rules must be copied exactly from a trusted synthetic/field-tested ruleset, **only** to the named GEODEMA group, before `MATCH,GLOBAL`. Ordinary YouTube/video traffic should default to EE via `GLOBAL`, avoiding unnecessary use of Geodema quota. No blanket `googleapis.com`, `google.com`, `gstatic.com` routing rules in this profile. Four provider identities retained, including manually selectable `GIST-EE`, with names, per-provider HWID/headers, `exclude-filter`, health settings preserved. Actual credentials stay only in a private file.

## 3. Minimal valuable improvements (candidate order)

**P0 — clear outcome + negative regressions (cheap):**
1. Profile safety hints for `vps-gateway`: cannot infer actual `gvisor` vs `mips`, host DNS/resolved, table100 rules, firewall, watchdog, and correct Linux runtime from a purely browser-generated YAML. Show prominent **"template, not live migration"** notice.
2. Profile switch matrix must continue to pass `router → vps-gateway` and `vps-local → vps-gateway`, with loopback controller / TUN `tun-mihomo` / DNS hijack. No implicit LAN exposure. Existing [deployment profile test contract](../DEPLOYMENT-PROFILES-TEST-CONTRACT.md) is binding.
3. User guidance on **two different REJECT concepts** and preservation of intended user egress no-DIRECT; no blanket removal of `empty-fallback:REJECT`.

**P1 — functional Builder gaps (requires feasibility+owner GO):**
4. Domain policy can target **one named provider-only group**, not only the merged SELECT/GLOBAL/REJECT choices. Prove Gemini to GEODEMA exclusively and priority before `MATCH`.
5. Build an **operator-defined ordered fallback** with per-tier single direct node or provider-only `use:` group, preserve order with manual `GLOBAL` default/override and no forced fastest sorting. Keep `GIST-EE` manual without adding it to AUTO-EXIT.
6. Preserve Mieru **UDP/TCP + port-range** and complete AWG v3 option payload during import/build/re-edit, with opaque `i1` treated as secret and no data loss. Allow warning on transport changes across versions instead of guessing correct transport. Support custom stable names and per-provider settings without silently collapsing groups.
7. Local redacted **before/after structural diff** between imported working YAML and generated candidate, with `NOT YET REPRODUCIBLE` on unsupported/proven-lost parts; do not rewrite imported live config in-place. This may be better served by existing source-preserving Config Studio instead of a new universal Builder.

**Explicit non-goals:** no rewriting the entire Builder, no central VPS control plane, no automatic SSH/Apply, no forced conversion of every Mieru TCP instance to UDP, no "REJECT everywhere" blanket template change, no handling of user secrets in GitHub fixtures. Use [issue #278](https://github.com/saymer-alt/link-generators/issues/278) and cost/benefit [#282](https://github.com/saymer-alt/link-generators/issues/282), [#292](https://github.com/saymer-alt/link-generators/issues/292).

## 4. Test matrix — synthetic inputs only

| Test | Positive proof | Negative / STOP |
| --- | --- | --- |
| Profile | vps-gateway has loopback API, TUN name/auto-route and DNS hijack | Router profile or `0.0.0.0:9090`+null secret must never be silently passed off as reviewed MSK gateway |
| Mieru | Synthetic UDP Mieru with port-range remains UDP through Build/export/import | Input TCP accidentally changed to UDP, or UDP to TCP, without user intent: FAIL or explicit diff |
| Ordered selector | `GLOBAL.now`→`AUTO-EXIT`; health selects first **alive** tier, not lowest latency | `MATCH` bypasses GLOBAL manual override; saved stale selection overrides intended default; accidental fastest pooling |
| Gemini | 24 targeted rules route to GEODEMA only, before MATCH | Wide Google/YouTube catch-all; fallback to unrelated provider on no GEODEMA |
| Providers | 4 distinct identities, correct `use`, exact filters/headers preserved locally | Merging providers, losing `exclude-filter`, stripping custom header or leaking tokens into logs |
| Safety | One manual REJECT, empty fallback handling explicit, end-user no-DIRECT policy | Repeated visible REJECT inside nested groups; all-unhealthy silently COMPATIBLE/DIRECT; claim fail-closed from syntax alone |
| WG/AWG | Identity fields incl long synthetic `i1` roundtrip lossless; version-gated Mihomo checks | Truncated I1, mismatched keypair/obfuscation tuple, unsupported field silently discarded |
| Deploy instructions | Actual file exists, nonempty, `mihomo -t` on exact path, runtime process PID changes, network invariants rechecked | Missing candidate creates initial config but reports success, old process misreported as current candidate, logs from old PID treated as new errors |

**Evidence levels:** static YAML parity/CI ≠ Mihomo binary `-t` ≠ live group health ≠ actual AWG-client TCP+UDP ≠ controlled total-outage no-leak. Label each separately.

**Next:** decide the smallest slice after current Builder/core priorities, then PR with negative tests and pinned Mihomo 1.19.33 compatibility. This note itself does not implement these capabilities. Related field report: [VPS Gateway PR #66](https://github.com/saymer-alt/vps-gateway-bootstrap/pull/66).
