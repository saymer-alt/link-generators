# Input formats, protocol and deployment contracts

> **Relocated source guidance (2026-11-07).** Detailed contracts preserved for tasks affecting URI/YAML generation, profiles, subscription handling, Mihomo compatibility or WARP/MASQUE. Verify against current runtime and tests.
> This is **task-scoped reference material**, not the unconditional agent startup file. Binding safety rules in [root AGENTS.md](../../AGENTS.md) and [CONSTITUTION.md](../../CONSTITUTION.md) still apply. The material below preserves all original sections in their former order (except that Markdown relative link targets are rebased for this directory); "this file" in old prose means the former root AGENTS.md.

---

## Input formats and contracts

### MASQUE: generation DPI strategy (load-bearing, do not change "for improvement")

Output link format (parameters and their names are a contract parsed by external importers,
including web4core itself when importing back into tab 2):

```
masque://IP:PORT?sni=…&private-key=…&public-key=…&ip=…&udp=true&remote-dns-resolve=true[&ipv6=…][&dns=…][&network=h2]#NAME
```

- base64 keys must be URL-encoded (`urlEncodeKey`: `+ / =` → `%2B %2F %3D`).
- QUIC: only the fixed pool `162.159.198.2 / 162.159.198.1 / 162.159.199.2`, always port 443.
- H2: IP only from `162.159.198.x / 162.159.199.x` (last octet 1–254).
- H2 ports use weighted random selection. Safe Ports Only (default): 443 (70%), 8443 (20%),
  4443 (5%), 8095 (5%). Full mode adds VPN ports 500/1701/4500 (risk of semantic
  conflict for DPI — therefore disabled by default).
- Anti-correlation: if the H2 port matches the QUIC port, the H2 IP must differ from the QUIC IP.
- Profile names: `PROFILE-QUIC[-N]` (without port) and `PROFILE-H2-<port>[-N]`.
- Field defaults are part of behavior: SNI `4pda.to`, DNS `1.1.1.1,1.0.0.1`, IP `172.16.0.2`,
  profile `WARP-MASQUE`.

### Tab 2 input: links and subscriptions

The runtime parses schemes (SUPPORTED_SCHEMES): `vmess, vless, trojan, anytls, ss, socks,
socks4, socks4a, socks5, socks5h, http, https, hy2, hysteria2, tuic, tt, mieru, mierus,
sdns, masque`. The subscription hint in the UI lists fewer; the actual list is broader.

The Mihomo core accepts (CORE_PROTOCOL_SUPPORT): `vmess, vless, trojan, anytls, ss, socks,
http, hy2, tuic, wireguard, masque, mieru, trusttunnel`.

Subscriptions: an `http(s)://…` line without username/password in the URL is considered a
subscription. In Sub Mode it becomes a proxy-provider (43200 s refresh, fallback retries);
with Sub Mode OFF the page fetches it once at Build (subscription inspection, issue #100,
owner-approved 2026-10-02) and inlines the current nodes as static `proxies:` — the old
behaviour (parsing the URL as a bogus http-proxy) is gone. Fetch failure in OFF mode fails
the build with a clear error; in ON mode the preview is non-fatal.

Subscription inspection privacy/identity contract (binding):

- Device identity (#156): ONE logical generated device = ONE stable identity.
  The active device's `x-hwid` (random 32-hex, cryptographic) is used by browser
  preview AND by every `proxy-provider` header of the generated config (runtime
  option `deviceHwid`, web4core#16). Rebuilding the same logical device keeps the
  identity; a page reload keeps it; renaming Device Model never changes it. A
  different logical device from the same browser gets a different identity only
  through the explicit «➕ Новое устройство» button (registry of devices, switchable
  via `#deviceIdentitySelect` and, since #326, the always-visible header bar
  `#deviceIdentityBar` above the tabs). Full-HWID disclosure (#326): explicit
  local reveal/copy by the user is allowed («👁 Показать HWID» / «📋 Копировать
  HWID» in the header bar; masked `••••••••<last6>` otherwise; reveal resets on
  device switch); automatic disclosure remains forbidden — the value never
  appears in toasts, URL, trace or diagnostics, and the build-fingerprint use
  (`deviceIdentityHwid=` part of `buildStateFingerprint()`, so «Сменить ID»
  honestly marks a previous build STALE) lives in tab memory only and is never
  rendered or serialized. Storage: `localStorage['link-generators.device-identities.v1']`
  (memory-only fallback) — the ONLY new persistent value; migration: the legacy
  `link-generators.subscription-preview-hwid.v1` value becomes the first device's
  identity, the legacy key is never written anymore and is not deleted.
- Preview headers: `x-device-model` = the user's `📱 Device Model` value when
  filled, falling back to `Saymer Link Generators Preview`; the provider-level
  Device Model option is unaffected (same field, different transport). Device
  Model is a human-readable label, never the identity key.
- Header allowlist is exactly `x-hwid` + `x-device-model`, enforced in the runtime and
  again in the worker; arbitrary headers never leave the caller.
- CORS fallback `sub.saymer-87.workers.dev` (owner-controlled, deployed via GitHub Actions): POST JSON `{url, headers}` contract with its
  own allowlist, redirect/timeout/size caps and `Cache-Control: no-store`; legacy
  `GET ?url=` preserved; the runtime degrades POST → GET on legacy deployments.
  Failed fetch chains report BOTH stages honestly: «Direct: <reason>;
  Fallback: <reason>» (web4core#16) — the fallback-stage cause is never silently
  replaced by the direct one; messages contain no URLs or secrets.
- Honest-partial preview contract (#158, v1.10 closure): (R1) lines whose URI
  scheme the parser does not know are dropped by the runtime, but the loss is
  reported via the deterministic marker `# link-generators: preview-partial
  (N skipped; schemes: …)` (web4core#18) and the UI shows «⚠ Preview неполный…»
  pointing to the Runtime Import (#159); only counts and scheme CATEGORY names
  are reported — never dropped content. (R2) a Clash/Mihomo YAML payload is
  detected inside `handleResponse` (web4core#19) and rejected with the explicit
  format error; the UI names the format and directs to the Runtime Import
  instead of a generic network error. The optional names-only Clash YAML
  extraction was deliberately NOT implemented in v1.10 (scope control); see
  docs/research/PREVIEW-RUNTIME-PARITY.md.
- Network only on explicit user action (Build for Sub OFF expansion; the list-fetch button for Sub ON preview); no background polling, no telemetry;
  subscription URLs, bodies and proxy credentials are never stored or logged.
  The server-list preview operation has a bounded budget (60 s total, test-
  overridable `SUBSCRIPTION_PREVIEW_BUDGET_MS`); the mandatory Sub Mode=OFF build
  fetch is deliberately not budgeted.
- Server-list preview operation state model (explicit): IDLE / LOADING / STALE /
  SUCCESS / PARTIAL / FAILED. Loading always terminates (input edits invalidate
  and restore the button immediately); failed subscriptions mean UNKNOWN node
  counts, never a proven 0; a successfully read but empty subscription is an
  empty SUCCESS. Both visual summaries compute one live model: union of the
  manual regex and checkbox selections, counted once.
- `buildMihomo()` is async since inspection: it sets `VALIDATING` before the first await;
  tests must wait for VALID/INVALID, not for state ≠ VALIDATING right after the click.

### WireGuard / AmneziaWG

Files `.conf` / `.wg` / `.awg` are parsed client-side by
`parseWireGuardConf(text, fileName)`.
AmneziaWG format (`Jc/Jmin/Jmax/…` parameters) is supported by the runtime.

### Subscription server list (opt-in, issue #100)

Toggle `cfgServerList` (OFF by default) gates browser-side subscription
inspection. OFF: Build makes zero fetchSubscription calls in Sub Mode ON;
provider YAML is built without network. ON: the explicit «Получить
список» button triggers exactly one inspection per click; results fill a
selectable checkbox list (search, select all/clear all, counters) that
feeds exact-match exclusions into the combined Exclude Filter (OR with
the manual expression, regex-escaped). Selection persists across refresh
(pruned to existing names); changing subscription input invalidates list
and selection (editing the manual filter deliberately does NOT — node
names do not depend on it; both summaries recompute live). Device Model:
user value (if filled) is sent as x-device-model on preview fetches;
fallback is `Saymer Link Generators Preview`. HWID contract (#156): the
active logical-device identity, shared by preview and all providers,
never random-per-request and never rotated by rebuilds.

### Mihomo Runtime Node Import (#159)

Second name source for the SAME exclude-filter model: the actual provider
nodes loaded by the running Mihomo, from `GET /providers/proxies` (never
`/proxies` alone). Three inputs share one canonical parser
`parseMihomoRuntimeProviders`, which retains ONLY safe minimum fields
(provider/proxy names, `type`, `alive`, last `delay`) and discards
server/port/UUID/password/keys/URLs at parse time. Inputs:

- direct controller fetch (address `host:port` or `http(s)://…` normalized,
  optional Bearer secret) — explicit click only, no auto-scan; the request
  goes browser → controller DIRECTLY and must NEVER be routed through the
  project fallback worker (controller credentials and runtime JSON do not
  touch project infrastructure);
- paste JSON; upload `.json`.

Security invariants: controller address and API secret are memory-only for
the tab lifetime (never localStorage/sessionStorage/URLs/diagnostics; the
401 message names auth failure without echoing the secret); runtime JSON is
not persisted; a generic browser network TypeError is reported honestly
with a checklist (listen address / CORS / private-network permission /
secret / do-not-expose-WAN) and must NOT be fabricated as CORS_DENIED or
PERMISSION_DENIED — precise claims only for real HTTP statuses. The importer
is strictly read-only diagnostics: no Mihomo mutations, no API writes, no
YAML rewrites; import alone does not mark the build STALE (controller/secret
inputs are excluded from the build fingerprint), STALE comes only from an
actual filter-selection change. Runtime-only names are tagged in the list;
with both sources present a reconciliation line shows ∩ / preview-only /
runtime-only (evidence for #158; see docs/research/PREVIEW-RUNTIME-PARITY.md).
Regression: `tests/mihomo-runtime-import.cjs`.

### AWG stability policy (#137)

Two explicit user-visible toggles in the WG/AWG section (Builder tab), applied to build-time
bean COPIES (`wgEngineBeans`) — original profiles are never mutated; switching a toggle off
restores the strict contract byte-for-byte. Regression: `tests/awg-stability.cjs`.

- «🛡 Поддерживать AWG-соединение через NAT (keepalive 25 с)» — **DEFAULT ON**, AWG-only
  scope (plain WireGuard is deliberately outside the policy: no existing contract justifies
  extending its semantics). A valid source integer `PersistentKeepalive` (including 0 =
  disabled) is never replaced. Missing/incompatible value (e.g. range `25-35`) → emitted
  `persistent-keepalive: 25` with an `awgFieldReport` trace (`SUPPORTED_NORMALIZED`,
  «explicit user-enabled Mihomo compatibility fallback; fixed 25 не эквивалентен исходной
  random-range semantics»). Toggle OFF → current strict behavior (range not emitted,
  WARN/UNSUPPORTED stays).
- «🧪 Тест обрывов: отключить RandomTrailers» — **DEFAULT OFF**. When ON, AWG profiles with
  `random-trailers: true` get `random-trailers: false` at build time, an explicit red
  warning (controlled diagnostic experiment, NOT a proven universal fix) and an
  `IGNORED_BY_POLICY` trace entry. MTU/PrivateKey/PSK/HPK and unrelated fields are never
  touched by either toggle.

Card notes preview what Build will do with the profile under current toggle state; every
policy change is visible in the existing WG/AWG diagnostic report. No silent mutation.

### buildFromRequest contract

`buildFromRequest({ core, input, wgBeans, options })` → `{ kind: "yaml", data: <string> }`.
Mihomo core defaults: `webUI=true`, `addSocks=true`, `addTun=false`; at least one
inbound (TUN or SOCKS) is required, otherwise error "Mihomo: enable at least one inbound".
Empty input with empty wgBeans → error "No valid links or profiles provided".

### Deployment profiles `router` / `vps-local` / `vps-gateway` (since PR #79, 2026-10-01)

Selector `#cfgProfile` (default `router`) picks one of three user-facing deployment
profiles; the profile drives scenario switches only (TUN/MIPS/Mixed/allow-LAN and the
gateway panel) with fail-safe clamps in `buildMihomo()` and never touches user data
(proxies, subscriptions, WireGuard, filters, dialer-proxy). Details: docs/VPS-GATEWAY.md,
docs/DEPLOYMENT-PROFILES-TEST-CONTRACT.md, user-facing docs/GENERATOR-GUIDE.md.
The `vps-gateway` profile is the Mihomo half of amnezia-mihomo-gateway. Invariants:

- when `router` or `vps-local`, the gateway post-patch (`applyDeploymentProfile()`)
  is NOT called — their output stays byte-for-byte identical to non-profile behaviour
  (the function's internal second argument is still the literal `'vps'`; that is an
  implementation detail meaning "gateway-family patch", not a profile id);

- mandatory regression contract: docs/DEPLOYMENT-PROFILES-TEST-CONTRACT.md;

- `tun.auto-route: false` is a hard invariant and is not configurable in the UI;
- profile defaults = variables from the current amnezia-mihomo-gateway `install.sh`
  (`PROXY_IF`/`TUN_INET_ADDR`/`FAKE_IP_RANGE`, package v2.0); anchor is constant
  `VPS_GATEWAY_DEFAULTS` in `index.html`; synchronize it when the gateway repo changes;
- the DNS block exists only inside the `vps-gateway` profile (sub-toggle `#vpsDnsEnabled`);
  disabling it removes `dns` entirely; `router` and `vps-local` never get `dns`;
- VPS Domain Detection Package (PR #80): when `vps-gateway` DNS is enabled, the
  profile adds `tun.dns-hijack: [any:53, tcp://any:53]`, a passive `sniffer`
  (`override-destination: false`) and `profile.store-fake-ip: true` automatically —
  no UI toggle; with DNS off, hijack/persistence are omitted and the sniffer remains;
- Domain Policy Routing (PR #78, `cfgPolicyRouting`): domain categories → inline
  `rule-providers` (`policy-<slug>`, classical) + category groups + `RULE-SET`
  rules before the unchanged `MATCH,GLOBAL`; HTTP providers carry `proxy: DIRECT`
  (cold-start deadlock otherwise); mode OFF = byte parity. Details: docs/POLICY-ROUTING.md;
- post-processing order: `injectWgDns` → `applyDeploymentProfile` (vps-gateway only) →
  allow-lan regex patch; re-dump only with
  `jsyaml.dump(doc, { lineWidth: -1 })`;
- the Linux side of the gateway (policy routing, iptables, Docker, AWG, systemd, watchdog)
  is not generated here — that belongs to amnezia-mihomo-gateway.

### Mihomo version contract (current)

- **Minimum supported / compatibility floor: Mihomo 1.19.31** (MIPS TUN stack,
  DDP acceptance, combined profile probes);
- **Recommended / current tested: Mihomo 1.19.33** (combined probes green on both
  1.19.31 and 1.19.33; the 1.19.32 *Windows* binary segfault was an upstream build
  anomaly of the previous recommended version, not a project blocker — Linux builds
  are fine);
- feature floors are separate and historical: AWG 3.1 ≥ 1.19.30, `override-expr` ≥ 1.19.29,
  DPR needs ≥ 1.19.27 (empty-fallback) / ≥ 1.19.1 (inline rule-providers);
- dated lab/field records (e.g. docs/AUDIT-MIHOMO-1.19.31.md) remain historical
  evidence — do not rewrite them to claim they ran on a newer version.

