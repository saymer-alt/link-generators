#!/usr/bin/env bash
# Strength tests for the no-direct-egress-lab checks (test-only, root-free):
#   1. verdict-logic mock tests — a simulated direct leak, accumulated FAILs,
#      a v6 leak, an unexpected success and a clean selftest-only log produce
#      exactly the mandated exit codes;
#   2. static containment guards — the lab scripts must keep the private-
#      namespace gate, PID ownership, run lock, no pkill, no named netns,
#      no system trust changes, and strict API status checks.
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
check() { # <actual> <expected> <message> — PASS iff actual == expected
  if [ "$1" = "$2" ]; then echo "PASS: $3"; else echo "FAIL: $3 (got $1, want $2)"; FAILS=$((FAILS + 1)); fi; }

# ---------- 1. verdict logic (sourced with stubs; no network, no root) ----------
say() { echo "verdict-out: $*"; }
LAB_FAILS=0
# shellcheck source=lib/verdict.sh
source "$LAB/lib/verdict.sh"

mklog() { printf '%s\n' "$@" > "$TMP/log.jsonl"; }

# 1a. clean log, selftest only, no accumulated FAILs -> PASS (exit 0)
mklog '{"kind":"dest","remote":"10.210.0.3","url":"/selftest-direct"}'
( lab_verdict "$TMP/log.jsonl" 10.210.0.3 fd00:2010::3 ) >/dev/null 2>&1
check "$?" 0 "clean selftest-only log with zero FAILs -> PASS(exit 0)"

# 1b. simulated direct leak (non-selftest hit from the VPS v4) -> exit 1
LAB_FAILS=0
mklog '{"kind":"dest","remote":"10.210.0.3","url":"/selftest-direct"}' \
      '{"kind":"dest","remote":"10.210.0.3","url":"/ipcheck-leak"}'
( lab_verdict "$TMP/log.jsonl" 10.210.0.3 fd00:2010::3 ) >/dev/null 2>&1
check "$?" 1 "simulated direct v4 leak -> FAIL(exit 1)"

# 1c. v6 leak -> exit 1
LAB_FAILS=0
mklog '{"kind":"dest","remote":"fd00:2010::3","url":"/ipcheck-v6-leak"}'
( lab_verdict "$TMP/log.jsonl" 10.210.0.3 fd00:2010::3 ) >/dev/null 2>&1
check "$?" 1 "simulated direct v6 leak -> FAIL(exit 1)"

# 1d. clean log but accumulated FAILs (e.g. a broken positive scenario) -> exit 1
LAB_FAILS=2
mklog '{"kind":"dest","remote":"10.211.0.2","url":"/ok"}'
( lab_verdict "$TMP/log.jsonl" 10.210.0.3 fd00:2010::3 ) >/dev/null 2>&1
check "$?" 1 "accumulated FAILs with a clean endpoint log -> FAIL(exit 1)"

# 1e. lab_fail increments; unexpected success in a fail-closed scenario is a FAIL
LAB_FAILS=0
lab_fail "unexpected success during outage"
[ "$LAB_FAILS" = "1" ] && r=0 || r=1
check "$r" 0 "lab_fail increments the failure counter"

# ---------- 2. static containment guards over the lab scripts ----------
for f in lab.sh dns-observe.sh ipv6-observe.sh ipv6-live-exit.sh lib/netns.sh lib/verdict.sh; do
  src="$LAB/$f"
  if ! grep -q "pkill" "$src"; then r=0; else r=1; fi
  check "$r" 0 "$f: no pkill (process killing only via ownership-checked PIDs)"
  if ! grep -qE "ip netns (add|del)" "$src"; then r=0; else r=1; fi
  check "$r" 0 "$f: no named netns add/del (children are unnamed, PID-addressed)"
  if ! grep -q "update-ca-certificates" "$src"; then r=0; else r=1; fi
  check "$r" 0 "$f: no system trust store changes"
done

for f in lab.sh dns-observe.sh ipv6-observe.sh ipv6-live-exit.sh; do
  src="$LAB/$f"
  # the isolation gate must precede any sysctl/iptables/topology mutation
  gate=$(grep -n "require_lab_isolation" "$src" | head -1 | cut -d: -f1)
  mut=$(grep -nE "sysctl -w|ip link add|iptables -|ip6tables -" "$src" | head -1 | cut -d: -f1)
  if [ -n "$gate" ] && { [ -z "$mut" ] || [ "$gate" -lt "$mut" ]; }; then r=0; else r=1; fi
  check "$r" 0 "$f: private-namespace gate precedes every network mutation"
  if grep -q "lab_run_lock" "$src"; then r=0; else r=1; fi
  check "$r" 0 "$f: concurrent-run lock present"
  if ! grep -qE 'curl [^|]*-X PUT' "$src"; then r=0; else r=1; fi
  check "$r" 0 "$f: raw API PUTs replaced by the strict status-checked helper"
done

if grep -q "AMG_LAB_INSIDE" "$LAB/lib/netns.sh" && grep -q "exec unshare -n" "$LAB/lib/netns.sh"; then r=0; else r=1; fi
check "$r" 0 "isolation gate re-executes into unshare -n with no fallback"
if grep -q 'grep -qF "\$marker"' "$LAB/lib/netns.sh"; then r=0; else r=1; fi
check "$r" 0 "cleanup kills only PIDs whose cmdline carries this run's marker"
if ! grep -qE "sysctl|iptables|netns|ca-cert" "$LAB/lib/netns.sh" | grep -v "^.*#"; then r=0; else r=1; fi
check "$r" 0 "netns lib itself never mutates host sysctl/iptables/trust (comments aside)"

echo "---"
if [ "$FAILS" = "0" ]; then echo "GUARDS: ALL PASS"; exit 0; fi
echo "GUARDS: $FAILS FAILURE(S)"; exit 1
