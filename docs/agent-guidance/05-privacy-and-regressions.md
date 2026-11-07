# Privacy, security and known regressions

> **Relocated source guidance (2026-11-07).** Read for any task touching input, subscriptions, local identity, controller/API access, generated configs or output. Dated incident examples are historical evidence, not proof of today's runtime.
> This is **task-scoped reference material**, not the unconditional agent startup file. Binding safety rules in [root AGENTS.md](../../AGENTS.md) and [CONSTITUTION.md](../../CONSTITUTION.md) still apply. The material below preserves all original sections in their former order (except that Markdown relative link targets are rebased for this directory); "this file" in old prose means the former root AGENTS.md.

---

## Privacy and security

- Users paste secrets here: WARP private/public keys, addresses, SNI and subscription URLs.
  WARP/WG keys and configs stay local; DO NOT add telemetry or analytics and never persist keys,
  subscription URLs, subscription bodies or proxy credentials.
- Owner-approved subscription inspection (2026-10-02): when Build sees an HTTP(S) subscription,
  the UI may call `web4core.fetchSubscription()` to preview actual node names and, with Sub Mode
  OFF, expand the current subscription snapshot into static proxies. The request is user-triggered
  by Build, never background polling. Direct browser fetch is preferred; when CORS/direct fetch
  fails the runtime may fall back to the owner-controlled proxy `sub.saymer-87.workers.dev`, which necessarily
  discloses the subscription URL to that proxy.
- The only persistent browser values introduced for inspection are the device-identity
  registry (`link-generators.device-identities.v1`, #156) and the legacy read-only
  `link-generators.subscription-preview-hwid.v1` key kept from pre-#156 versions (not
  written anymore, not deleted). The registry is not a key store: it holds one stable
  random 32-hex HWID per logical generated device so that device-limited subscription
  panels see ONE device for preview + all providers of that config, rebuilds do not
  rotate the identity, and genuinely different routers generated from the same browser
  can get distinct identities only via the explicit «➕ Новое устройство» action. The
  preview uses a recognizable generator `x-device-model`; the identity is never derived
  from Device Model. If storage is unavailable (including some `file://` contexts), the
  registry lives in memory only.
- User input is untrusted (bot YAML, links, files): parse inside try/catch and show
  a clear toast error, as currently implemented.
- Treat user-derived WARP values as untrusted text. `generateWarp()` may clear its output
  container with `innerHTML = ''`, but generated labels/links are created with DOM nodes and
  assigned through `textContent`; do not regress this to HTML-string assembly or inline handlers.
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
  (owner decision 2026-09-16, NIGHT-09; the non-blocking Compatibility Summary reports
  the Mihomo >= 1.19.31 requirement after Build) are intentional. `system`/`mixed` are available
  only behind `cfgTunStackAdvanced` (OFF by default; override clears the MIPS checkbox —
  one consistent UI/YAML state). Do not casually change defaults anymore.
- Break TUN/Mixed → child-option dependencies or their fail-safe clamps in `buildMihomo()` —
  impossible DOM states become reachable again; the 256-mask baseline in
  `tests/whitelist.cjs` is normalized by these dependencies, while valid combinations
  outside the matrix (`socks=0+perSocks=1`) are covered by a bypass test.
- Enable the vps-gateway profile by default or call `applyDeploymentProfile()` for
  `router` or `vps-local` — changes the main scenario output (violates the profile's primary invariant).
- Change VPS profile defaults without checking amnezia-mihomo-gateway `install.sh` —
  config stops matching the routing script. The current Mihomo 1.19.31 contract uses the TUN
  device plus `dns.fake-ip-range`; top-level `tun.inet4-address` is intentionally absent.
- Forget `lineWidth: -1` in `applyDeploymentProfile()` — jsyaml wraps long AWG
  base64 strings (I1–I5/H) and silently corrupts the config.
- Expand `AWG_INT_KEYS` in `normalizeWgBeans` to string range fields (`h1-h4`,
  `content-padding-addition`, rekey-*/keepalive/max-handshake timers) — Mihomo keeps them
  as strings, and the v3 engine parses "lo-hi" as UintRange: collapsing to a number breaks
  valid ranges (Amnezia Premium writes H1–H4 as ranges).
- "Fix" a non-working AWG 3.1 tunnel in the generator when the device core is older than
  Mihomo 1.19.30 — all 3.1 keys in `amnezia-wg-option` are silently ignored by the core
  (bidirectional `HeaderProtectionKey`/`RandomTrailers` → tunnel will not come up).
  AWG 3.1 support starts at Mihomo 1.19.30; the project version contract is
  minimum 1.19.31 / recommended-current 1.19.32 (see "Mihomo version contract" above). Start diagnosis with `mihomo -v` on the device — the opkg package
  version may differ from the actual binary
  (update-mihomo.sh replaces the binary directly, bypassing opkg), and `PKG_VERSION` in the
  entware-go Makefile is the upstream sync version, not necessarily production.
- "Remove" WARP-in-WARP / `dialer-proxy` as if it were still the 2026-08 removal —
  it is a full supported feature: since the WG/AWG profile manager (2026-10-01) each
  loaded profile has its own connection mode (direct / via dialer target, bean-level
  `wireguard.dialerProxy` + `wgDialerGroupOnly`), and removing that mechanism would be
  a regression. Only the warpscout parser itself remains deliberately absent.
- Switch runtime loading to ES modules — breaks `file://` opening.

