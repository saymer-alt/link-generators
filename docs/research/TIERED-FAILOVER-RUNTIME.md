# Tiered Failover runtime research (#148, NIGHT-01)

Status: research document. Runtime evidence for the strict-tier contract on real
local Mihomo binaries. Harness: `tests/tiered-failover-runtime.cjs` (deterministic:
mock HTTP CONNECT outbounds, local health responder, file provider; no external
endpoints, no real credentials). Evidence JSON: `tiered-evidence.json` in the
test output dir.

## Versions tested

| Binary | Result |
|---|---|
| Mihomo v1.19.31 (windows amd64, with_gvisor) | ALL scenarios PASS |
| Mihomo v1.19.32 (windows amd64, with_gvisor) | ALL scenarios PASS |

Upstream latest at test time = v1.19.32 → the project matrix covers latest.

## Topology

```text
ROOT (fallback) → T1 (url-test [T1A, T1B]) → T2 (fallback [T2A, T2B]) → T3 (url-test [T3A])
```

Variants: session 2 — `T1 = fallback` (nested fallback → fallback → proxy);
session 3 — `T2` backed by a file proxy-provider (`use:`). All group probes:
`interval: 1s, timeout: 500ms, lazy: false`, local HTTP health responder.
Traffic probe: real request through the mixed port; the serving leaf is
identified by its response body.

## Scenarios and results (automatic health checks only)

| Scenario | Contract | 1.19.31 | 1.19.32 | Evidence |
|---|---|---|---|---|
| A. Strict priority | T1 alive, T2 alive → traffic stays in T1 | PASS | PASS | ROOT.now = T1 |
| **B. Partial Tier-1 failure** | T1A dead, T1B alive → **stay in Tier 1**, switch to T1B | **PASS** | **PASS** | ROOT.now = T1 |
| C. Total Tier-1 failure | all T1 dead → ROOT moves to T2 | PASS | PASS | ROOT.now = T2 |
| D. Failback | T1 recovered → ROOT returns to T1 automatically | PASS | PASS | ~1.0–1.7 s after recovery |
| E1. Provider tier baseline | provider-backed T2 serves when T1 dead | PASS | PASS | |
| E2. Provider partial failure | one provider node dead → tier stays, second node serves | PASS | PASS | |
| E3. Provider refresh | payload rewritten + PUT refresh → contract holds | PASS | PASS | refresh accepted |
| F1. nested fallback→fallback, partial | root stays on live child | PASS | PASS | |
| F2. nested fallback→fallback, total | root moves to next tier | PASS | PASS | |
| F3. nested recovery | root returns automatically | PASS | PASS | |
| H. Restart | fresh process re-probes and re-selects the expected tier | PASS | PASS | `store-selected: false` → no sticky state |

Measured timing (1 s interval, 500 ms timeout; single-run samples, not SLA):
partial-failure detection + switch ≈ **3–12 s** (dominated by the child
url-test re-selection + root probe cycle); total-failure switch ≈ **2–3 s**;
failback ≈ **1.0–1.7 s**. These are orders of magnitude for documentation —
not SLA guarantees.

## The nested-group trap (upstream #2588 class)

The repository already carries a reproduction: `tests/mihomo-failover.cjs
--nested-repro` proves that a root `fallback` can keep serving the next tier
while the nested child still has a live selected member — **when the cached
alive state is poisoned by a manual probe and the root's own interval is long
(in the repro: 3600 s)**.

Boundary established by this lab: with **automatic health checks and short
intervals** (the shape the generated Tiered Failover config uses), the strict
tier contract held in every automatic scenario above, including recovery.
Known residual risk (documented, not silently mitigated): external manual
controller probes (`/group/:name/delay`, `/proxies/:name/delay`) can poison
the cached alive flag until the next scheduled probe; a monitoring setup that
probes groups manually can therefore cause tier flapping. The generator does
not emit anything that performs manual probes.

## Boundaries (no false claims)

- Health semantics proven for **HTTP(S) probes over TCP only**. UDP behaviour
  is explicitly NOT RUNTIME-PROVEN (UNKNOWN).
- `mihomo -t` acceptance is syntax/schema only (covered separately by the
  generated-fixture matrix); runtime semantics come from this harness.
- Manual `select` overrides and `store-selected: true` stickiness are outside
  the auto contract (G) — tested only as `store-selected: false`.

## Verdict for #148

**PATH A (native nested groups) is runtime-proven** for the strict tier
contract in automatic mode on both supported Mihomo versions. The generator
may build `ROOT fallback → tier groups → members/providers` directly.
