#!/usr/bin/env bash
# Lab verdict helpers (no-direct-egress-lab, #284).
#
# Fail-closed bookkeeping: EVERY unmet mandatory condition — a failed
# positive scenario, a failure-expected scenario that unexpectedly
# succeeded, an API call without the required status, a liveness failure,
# a GLOBAL selection error, or a direct user-plane egress hit on the
# controlled endpoint — increments LAB_FAILS. The final verdict is PASS
# only when LAB_FAILS is zero AND the endpoint log contains no non-selftest
# hit with the simulated VPS source IP (v4 or v6); otherwise exit 1.

LAB_FAILS=0

lab_fail() {
  LAB_FAILS=$((LAB_FAILS + 1))
  say "FAIL: $*"
}

# lab_curl <expected-code> <args...>: strict HTTP check — succeeds only when
# curl answers with exactly the expected status; prints the body.
lab_curl() {
  local expect=$1; shift
  local body code
  body=$(curl -sS --max-time "${LAB_CURL_TIMEOUT:-15}" -w $'\n%{http_code}' "$@" 2>&1)
  code=$(printf '%s' "$body" | tail -n1)
  printf '%s' "${body%$'\n'*}"
  [ "$code" = "$expect" ]
}

# api_select <api-base> <member>: strict GLOBAL selection — 204 or fail.
# On failure prints the actual status and the live GLOBAL state to stderr so
# the fail-closed verdict always shows WHY a selection was refused.
api_select() {
  local base=$1 member=$2 code
  code=$(curl -s -o /dev/null --max-time 5 -X PUT -d "{\"name\":\"$member\"}" "$base/proxies/GLOBAL" -w '%{http_code}')
  if [ "$code" != "204" ]; then
    echo "api_select $member: HTTP $code" >&2
    curl -s --max-time 5 "$base/proxies/GLOBAL" 2>/dev/null | head -c 400 >&2 || true
    echo >&2
    return 1
  fi
  return 0
}

# api_ok <url>: strict GET — 200 or fail.
api_ok() {
  [ "$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$1")" = "200" ]
}

# lab_leak_count <dest-log> <vps-v4> <vps-v6>: endpoint hits whose source is
# the simulated VPS address, excluding the two marked lab-infrastructure
# probes (the leak-detector selftest and the liveness check) — i.e. direct
# user-plane egress with the VPS IP.
lab_leak_count() {
  local log=$1 v4=$2 v6=$3 n=0
  if [ -f "$log" ]; then
    n=$(grep -h '"remote":"'"$v4"'"' "$log" 2>/dev/null | grep -vc 'selftest-direct\|self-vps')
    n=$((n + $(grep -h '"remote":"'"$v6"'"' "$log" 2>/dev/null | grep -vc 'selftest-direct\|self-vps')))
  fi
  echo "$n"
}

# lab_verdict <dest-log> <vps-v4> <vps-v6>: terminal check; exits 1 on any
# accumulated failure or any leak. Never reaches exit 0 with a leak recorded.
lab_verdict() {
  local log=$1 v4=$2 v6=$3 leaks
  leaks=$(lab_leak_count "$log" "$v4" "$v6")
  say "== FINAL: non-selftest direct-egress hits from the VPS IP (v4+v6): $leaks; accumulated FAILs: $LAB_FAILS =="
  if [ "$leaks" != "0" ]; then
    say "VERDICT: FAIL — direct user egress with the VPS IP detected:"
    grep -h '"remote":"'"$v4"'"' "$log" 2>/dev/null | grep -v 'selftest-direct' | head -5 | while IFS= read -r l; do say "  $l"; done
    grep -h '"remote":"'"$v6"'"' "$log" 2>/dev/null | grep -v 'selftest-direct' | head -5 | while IFS= read -r l; do say "  $l"; done
    exit 1
  fi
  if [ "$LAB_FAILS" != "0" ]; then
    say "VERDICT: FAIL — $LAB_FAILS mandatory scenario condition(s) unmet (see FAIL lines above)"
    exit 1
  fi
  say "VERDICT: PASS — zero user-plane direct egress and every mandatory condition held"
}
