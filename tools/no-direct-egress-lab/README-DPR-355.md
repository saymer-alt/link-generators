# Provider-only DPR runtime-proof (#355) — contained netns scenario

Test-only addition to the #338 no-direct-egress lab. Proves at **network
endpoints** (not YAML or `mihomo -t`) the strict provider-only DPR semantics
from #352 (issue #351): a domain policy built with target `PROVIDER:<A>`
egresses **only** through provider A's nodes; when A is all-unhealthy or
empty the policy fails closed — never via the healthy provider B, never
directly with the VPS IP.

## Dependencies (explicit)

- **#338 lab** (`lib/netns.sh`, `lib/verdict.sh`, `dest.mjs`, `test-guards.sh`)
  was merged into `main` at `cf44e5318f01def5469cccc330240f715213d837`.
  This scenario reuses its verified namespace-inode isolation gate, unnamed
  child namespaces, ownership-checked cleanup and fail-closed verdict.
- **#352 DPR code** in the CURRENT checkout: `gen-dpr.mjs` extracts the exact
  `applyDprProviderTargets` post-patch from `index.html` by its DPT markers
  (same code the browser runs) and applies it to engine output, so the tested
  YAML is the actual #352 build pipeline, not a hand-written stand-in.

Tested YAML provenance: engine `web4core.runtime.js` (in-tree) → DPR card as
SELECT placeholder → `applyDprProviderTargets` → verified `GEMINI-AUTO`
with `use:[A]`, `empty-fallback: REJECT`, rule `RULE-SET,policy-gemini,
GEMINI-AUTO`, `MATCH,GLOBAL` last (asserted statically in `gen-dpr.mjs`).

## Scenario files

- `gen-dpr.mjs` — builds the actual #352 config for two synthetic provider
  URLs (`http://10.210.0.1:8097/sub-a`, `/sub-b`) + one DPR policy
  (`dpr-gemini.lab`); asserts the provider-only contract statically. One
  clearly marked LAB-ONLY rewrite: the pinned gstatic health-check URL
  (`https://www.gstatic.com/generate_204`, 4 occurrences, count asserted)
  → `http://10.210.0.1:8097/hc204`, because the lab is offline by design —
  routing semantics (groups, `use:`, rules, `empty-fallback`) are untouched.
- `dpr-sub.mjs` — stateful provider-payload server (:8097): `/sub-a` serves a
  live node (root-ns stand-in, exit `10.210.0.1`), a dead node
  (`192.0.2.9`, TEST-NET-1) or an empty payload, switched per scenario by a
  mode file; `/sub-b` always serves the live egress node (`10.211.0.2`);
  `/hc204` answers exactly 204 (health-check stand-in).
- `dpr-provider-runtime.sh` — the scenario (same containment model as
  `lab.sh`: private-namespace gate as first side effect, unnamed children,
  PID/marker ownership, no host mutations, fail-closed verdict).

Observable user-plane exits for a GEMINI-domain request:
`10.210.0.1` (via provider A node) / `10.211.0.2` (via provider B node) /
`10.210.0.3` (direct VPS IP — terminal verdict failure).

## Matrix

| Case | Expectation |
|---|---|
| P1: A healthy, B healthy | GEMINI exits **only** via A (`10.210.0.1`); `MATCH,GLOBAL` control path via B intact |
| N1: A exists, all its nodes unhealthy (dead payload + provider refresh) | GEMINI request fails closed (client error), **zero** endpoint hits on the probe path from ANY source; B control intact |
| R1: A recovers (live payload + provider refresh + group re-test) | GEMINI via A again |
| N2: A EMPTY at cold start | fail-closed (empty-fallback REJECT semantics), zero hits; B control intact |
| N3: cold start with A all-unhealthy | fail-closed, zero hits; B control intact |

Mandatory selftest: an artificial direct request from the vps namespace must
be observed on the endpoint (`/selftest-direct`) before any verdict is
trusted. Negative cases are asserted ON THE ENDPOINT LOG: the probe path must
have ZERO hits from any source (A node, B node, direct) while the client
received an error — a hit via B (`10.211.0.2`) or direct (`10.210.0.3`) is a
FAIL. The #338 leak criterion (non-selftest dest hits with the VPS IP) stays
armed for the whole run.

## Run

```bash
MIHOMO_BIN=/absolute/mihomo(>=1.19.31) \
JS_YAML_PATH=/absolute/js-yaml.js \
bash tools/no-direct-egress-lab/dpr-provider-runtime.sh
```

Requires root, Linux netns (WSL2 works), `unshare`, node. Not run in CI
(isolated network by contract). Run from a Linux-native filesystem; a fresh
`node` needs ~2s to listen — the script waits for service readiness.

## Observed runtime semantics (INFO, 1.19.31/1.19.33)

- `empty-fallback: REJECT` applies to an EMPTY group (zero nodes, N2); with a
  present-but-unhealthy node the observed failure is the dial error of the
  only provider node (N1/N3) — both fail closed, neither exits via B/direct.
- After a provider refresh the provider-only `url-test` group may keep dialing
  its previously chosen (removed, dead) node until the next group test — the
  health-check interval (300s in this config) or an API-triggered re-test
  (`GET /group/<name>/delay`). R1 triggers the re-test to keep the run bounded.


Tested network-level evidence in Issue #355 was collected against DPR #352
head `af8a5f6bb9bda10497447cfd65e16a0bf24923b5` and the older #338
lab. This branch has now been reconciled with the #338 merge and the newer
#352 head `3da32d06fee5d570fba27dd133a5d122d588700b`.
Its CI validates the combined source; **the privileged netns runtime matrix is
not rerun by GitHub Actions**. Previous runtime evidence and its exact
tested source SHAs remain explicitly distinguishable from the new CI head.

## Boundaries

Same as the #338 lab: no proof of host firewall/PBR/NAT, real TUN, real
clients or real VPS — separate packet-path/field stage (BLOCKED until owner
GO). No merge/promotion without a separate owner GO.
