# AGENTS.md — link-generators

## Addendum: automatic whitelist mode

See [docs/AUTO-WHITELIST.md](docs/AUTO-WHITELIST.md). UI policy remains here;
generic `fallbackInput` and flat primary/fallback GLOBAL live in the fork. Absence of
`fallbackInput` preserves the previous output. `tests/whitelist.cjs`,
baseline, real Mihomo -t, and `tests/mihomo-failover.cjs` are mandatory; the source suite includes `mihomo-priority.test.mjs`.

Instructions for AI agents (primarily ZCode) working in this repository.
There are three documentation layers: **README.md** — user-facing landing page (what it is and
how to use it), **docs/** — detailed technical knowledge base (architecture, dataflow,
protocols, validation, runtime updates, testing), **this file** — agent rules.
If they disagree, trust the code; fix documentation that disagrees with code, and change code
only for an explicit owner task.

## What this is

A static single-page web tool, "WARP & Mihomo Unified Generator", published
on GitHub Pages: https://saymer-alt.github.io/link-generators/ . Everything runs client-side:
two tabs — a generator for WARP `masque://` links and a `config.yaml` builder for Mihomo.

What the project DOES NOT have (do not invent it): an application build system, package.json,
application npm dependencies, a linter, or a backend. Since 2026-09-15 there are Node regression tests
in `tests/`; a runtime test also runs in the auto-update workflow.
Every push to `main` is published to Pages immediately — "main = production".

The project language is Russian (UI, comments, documentation). Code style: everything inline in one
HTML file, compact hand-written JS without frameworks, section-marker comments like
`// === SECTION ===`.

## Repository contents (all files)

| File | Role | Edit |
|---|---|---|
| `index.html` | Entire application: inline CSS + inline JS; the only page | Yes — primary file |
| `web4core.runtime.js` | Vendored build artifact from saymer-alt/web4core@link-generators | NO — see below |
| `tests/` | Node/browser regression tests and fixtures | Yes — in sync with the contracts they verify |
| `docs/` | Internal knowledge base: ARCHITECTURE, DATAFLOW, MIHOMO, PROTOCOLS, VALIDATION, UPDATES, DEVELOPMENT, TESTING | Yes — in sync with behavior changes |
| `.github/workflows/update-web4core-runtime.yml` | Runtime auto-update | Carefully: it is allowed to write to `main` |
| `README.md` | User-facing landing page (rewritten 2026-09-08) | Yes, but do not silently rewrite it |
| `.nojekyll` | Disables Jekyll processing on Pages | Do not touch |
| `LICENSE` | BSD-3-Clause (inherited from web4core) | Do not touch |

Historical: `mihomo.html` (a byte-for-byte copy of `index.html` under a second URL) was removed
on 2026-09-08 (e2cd5a9) as an unused artifact — do not restore it; `/mihomo.html`
returns 404 on Pages, as expected.

## Architecture: where each piece of logic lives

This repository is the **UI/browser layer**. The protocol engine lives in
`saymer-alt/web4core:link-generators`; the runtime is built from our fork.
Do not duplicate new parsers/builders or shared protocol semantics in `index.html`.
Keep UI-specific normalization/post-processing here only when it belongs to the form,
UX, or deployment profile; do not move existing AWG wrappers opportunistically.
New outbound validation usually affects both repositories.

Validator, README, and docs must describe only real end-to-end support:
a recognized URI or an allowed YAML type alone does not prove that it works.
The complete map, layer-selection rules, and workflow for future agents are in `docs/WEB4CORE-FORK.md`.
Before making a change, read AGENTS in both repositories, check branch/remotes/status,
and determine scope; afterwards run tests/build, runtime comparison, and review before commit/push.
The workflow must remain reproducible and fail-closed: do not ignore checkout/build/test failures,
do not copy an unverified runtime, and do not force-push.

### Tab 1 "WARP MASQUE Links" — all logic is inline in `index.html`

- `parseYaml()` — imports a YAML config from the Telegram bot: `jsyaml.loadAll` over all documents,
  finds `proxies[0]` or an object with a `private-key`/`privateKey` key; rejects input without
  `private-key`. Fills form fields (privateKey, publicKey, ip, ipv6, sni, dns).
- `generateWarp()` — generates pairs of QUIC + H2 links. These are NOT random numbers, but a tuned
  anti-DPI strategy (marked in code with comments "P.1/P.2/P.3") — see "DPI strategy".
- `sendToMihomo()` — moves generated links into tab 2 and triggers an automatic build.
- `js-yaml@4.1.0` loads from the jsdelivr CDN — the page's only external network dependency.

### Tab 2 "Mihomo Config Builder" — runtime wrapper + page-specific layers

Link parsing and YAML generation live in `web4core.runtime.js`; `index.html` builds the request,
calls the API, and adds its own layers on top of the result:

- `buildMihomo()` → `globalThis.web4core.buildFromRequest({ core: 'mihomo', input, wgBeans, options })`.
- WG/AWG files (`.conf`, `.wg`, `.awg`, multiple) → `web4core.parseWireGuardConf(text, filename)` → `wgBeans` array.
- Health-check endpoint list → `web4core.URLTEST_CHOICES` (Google/Cloudflare/Apple/Microsoft/Ubuntu/Fedora;
  fallback — Google generate_204).
- Page options → `options` fields: `addSocks` (mixed-port 7890), `addTun`, `webUI`,
  `urlTest`, `mihomoSubscriptionMode`, `mihomoPerProxyTun`, `mihomoTunStack`, `perProxyPort`,
  `excludeFilter` (Sub Mode only; empty → previous output),
  `webUiDashboard`/`webUiCustomUrl` (external-ui-url dashboard selection: the metacubexd default
  preserves byte parity; custom requires an absolute http/https URL).
  `mihomoRealityModernHosts` (selective Modern REALITY: `[{host, port?}]` from multiline field
  `realityModernInput`; empty -> legacy byte parity; invalid lines are skipped with a non-blocking
  warning; X25519MLKEM768 appeared in Xray v25.5.16; use only for servers with confirmed
  compatibility, without a blanket compatibility promise for all Xray >= v25.5.16 versions).
- Option dependencies (group "Advanced mode: separate inbound for each proxy"):
  the advanced master switch (`cfgPerProxyMaster`, OFF by default) is mandatory for both children;
  MIPS (`cfgTunMips`) and "TUN for each proxy" (`cfgPerProxyTun`) require `cfgTun`;
  "SOCKS port for each proxy" (`cfgPerProxySocks`) requires `cfgSocks`; disabling
  the parent disables and resets the dependent option (`updateMihomoOptionStates()`).
  `buildMihomo()` does not trust the DOM and clamps the same dependencies again
  (including the master): `addTun=false` → `mihomoPerProxyTun=false` and
  `mihomoTunStack=gvisor`; `addSocks=false` → `perProxyPort=false`.
- In per-proxy mode, the runtime adds the hidden url-test group "🌐 static-health"
  (`hidden: true`, `lazy: false`) over static leaves: without it, static proxies have no health check
  (upstream regression a0859bf); providers are checked by their own mechanisms.
- The "Allow LAN" checkbox is post-processing: regex patch `allow-lan: false → true` plus insertion
  of `bind-address: "*"` AFTER the runtime returns the YAML string. The patch depends on
  the exact YAML text format generated by the runtime.
- Page-specific layer (not runtime), added locally:
  - **AWG compatibility**: `normalizeWgText` (range `PersistentKeepalive = 25-35` →
    scalar and boolean `RandomTrailers`/`DisableCookies = on|off` → `1|0` BEFORE parsing —
    official AWG 3.1 literal formats; also removes UTF-8 BOM), `normalizeWgBeans`
    (automatically `version: 3` when AWG 3.x fields are present — otherwise Mihomo silently uses
    the legacy engine; range strings for Mihomo int fields `jc/jmin/jmax/s1-s4/itime` —
    `AWG_INT_KEYS` — collapse to the lower bound, otherwise decoding the entire config fails),
    `injectWgDns` (dns/`remote-dns-resolve` for WireGuard proxies from the
    "WireGuard DNS" field; re-dump only with `jsyaml.dump(..., { lineWidth: -1 })`, otherwise
    long base64 strings wrap). AWG value formats and the Mihomo version matrix are in
    docs/PROTOCOLS.md.
  - **DNS protection**: DNS `100.64.0.1` (Amnezia Premium) → automatically replace with
    `1.1.1.1, 8.8.8.8` and show a warning.
  - **Pre-copy validator**: after Build Config, final YAML passes through
    `validateMihomoYaml()` — state machine NOT_BUILT→VALIDATING→VALID/INVALID,
    generation counter prevents races, Copy YAML is blocked when INVALID. Enum lists
    of types/groups are verified against Mihomo v1.19.x sources. Details:
    docs/VALIDATION.md and docs/TESTING.md.

The runtime additionally supports building for sing-box and xray (`buildSingBox*`, `buildXray*`)
and other exports (`buildBeansFromInput`, `validateBean`, `computeTag`,
`getAllowedCoreProtocols`, `fetchSubscription`, `buildMihomoYaml`, …) — the page does not
use them, but they are part of the public `globalThis.web4core` API.

### File relationships

`index.html` (the only page) loads `./web4core.runtime.js` as a normal
(classic) `<script>`, not a module, so the page also works with `file://`. If
the runtime does not load, all builder actions show the toast "web4core.runtime is not loaded".

## web4core.runtime.js — generated file, never edit by hand

MIPS is implemented in the real fork sources `saymer-alt/web4core`, branch
`link-generators`: `src/build.js` passes `options.mihomoTunStack`,
`src/core/yaml.js` normalizes `opts.tun.stack` and uses it for regular TUN
and Per-Proxy listeners. Only exact `mips` enables MIPS; fallback is `gvisor`.

This is an IIFE bundle from the fork's standard esbuild build (`npm ci && npm run build:web:runtime`,
Node 22). Never edit `web4core.runtime.js` by hand: it must be reproducible
from fork sources. The textual bundle patch has been removed. Parsing/emission changes belong
in the fork source branch within approved scope; an upstream PR is preferred for shared fixes,
while a wrapper in `index.html` remains an option for input/output adaptations.
New protocols require a separate owner task. Details: `docs/UPDATES.md`.

The bundle has a single export point at the end: `globalThis.web4core = { … }`.

## GitHub Actions: runtime auto-update

`.github/workflows/update-web4core-runtime.yml`: push to `main`, weekly
cron `17 4 * * 1`, manual dispatch. Checkout this repo and
`saymer-alt/web4core@link-generators` → Node 22 → npm ci → source Mihomo tests
→ upstream build command → node --check → tests/runtime.cjs → artifact.
Build and tests run with `contents: read`, without persisted Git credentials.
A separate fresh job with `contents: write` only compares/copies the runtime and, if
different, creates "Update web4core runtime from upstream" in `main`. Artifact code
is not executed there. If main changes after verification, it fails; force-push is forbidden.
Upstream synchronization into the custom branch is a controlled merge with review and tests,
not an automatic merge of external code (see `docs/UPDATES.md`).

Consequences for the agent:
- every push to `main` triggers this workflow (even if the runtime did not change — then
  it completes without a commit);
- shortly after your push to `main`, a bot commit may appear changing only
  `web4core.runtime.js` — this is normal, do not revert it;
- a runtime update can change parsing/build behavior without changing `index.html` —
  after auto-update, the page should be manually checked (especially the allow-lan
  regex patch).

## README and code: source of truth

Historical note: README once described three tabs, a "Warpscout Parser", and
"WARP-in-WARP" mode (checkbox + `dialer-proxy`). These features were added to
`index.html` on 2026-08-19 and removed the same evening — the page returned to
the two-tab version; do not restore them (see rules below). On 2026-09-08,
README was rewritten as a user-facing landing page; detailed technical documentation
lives in `docs/`, and agent rules live in this file.

Principle: CODE is the source of truth. If README disagrees with code, README is stale,
not the code. Rules:

- current code has NO warpscout parser, `warpscout-account.json`, WARP-in-WARP checkbox,
  or `dialer-proxy` (0 occurrences in HTML and runtime). Do not "restore" them
  independently — not from the old README and not from Git history (revisions ed835e8/74a3f24);
- if the task says "fix/restore warpscout", stop and clarify with the owner whether it should
  actually be restored or the request is stale;
- code changes that alter the set of tabs/features must include a synchronized README update;
- the page currently supports only YAML import from the Telegram bot (`parseYaml`); it does
  not parse raw warpscout logs.

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
subscription (in Sub Mode — proxy-providers with 43200 s refresh and fallback retries);
a URL with credentials is treated as a normal link. `fetchSubscription` in the browser is
subject to CORS — only sources returning CORS headers work; this is a platform limitation,
not a bug.

### WireGuard / AmneziaWG

Files `.conf` / `.wg` / `.awg` are parsed client-side by
`parseWireGuardConf(text, fileName)`.
AmneziaWG format (`Jc/Jmin/Jmax/…` parameters) is supported by the runtime.

### buildFromRequest contract

`buildFromRequest({ core, input, wgBeans, options })` → `{ kind: "yaml", data: <string> }`.
Mihomo core defaults: `webUI=true`, `addSocks=true`, `addTun=false`; at least one
inbound (TUN or SOCKS) is required, otherwise error "Mihomo: enable at least one inbound".
Empty input with empty wgBeans → error "No valid links or profiles provided".

### "VPS Gateway" deployment profile (opt-in, 2026-09-09)

Additional post-processing scenario for amnezia-mihomo-gateway (the Mihomo half of
the gateway config). Details: docs/VPS-GATEWAY.md. Invariants that must not be violated:

- selector `#cfgProfile` defaults to `generic`; when `generic`, function
  `applyDeploymentProfile()` is NOT called (guard in `buildMihomo()`) — output stays
  byte-for-byte identical to the previous behavior, without extra `jsyaml.load/dump`;
- `tun.auto-route: false` is a hard invariant and is not configurable in the UI;
- profile defaults = variables from the current amnezia-mihomo-gateway `install.sh`
  (`PROXY_IF`/`TUN_INET_ADDR`/`FAKE_IP_RANGE`, package v2.0); anchor is constant
  `VPS_GATEWAY_DEFAULTS` in `index.html`; synchronize it when the gateway repo changes;
- the DNS block exists only inside the vps profile (sub-toggle `#vpsDnsEnabled`);
  disabling it removes `dns` entirely; generic never gets `dns`;
- post-processing order: `injectWgDns` → `applyDeploymentProfile` (vps only) →
  allow-lan regex patch; re-dump only with
  `jsyaml.dump(doc, { lineWidth: -1 })`;
- the Linux side of the gateway (policy routing, iptables, Docker, AWG, systemd, watchdog)
  is not generated here — that belongs to amnezia-mihomo-gateway.

## Change rules

1. Before changing generation logic (links, YAML, parsing), first understand the
   existing format and contracts above; do not change behavior "for improvement" without
   a task for it. Users paste generated link/YAML formats into their routers —
   silent changes break other people's configs.
2. Edit `index.html` — it is the only application page (the historical mirror
   `mihomo.html` was removed; see the file table above).
3. Never edit `web4core.runtime.js` by hand (auto-update will overwrite it).
4. Keep diffs minimal; do not reformat untouched sections; preserve the existing
   inline style and Russian UI text. Do not introduce a build system, npm, ES modules,
   or frameworks — classic `<script>` and `file://` operation are features.
5. Do not change DOM element IDs (`mihomoInput`, `cfgLan`, `pingSelect`, …) without
   updating JS at the same time — all bindings are by ID.
6. New build functionality must use public `globalThis.web4core` API or result
   post-processing; runtime changes belong in fork sources within approved scope.
7. Commit only targeted changes; before committing, check `git status` / `git diff`:
   the diff must contain nothing except the intended change (especially no accidental
   changes to `web4core.runtime.js`).

## Checks after changing HTML/JS

Automated regressions: `node tests/runtime.cjs` and the external Playwright run
`tests/browser.cjs` (details: docs/TESTING.md). Additional checks:

1. JS syntax: extract the inline script from `index.html` (contents of the last
   `<script>…</script>` tag) and run it through a parser; on hosts with Node use
   `node --check` (including for `web4core.runtime.js`).
2. Manual browser run (opening `index.html` directly via `file://` works;
   js-yaml from CDN requires Internet): both tabs; full flow — paste YAML →
   "Parse" → "Generate" → "To Mihomo Builder" → "Build Config" → validation →
   Copy; verify the expected options (allow-lan, mixed-port, TUN) are reflected.
3. Validator regression minimum: `transport: TPC` → INVALID and Copy blocked,
   `TCP` → VALID; AWG 3.1 `.conf` → VALID (`version: 3` in YAML); any input change
   resets validation state.
4. After push: check the live page https://saymer-alt.github.io/link-generators/ and
   (if a runtime bot commit arrived) repeat the manual run — especially the allow-lan
   patch and validator enum lists (docs/UPDATES.md).

## Privacy and security

- Users paste secrets here: WARP private/public keys, addresses, SNI. Currently
  the page sends nothing and stores nothing: `index.html` contains no `fetch`,
  `XMLHttpRequest`, `sendBeacon`, `localStorage`, or `sessionStorage` — only clipboard
  writes. It must stay this way: DO NOT add telemetry, analytics, data transmission,
  or persistence of keys.
- Runtime nuance: `web4core.fetchSubscription()` can fetch subscription text from
  the browser and, when direct fetch fails, falls back to the public CORS proxy
  `sub.web2core.workers.dev` (upstream infrastructure). The current UI does NOT call it —
  Mihomo itself fetches subscriptions through `proxy-providers`. Connecting fetchSubscription
  is a decision to disclose the subscription URL to a third party — explicit owner approval
  is required.
- User input is untrusted (bot YAML, links, files): parse inside try/catch and show
  a clear toast error, as currently implemented.
- Be careful with `innerHTML`: `generateWarp()` inserts generated links through
  `innerHTML` (links contain user keys/SNI). Do not expand the existing surface;
  when refactoring, prefer `textContent`.
- Mask/truncate keys in links when quoting them in issues, commit messages, or logs.

## Common dangerous regressions

- Lose URL encoding of base64 keys (`+ / =`) — links become invalid.
- Break IP anti-correlation, move QUIC off port 443, or "simplify" port weights —
  the entire DPI strategy is broken.
- Edit `web4core.runtime.js` by hand — the change silently disappears on the next
  auto-update.
- Do not "restore" removed `mihomo.html` — it was intentionally removed (e2cd5a9);
  `/mihomo.html` returning 404 is expected.
- After updating the runtime or changing the target Mihomo version, re-check validator
  enum lists and the allow-lan patch contract (docs/UPDATES.md).
- After a runtime update, failing to check the allow-lan regex patch can cause a changed
  YAML format to break it silently (replacement simply finds no line).
- Changing checkbox/field defaults — users rely on current values. Defaults
  `cfgTun: checked` (confirmed by owner 2026-09-15) and `cfgTunMips: checked`
  (owner decision 2026-09-16, NIGHT-09; warning nearby says "requires Mihomo
  >= 1.19.31", generation is not blocked) are intentional. `system`/`mixed` are available
  only behind `cfgTunStackAdvanced` (OFF by default; override clears the MIPS checkbox —
  one consistent UI/YAML state). Do not casually change defaults anymore.
- Break TUN/Mixed → child-option dependencies or their fail-safe clamps in `buildMihomo()` —
  impossible DOM states become reachable again; the 256-mask baseline in
  `tests/whitelist.cjs` is normalized by these dependencies, while valid combinations
  outside the matrix (`socks=0+perSocks=1`) are covered by a bypass test.
- Enable VPS Gateway profile by default or call `applyDeploymentProfile()` for
  `generic` — changes the main scenario output (violates the profile's primary invariant).
- Change VPS profile defaults without checking amnezia-mihomo-gateway `install.sh` —
  config stops matching the routing script (the installer overwrites or fails to find
  device/fake-ip-range/inet4-address).
- Forget `lineWidth: -1` in `applyDeploymentProfile()` — jsyaml wraps long AWG
  base64 strings (I1–I5/H) and silently corrupts the config.
- Expand `AWG_INT_KEYS` in `normalizeWgBeans` to string range fields (`h1-h4`,
  `content-padding-addition`, rekey-*/keepalive/max-handshake timers) — Mihomo keeps them
  as strings, and the v3 engine parses "lo-hi" as UintRange: collapsing to a number breaks
  valid ranges (Amnezia Premium writes H1–H4 as ranges).
- "Fix" a non-working AWG 3.1 tunnel in the generator when the device core is older than
  Mihomo 1.19.30 — all 3.1 keys in `amnezia-wg-option` are silently ignored by the core
  (bidirectional `HeaderProtectionKey`/`RandomTrailers` → tunnel will not come up).
  Production runtime (official release, v1.19.30) supports it; start diagnosis with
  `mihomo -v` on the device — the opkg package version may differ from the actual binary
  (update-mihomo.sh replaces the binary directly, bypassing opkg), and `PKG_VERSION` in the
  entware-go Makefile is the upstream sync version, not necessarily production.
- "Restore" warpscout / WARP-in-WARP / `dialer-proxy` — they were intentionally removed
  (2026-08-19), see "README and code".
- Switch runtime loading to ES modules — breaks `file://` opening.

## Technical debt

- Treat technical debt as a separate engineering risk, but do not confuse it with cosmetics, personal style preferences, or merely "ugly" working code.
- For each debt item, provide evidence first and classify its impact: **High** (breakage/security/data-loss risk or blocks operation), **Medium** (impedes development, creates duplication or logic divergence, or materially increases maintenance cost), **Low** (local complexity with little current risk).
- Do not refactor for cleanliness alone. Pay down debt when the benefit and risk reduction justify the change; do not rewrite stable, verified code without a concrete reason.
- Debt fixes must keep minimal scope, preserve existing safety boundaries, and pass the project's normal regression/safety checks. If the fix creates greater risk or new debt, stop and propose a safer alternative.
- If debt is discovered outside the current task, do not silently expand scope: record the finding and recommendation, and implement it only when it is in scope or explicitly approved by the operator.
- If debt is discovered outside the current task, do not change code or documentation solely to record the finding. In the final report, state the location, brief description, evidence, **High / Medium / Low** level, risk, and recommended action. If the finding deserves separate tracking, propose creating a GitHub Issue. Create an Issue, add a `TODO`, or change files to record debt only with explicit operator permission. `TODO (TechDebt ...)` is acceptable when such a comment is within the approved scope and is genuinely needed next to the code.
