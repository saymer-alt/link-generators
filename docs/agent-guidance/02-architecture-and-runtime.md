# Repository architecture, runtime and source of truth

> **Relocated source guidance (2026-11-07).** Original architecture and past feature decisions. Code is the current source of truth. All inline paths such as `docs/` or `index.html` refer to repository root.
> This is **task-scoped reference material**, not the unconditional agent startup file. Binding safety rules in [root AGENTS.md](../../AGENTS.md) and [CONSTITUTION.md](../../CONSTITUTION.md) still apply. The material below preserves all original sections in their former order (except that Markdown relative link targets are rebased for this directory); "this file" in old prose means the former root AGENTS.md.

---

## What this is

A static web tool, "WARP & Mihomo Unified Generator", published
on GitHub Pages: https://saymer-alt.github.io/link-generators/ . Everything runs client-side:
`index.html` has two tabs — a generator for WARP `masque://` links and a `config.yaml` builder for Mihomo;
`quick-start.html` is a static user help page (plain HTML, readable without JS). Note: `.nojekyll` means
`.md` files are served as raw text on Pages — user-facing help must live in `quick-start.html`, not in Markdown.

What the project DOES NOT have (do not invent it): an application build system, package.json,
application npm dependencies, a linter, or a backend. Since 2026-09-15 there are Node regression tests
in `tests/`; a runtime test also runs in the auto-update workflow.
`main` is the integration/development branch. `stable` is the production channel used for GitHub Pages and released user-facing builds. Changes normally land in `main` first and reach `stable` only by an explicit promotion after CI and the required functional/field checks. Do not develop directly on `stable`.

### Release invariant

For every user-facing release, preserve this order:

1. develop and merge changes into `main`;
2. require green CI on `main` and complete all relevant browser / real-Mihomo / field checks;
3. promote the tested state with a dedicated PR `main → stable` — do not add new functional changes in the promotion PR;
4. require green CI on `stable` and verify the production GitHub Pages deployment;
5. only then create the release tag `vX.Y.Z` on the production commit and publish the GitHub Release.

Never tag or publish a release directly from an unpromoted `main` commit. The release tag must identify the same tested production state that users receive from `stable`.

The project language is Russian (UI, comments, documentation). Code style: everything inline in one
HTML file, compact hand-written JS without frameworks, section-marker comments like
`// === SECTION ===`.

## Repository contents (all files)

| File | Role | Edit |
|---|---|---|
| `index.html` | Main application page: inline CSS + inline JS | Yes — primary file |
| `quick-start.html` | Static user help / quick-start page (no frameworks, no JS required to read); linked from the Builder header | Yes — keep in sync when user-facing features change |
| `web4core.runtime.js` | Vendored build artifact from saymer-alt/web4core@link-generators | NO — see below |
| `tests/` | Node/browser regression tests and fixtures | Yes — in sync with the contracts they verify |
| `docs/` | Internal knowledge base: ARCHITECTURE, DATAFLOW, MIHOMO, PROTOCOLS, VALIDATION, UPDATES, DEVELOPMENT, TESTING | Yes — in sync with behavior changes |
| `.github/workflows/update-web4core-runtime.yml` | Runtime build/validation + auto-update | Carefully: validation runs for `main`/ `stable`, but write-back is allowed only to `main` |
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

- `parseYaml()` — imports a compatible WARP YAML config (Telegram bot, WARPSCOUT, or any
  compatible source; the UI label is source-agnostic): `jsyaml.loadAll` over all documents;
  rejects input without `private-key`. It deliberately imports only the WARP identity/tunnel
  parameters used by the form: `private-key`, `public-key`, `ip`, `ipv6`, `sni`, and `dns`.
- **WARPSCOUT/Mihomo MASQUE import path (v1.9, #125):** when the YAML contains proxies with
  `type: masque`, ALL proxies are scanned — never blind `proxies[0]`, and a non-MASQUE proxy
  is never interpreted as a transport. Network classification fails closed: absent/empty →
  H3/QUIC; `network: h2` (case-insensitive) → H2/TCP; any other non-empty token (`tcp`,
  `h3`, `foo`, …) is an UNSUPPORTED candidate — shown in the banner with proxy name and raw
  token, never imported as an endpoint, never silently treated as H3.
  Each found transport contributes an exact endpoint (`server:port`) and per-transport SNI
  into the «Advanced MASQUE» fields, with an explainability banner («WARPSCOUT / Mihomo
  MASQUE detected») naming what was imported as exact and what stays builtin. Several
  candidates of one transport → an explicit selector by proxy name; silent first-proxy
  selection is forbidden. A transport without a candidate stays fully builtin. Exact
  endpoint/SNI fields are per-config facts: any successful import resets them (together with
  the identity fields); custom port lists are user preferences and survive re-import.
- **MASQUE identity consistency (load-bearing, owner review #134):** the generator holds ONE
  common WARP identity, so the actually selected H3+H2 pair must be compatible in material
  identity fields — `private-key`, `public-key`, `ip`, `ipv6` (when present). An incompatible
  pair is rejected fail-closed BEFORE any import (identity and endpoints are not applied):
  the diagnostic names the conflicting profiles and field names, never secret values; a
  hybrid «identity A + endpoint B» is never created. Consistency is checked after the
  user's actual selection (also through the ambiguity selector); while any transport is
  ambiguous, nothing is applied until the explicit «Импортировать выбранных» click. DNS is
  classified separately: differing DNS values between selected candidates do not reject the
  import but are never chosen silently — an explicit diagnostic names both values and the
  first is imported consciously. Empty candidate SNI is a deliberate fallback: the banner
  states «SNI не задан в candidate → используется общий SNI»; no SNI is ever invented.
  **Private-key provenance (owner review round 2):** the importable pair must carry its OWN
  key — the private-key guard applies to the actually selected supported pair, never to the
  candidate pool; a key sitting in an UNSUPPORTED or unselected candidate never validates a
  supported candidate without its own key, and no identity is taken from outside the
  selected pair. **All-UNSUPPORTED YAML** (no supported H3/H2 candidates at all) fails
  closed with «MASQUE YAML найден, но поддерживаемых H3/H2 кандидатов нет» — unsupported
  names and raw tokens listed, no success toast and no «Заполнено» badge (a fail-closed
  parse also clears a stale badge from a previous import).
- **Per-transport generation precedence (v1.9):** exact imported/manual endpoint → custom
  port list → builtin strategy. Exact endpoints are authoritative and are never rewritten by
  anti-correlation (it only steers generator-selected H2 IPs); a custom port list fully
  replaces the builtin weighted choice for that transport (no hidden mixing); ports are
  integers 1..65535 with trim and dedup, and invalid tokens are explicit errors
  (`443abc` is never coerced to 443). Endpoints accept `IPv4:port` and `hostname:port`;
  IPv6 endpoints are rejected with a clear message (the MASQUE IPv6 contract is unproven —
  do not guess; the WireGuard IPv4-only policy is a WG contract and is not applied to MASQUE).
- **Legacy WARP-bot YAML import contract (load-bearing):** the imported YAML is a source of WARP
  identity/tunnel parameters, **not** a source of transport endpoint selection. Source
  `server`, `port`, and `network` values must not start overriding `generateWarp()`.
  Their current non-use is intentional, not a missing parser feature. `generateWarp()` owns
  endpoint/transport selection and applies the project's tested H3/QUIC + H2/TCP strategy below.
  Do not "fix" this by wiring source endpoints into the existing import path.
  If another source (for example a scanner that has already discovered a specific working
  endpoint) must preserve `server`/`port`/`network`, use the explicit WARPSCOUT/MASQUE
  import path above; it must not silently change the semantics
  of `parseYaml()` or `generateWarp()`.
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
  `excludeFilter` (subscription mode only; empty → previous output),
  `deviceModel` (subscription mode only; optional `x-device-model` provider header; empty → previous output),
  `webUiDashboard`/`webUiCustomUrl` (external-ui-url dashboard selection: the metacubexd default
  preserves byte parity; custom requires an absolute http/https URL).
  User-facing `cfgSubMode` text is **"Использовать URL-подписки"**. Keep the technical name
  "Sub Mode" in code/docs only; do not expose the unexplained jargon as the primary UI label. In normal Builder flow, only ordinary proxy links →
  switch it off; HTTP(S) subscription URLs → keep it on. Mixed input is supported where
  a subscription URL is present.
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
  (`hidden: true, lazy: false`) over static leaves. `lazy: false` is intentional:
  the hidden/unselected checker must keep running scheduled probes; otherwise static
  proxy latency becomes stale after the initial check. Providers are checked by their
  own mechanisms.
- Web UI/controller trust model: the generated `external-controller: 0.0.0.0:9090`
  with an empty `secret:` is intentional for the supported local-router topology.
  The protection boundary is router/network reachability, not an application password;
  wildcard bind alone does NOT prove Internet exposure. Do not add an empty-secret
  warning or present password generation as a security fix unless there is concrete
  evidence that the controller is exposed outside the trusted local boundary (for
  example WAN forwarding, reverse proxy publication, or a custom external topology).
  Optional secret support may be considered separately as a convenience feature.
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
  - **Readonly output UX**: `#mihomoOutput` is deliberately a preview, not a second
    editor. Users change inputs/options and rebuild. If browser validation is VALID but
    real `mihomo -t` rejects the YAML, do not invent a validator rule: require the full
    generated YAML plus full stdout/stderr from `mihomo -t` first, then add only a
    proven structural rule + regression fixture (or document a browser-validation limit).

The runtime additionally supports building for sing-box and xray (`buildSingBox*`, `buildXray*`)
and other exports (`buildBeansFromInput`, `validateBean`, `computeTag`,
`getAllowedCoreProtocols`, `fetchSubscription`, `buildMihomoYaml`, …) — the page does not
use them, but they are part of the public `globalThis.web4core` API.

### File relationships

`index.html` (the main page) loads `./web4core.runtime.js` as a normal
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

`.github/workflows/update-web4core-runtime.yml`: push to `main`/`stable`, weekly
cron `17 4 * * 1`, manual dispatch, and pull requests targeting `main`/`stable`. Checkout this repo and
`saymer-alt/web4core@link-generators` → Node 22 → npm ci → source Mihomo tests
→ upstream build command → node --check → tests/runtime.cjs → artifact.
Build and tests run with `contents: read`, without persisted Git credentials. The build job
also compares the tracked `web4core.runtime.js` with the freshly built runtime from the exact
recorded fork SHA (LF-normalized). A mismatch is a hard failure for PR validation and for
`stable`; on a direct `main` run it is the only case allowed to continue into the write-back job.
A separate fresh job with `contents: write` only compares/copies the already checked runtime and,
if different, creates "Update web4core runtime from upstream" in `main`. Artifact code is not
executed there. If main changes after verification, it fails; force-push is forbidden.
Upstream synchronization into the custom branch is a controlled merge with review and tests,
not an automatic merge of external code (see `docs/UPDATES.md`).

Consequences for the agent:
- pushes/PRs involving `main` or `stable` trigger the read-only runtime build/test job;
- only a `main` run may execute the write-back job and create an updated `web4core.runtime.js` commit; `stable` must never receive an automatic runtime write-back;
- shortly after your push to `main`, a bot commit may appear changing only
  `web4core.runtime.js` — this is normal, do not revert it;
- a runtime update can change parsing/build behavior without changing `index.html` —
  after auto-update, the page should be manually checked (especially the allow-lan
  regex patch).

## README and code: source of truth

Historical note: README once described three tabs, a "Warpscout Parser", and
"WARP-in-WARP" mode (checkbox + `dialer-proxy`). Those were added to
`index.html` on 2026-08-19 and removed the same evening. On 2026-09-08,
README was rewritten as a user-facing landing page; detailed technical documentation
lives in `docs/`, and agent rules live in this file. WARP-in-WARP later returned as a
designed feature (2026-10-01): WireGuard `dialer-proxy` with static member lists,
provider-backed dialer groups, and WireGuard-over-WireGuard chains via the web4core
`analyzeDialerGraph` cycle detector — it must not be removed or treated as the old
accidental experiment.

Principle: CODE is the source of truth. If README disagrees with code, README is stale,
not the code. Rules:

- current code has NO warpscout parser or `warpscout-account.json`. Do not "restore" them
  independently — not from the old README and not from Git history (revisions ed835e8/74a3f24).
  WARP-in-WARP via `dialer-proxy` is a current, supported feature (see above and
  docs/MIHOMO.md for the contract);
- if the task says "fix/restore warpscout", stop and clarify with the owner whether it should
  actually be restored or the request is stale;
- code changes that alter the set of tabs/features must include a synchronized README update;
- the page currently supports YAML identity import through `parseYaml()`. Compatible Mihomo
  YAML emitted by WARPSCOUT can supply the same identity fields, but the page does **not**
  parse raw WARPSCOUT console tables/logs and does not import WARPSCOUT transport endpoints;
- practical WARPSCOUT procedures are documented in `docs/WARPSCOUT-WINDOWS.md`,
  `docs/WARPSCOUT-KEENETIC.md` and `docs/WARPSCOUT-VPS.md`. These docs are operational guidance,
  not evidence that a historical Warpscout Parser UI has been restored.

