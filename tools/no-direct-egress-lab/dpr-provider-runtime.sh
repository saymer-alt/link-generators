#!/usr/bin/env bash
# Provider-only DPR runtime-proof (#355) — contained netns lab scenario.
#
# Proves at RUNTIME (network endpoints, not YAML or `mihomo -t`) the strict
# provider-only DPR semantics of #352 (issue #351): a domain policy built with
# target PROVIDER:<A> may egress ONLY through provider A's nodes. When A is
# all-unhealthy or empty, the policy must fail closed — never exit through the
# healthy provider B and never directly with the VPS IP.
#
# Depends on: the #338 lab (lib/netns.sh, lib/verdict.sh, dest.mjs in this
# directory) and the #352 DPR code in THIS checkout (gen-dpr.mjs extracts the
# exact applyDprProviderTargets post-patch from index.html). Test-only; no
# production code is changed by this scenario.
#
# Containment: identical to lab.sh — the FIRST side effect re-executes this
# script inside a private network namespace (lib/netns.sh:require_lab_isolation).
# Child namespaces are unnamed (PID-addressed); no named netns, no host
# sysctl/iptables/trust changes; if unshare is unavailable the run refuses.
# Ownership: every process is registered with a run-unique marker; cleanup
# kills only registered PIDs whose cmdline still carries the marker.
# Fail-closed verdict: lib/verdict.sh — any failed positive, unexpectedly
# passing negative, status mismatch, or a non-selftest endpoint hit with the
# VPS source IP makes the run exit 1. This scenario additionally asserts the
# DPR-negative cases ON THE ENDPOINT LOG: a failed probe path must have ZERO
# hits from ANY source (A node, B node, direct) — a leak through provider B
# (10.211.0.2) or the A-node stand-in (10.210.0.1) is a FAIL.
#
# Observable user-plane exits for a GEMINI-domain request:
#   via provider A node -> 10.210.0.1 (root-ns stand-in)
#   via provider B node -> 10.211.0.2 (egress ns stand-in)
#   direct with VPS IP  -> 10.210.0.3 (leak, terminal verdict failure)
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_RUN_DIR="$LAB/run"
MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"
JS_YAML_PATH="${JS_YAML_PATH:?set JS_YAML_PATH to a js-yaml module (see docs/TESTING.md)}"

# shellcheck source=lib/netns.sh
source "$LAB/lib/netns.sh"
# shellcheck source=lib/verdict.sh
source "$LAB/lib/verdict.sh"

require_lab_isolation "$@"
lab_run_lock
# Namespace-local forwarding for the node→destination transit (outer lab
# namespace routes between the child links); contained state only.
sysctl -w net.ipv4.ip_forward=1 >/dev/null
trap lab_cleanup EXIT INT TERM

LAB_WD_DIR="$LAB_RUN_DIR/$LAB_RUN_ID"
LOGS="$LAB_RUN_DIR/logs"
RESULTS="$LOGS/results.txt"
mkdir -p "$LAB_WD_DIR" "$LOGS"
: > "$LOGS/dest.jsonl"
: > "$LOGS/dpr-sub.jsonl"
: > "$RESULTS"
say() { echo "$@" | tee -a "$RESULTS"; }

VPS_V4=10.210.0.3; VPS_V6=fd00:2010::3
EGRESS_V4=10.211.0.2
NODEA_V4=10.210.0.1          # provider A live node stand-in exit (root ns)
DEST_V4=10.210.0.1           # root-ns address of the destination/subscription side
API="http://$VPS_V4:9090"
CLIENT="http://127.0.0.1:7897"
GEMINI_URL="http://dpr-gemini.lab:8099"   # hostname dst -> RULE-SET policy-gemini
CTRL_URL="http://$DEST_V4:8099"           # IP-literal dst -> MATCH,GLOBAL control
DEST_LOG="$LOGS/dest.jsonl"
SUB_LOG="$LOGS/dpr-sub.jsonl"
PROV_A=""   # resolved from the generated config by gen-dpr.mjs output
PROV_B=""

# ---------- configs (actual #352 pipeline; gen-dpr.mjs asserts the contract) ----------
mkdir -p "$LAB/certs"
if [ ! -f "$LAB/certs/server-cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -keyout "$LAB/certs/server-key.pem" \
    -out "$LAB/certs/server-cert.pem" -days 3 -nodes -subj "/CN=lab.local" \
    -addext "subjectAltName=DNS:lab.local,IP:10.211.0.2,IP:10.210.0.3,IP:10.210.0.1" \
    -addext "basicConstraints=critical,CA:TRUE" >/dev/null 2>&1
fi
export SSL_CERT_FILE="$LAB/certs/server-cert.pem"
node "$LAB/gen-dpr.mjs" >"$LOGS/gen-dpr.out" 2>&1 \
  || { say "FATAL: gen-dpr.mjs failed"; cat "$LOGS/gen-dpr.out"; exit 1; }
PROV_A=$(sed -n 's/^static self-checks OK (provider A: \(.*\) \/ provider B: .*)$/\1/p' "$LOGS/gen-dpr.out")
PROV_B=$(sed -n 's/^static self-checks OK (provider A: .* \/ provider B: \(.*\))$/\1/p' "$LOGS/gen-dpr.out")
[ -n "$PROV_A" ] && [ -n "$PROV_B" ] || { say "FATAL: provider names not resolved from gen-dpr output"; exit 1; }
say "providers resolved from the actual #352 config: A=$PROV_A B=$PROV_B"
for f in configA-dpr configB configNodeA configC; do
  "$MIHOMO" -t -d "$LAB_WD_DIR/t-$f" -f "$LAB/run/configs/$f.yaml" >/dev/null 2>&1 \
    && say "mihomo -t $f: ACCEPT (parse gate only, not runtime proof)" \
    || { say "FATAL: mihomo -t $f FAILED"; exit 1; }
done

# ---------- lab processes (all registered; cleanup kills only these) ----------
node "$LAB/dest.mjs" --run "$LAB_RUN_ID" >"$LOGS/dest.stdout" 2>&1 &
DEST_PID=$!
lab_own "$DEST_PID" "$LAB_RUN_ID"
node "$LAB/dpr-sub.mjs" "$LAB_RUN_ID" >"$LOGS/dpr-sub.stdout" 2>&1 &
SUB_PID=$!
lab_own "$SUB_PID" "$LAB_RUN_ID"

lab_start_mihomo_root() { # <name> <config-name> — mihomo in the lab ROOT ns
  local name=$1 conf="$LAB/run/configs/$2.yaml" pid
  mkdir -p "$LAB_WD_DIR/$name"
  "$MIHOMO" -d "$LAB_WD_DIR/$name" -f "$conf" >"$LOGS/mihomo-$name.out" 2>&1 &
  pid=$!
  lab_own "$pid" "$LAB_WD_DIR/$name"
  LAB_LAST_PID=$pid
}
lab_start_mihomo_vns() { # <name> <config-name> — mihomo in an unnamed child ns (waits for wiring marker)
  local name=$1 conf="$LAB/run/configs/$2.yaml" marker pid
  marker="$LAB_WD_DIR/$name.ready"
  mkdir -p "$LAB_WD_DIR/$name"
  pid=$(lab_start_vns "$marker" "$LAB_WD_DIR/$name" "$conf" "$LOGS/mihomo-$name.out")
  lab_own "$pid" "$LAB_WD_DIR/$name"
  LAB_LAST_PID=$pid
}

restart_vps() { # restart the vps child with a new scenario config (fresh core state)
  if [ -n "${VPS_PID:-}" ]; then
    kill "$VPS_PID" 2>/dev/null
    local i
    for i in $(seq 1 40); do [ -d "/proc/$VPS_PID" ] || break; sleep 0.25; done
    for i in $(seq 1 40); do curl -s --max-time 1 "$API/version" >/dev/null 2>&1 || break; sleep 0.25; done
  fi
  sleep 0.5
  rm -rf "$LAB_WD_DIR/vps"
  rm -f "$LAB_WD_DIR/vps.ready"
  lab_start_mihomo_vns vps "$1"
  VPS_PID=$LAB_LAST_PID
  lab_wire_veth "$VPS_PID" vps-v0 "$VPS_V4/24" "$DEST_V4/24" "$VPS_V6/64" "fd00:2010::1/64" \
    || { say "FATAL: vps veth wiring failed on restart"; exit 1; }
  touch "$LAB_WD_DIR/vps.ready"
  lab_wait_api_ready "$API" 60
}

set_mode() { # live | dead | empty — provider A payload state for the next fetch
  printf '%s' "$1" > "$LAB_WD_DIR/sub-a.mode"
  say "provider A payload mode -> $1"
}

api_provider_refresh() { # <provider-name> — strict status-checked provider update trigger
  local code
  code=$(curl -s -o /dev/null --max-time 10 -X PUT "$API/providers/proxies/$1" -w '%{http_code}')
  if [ "$code" != "204" ] && [ "$code" != "200" ]; then
    lab_fail "provider refresh PUT $1 returned $code"
    return 1
  fi
  return 0
}

wait_provider_state() { # <provider> <node-name|EMPTY> <tries> — poll the API until the provider serves this state
  local prov=$1 want=$2 tries=$3 i names code
  for i in $(seq 1 "$tries"); do
    code=$(curl -s --max-time 2 -o "$LAB_WD_DIR/prov.json" -w '%{http_code}' "$API/providers/proxies/$prov" 2>/dev/null)
    if [ "$code" = "200" ]; then
      names=$(node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{try{process.stdout.write((JSON.parse(b).proxies||[]).map(p=>p.name).join("\n"))}catch(e){}})' <"$LAB_WD_DIR/prov.json")
      if [ "$want" = "EMPTY" ]; then
        [ -z "$names" ] && return 0
      elif printf '%s' "$names" | grep -qx "$want"; then
        return 0
      fi
    fi
    sleep 0.5
  done
  return 1
}

endpoint_hits() { # <url-substr> [source-ip] — hit count in the dest endpoint log
  local n
  if [ -n "${2:-}" ]; then
    n=$(grep -h '"remote":"'"$2"'"' "$DEST_LOG" 2>/dev/null | grep -cF "$1")
  else
    n=$(grep -hcF "$1" "$DEST_LOG" 2>/dev/null)
  fi
  echo "${n:-0}"
}

expect_exit() { # <url> <expect-ip> <label> — client request must succeed AND the endpoint must see exactly this exit source
  local url=$1 want=$2 label=$3 body ip hits_other
  if body=$(lab_curl 200 -x "$CLIENT" "$url") \
    && ip=$(printf '%s' "$body" | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{try{process.stdout.write(JSON.parse(b).egress_ip||"")}catch(e){}})') \
    && [ "$ip" = "$want" ]; then
    say "$label -> PASS (endpoint saw $ip)"
  else
    lab_fail "$label -> expected egress $want, got: ${body:0:160}"
    [ -f "$LOGS/mihomo-vps.out" ] && tail -3 "$LOGS/mihomo-vps.out" | while IFS= read -r l; do say "  vps-log: $l"; done
    return 1
  fi
}

assert_single_exit() { # <path> <expect-ip> <other1> <other2> <label> — endpoint-level: path hit ONLY from the expected source
  local path=$1 want=$2 o1=$3 o2=$4 label=$5 hits
  hits=$(endpoint_hits "$path" "$want")
  [ "$hits" -ge 1 ] || { lab_fail "$label: endpoint log has no hit from $want for $path"; return 1; }
  hits=$(endpoint_hits "$path" "$o1")
  [ "$hits" = "0" ] || { lab_fail "$label: UNEXPECTED $hits hit(s) on $path from $o1 (wrong exit)"; return 1; }
  hits=$(endpoint_hits "$path" "$o2")
  [ "$hits" = "0" ] || { lab_fail "$label: UNEXPECTED $hits hit(s) on $path from $o2 (wrong exit)"; return 1; }
  say "$label -> endpoint evidence OK (only $want exited on $path)"
}

expect_fail_closed() { # <url> <label> — client must fail AND the path must have ZERO endpoint hits from ANY source
  local url=$1 label=$2 body code hits path
  body=$(curl -sS --max-time "${LAB_CURL_TIMEOUT:-25}" -x "$CLIENT" -w $'\n%{http_code}' "$url" 2>&1)
  code=$(printf '%s' "$body" | tail -n1)
  if [ "$code" = "200" ]; then
    lab_fail "$label -> UNEXPECTED SUCCESS (http 200) — DPR did not fail closed"
    return 1
  fi
  path=$(printf '%s' "$url" | sed 's|.*/||')
  hits=$(endpoint_hits "$path")
  if [ "$hits" != "0" ]; then
    lab_fail "$label -> client failed ($code) BUT the endpoint log has $hits hit(s) on $path — leak"
    return 1
  fi
  say "$label -> client failed closed (http=$code) with ZERO endpoint hits on $path"
}

select_control_exit() { # GLOBAL := provider B node; the MATCH,GLOBAL control path
  api_select "$API" node-b-live || { lab_fail "GLOBAL select node-b-live did not return 204"; return 1; }
  sleep 1
  return 0
}

liveness_and_selftest() { # mandatory hop checks + leak-detector selftest
  lab_curl 200 "http://127.0.0.1:8099/self-outer" >/dev/null \
    || { say "FATAL: dest not reachable in the lab root namespace"; exit 1; }
  nsenter -t "$VPS_PID" -n curl -s -o /dev/null --max-time 3 "http://$DEST_V4:8099/self-vps" \
    || { say "FATAL: dest not reachable from the vps namespace"; exit 1; }
  nsenter -t "$EGRESS_PID" -n curl -s -o /dev/null --max-time 3 "http://$DEST_V4:8099/self-egress" \
    || { say "FATAL: dest not reachable from the egress namespace"; exit 1; }
  nsenter -t "$VPS_PID" -n curl -s -o /dev/null --max-time 3 "http://$DEST_V4:8099/selftest-direct"
  grep -q '"remote":"'$VPS_V4'".*selftest-direct' "$DEST_LOG" \
    || { say "FATAL: leak-detection selftest failed — the criterion is not observable"; exit 1; }
  say "leak-detection selftest: source $VPS_V4 logged on dest OK"
}

# ---------- start the lab ----------
say "== DPR provider-only runtime-proof (#355): run $LAB_RUN_ID (contained netns), mihomo=$("$MIHOMO" -v | head -1) =="
set_mode live
lab_start_mihomo_root nodeA configNodeA;  NODEA_PID=$LAB_LAST_PID
lab_start_mihomo_vns vps configA-dpr;     VPS_PID=$LAB_LAST_PID
lab_start_mihomo_vns egress configB;      EGRESS_PID=$LAB_LAST_PID
lab_start_mihomo_root client configC;     CLIENT_PID=$LAB_LAST_PID
lab_wire_veth "$VPS_PID" vps-v0 "$VPS_V4/24" "$DEST_V4/24" "$VPS_V6/64" "fd00:2010::1/64" \
  || { say "FATAL: vps veth wiring failed"; exit 1; }
touch "$LAB_WD_DIR/vps.ready"
lab_wire_veth "$EGRESS_PID" eg-v0 "$EGRESS_V4/24" "10.211.0.1/24" "" "" \
  || { say "FATAL: egress veth wiring failed"; exit 1; }
touch "$LAB_WD_DIR/egress.ready"
lab_wait_port "$CLIENT" 60 || { say "FATAL: client C not listening"; exit 1; }
lab_wait_api_ready "$API" 60 || { say "FATAL: A API not ready"; exit 1; }
liveness_and_selftest

wait_provider_state "$PROV_A" node-a-live 30 \
  || { say "FATAL: provider A never served node-a-live (service-plane fetch failed)"; exit 1; }
say "service-plane: provider A fetch observed (node-a-live present); fetch log hits from VPS IP: $(grep -c "\"remote\":\"$VPS_V4\"" "$SUB_LOG" 2>/dev/null || true)"
wait_provider_state "$PROV_B" node-b-live 30 \
  || { say "FATAL: provider B never served node-b-live"; exit 1; }

# ---------- P1: A healthy + B healthy — GEMINI strictly via A, MATCH,GLOBAL intact ----------
say "== P1: A healthy -> GEMINI strictly via provider A =="
expect_exit "$GEMINI_URL/dpr-pos-1" "$NODEA_V4" "P1 GEMINI via provider A"
assert_single_exit "dpr-pos-1" "$NODEA_V4" "$EGRESS_V4" "$VPS_V4" "P1 endpoint evidence"
select_control_exit
expect_exit "$CTRL_URL/ctrl-pos-1" "$EGRESS_V4" "P1 control MATCH,GLOBAL via B"
assert_single_exit "ctrl-pos-1" "$EGRESS_V4" "$NODEA_V4" "$VPS_V4" "P1 control endpoint evidence"

# ---------- N1: A exists, ALL its nodes unhealthy (dead payload + refresh), B healthy ----------
say "== N1: A all-unhealthy (dead node), B healthy -> GEMINI fail-closed =="
set_mode dead
api_provider_refresh "$PROV_A"
wait_provider_state "$PROV_A" node-a-dead 30 \
  || { say "FATAL: provider A refresh did not land (node-a-dead absent)"; exit 1; }
curl -s -o /dev/null --max-time 8 "$API/group/GEMINI-AUTO/delay?url=http%3A%2F%2F$DEST_V4%3A8097%2Fhc204&timeout=2000" \
  && say "forced GEMINI-AUTO delay test: completed" || say "forced GEMINI-AUTO delay test: unavailable/timeout (INFO, non-fatal)"
expect_fail_closed "$GEMINI_URL/dpr-neg-1" "N1 GEMINI with all-unhealthy A"
select_control_exit
expect_exit "$CTRL_URL/ctrl-neg-1" "$EGRESS_V4" "N1 control MATCH,GLOBAL via B (B unaffected)"

# ---------- R1: A recovers (live payload + refresh) — GEMINI works via A again ----------
say "== R1: A recovery (live payload + provider refresh) =="
set_mode live
api_provider_refresh "$PROV_A"
wait_provider_state "$PROV_A" node-a-live 30 \
  || { say "FATAL: provider A recovery did not land (node-a-live absent)"; exit 1; }
# Observed runtime semantics (1.19.31, recorded as INFO): right after a
# provider refresh the provider-only url-test group still dials its previously
# chosen (removed, dead) node until the next group test — the health-check
# interval (300s in this config) or an API-triggered re-test. The lab triggers
# the re-test to keep the run bounded; the unforced path is interval-bound.
curl -s -o /dev/null --max-time 8 "$API/group/GEMINI-AUTO/delay?url=http%3A%2F%2F$DEST_V4%3A8097%2Fhc204&timeout=2000" \
  && say "forced GEMINI-AUTO re-test after recovery: completed" || say "forced GEMINI-AUTO re-test: unavailable (INFO)"
expect_exit "$GEMINI_URL/dpr-pos-2" "$NODEA_V4" "R1 GEMINI recovered via provider A"
assert_single_exit "dpr-pos-2" "$NODEA_V4" "$EGRESS_V4" "$VPS_V4" "R1 endpoint evidence"

# ---------- N2: A EMPTY at cold start (empty-fallback semantics, distinct from unhealthy) ----------
say "== N2: A empty (cold start) -> GEMINI fail-closed (empty-fallback REJECT) =="
set_mode empty
cp "$LOGS/mihomo-vps.out" "$LOGS/mihomo-vps-past-P1-N1-R1.out" 2>/dev/null || true
if restart_vps configA-dpr; then
  N2_READY=1
  if wait_provider_state "$PROV_A" EMPTY 30; then
    say "service-plane: provider A serves ZERO nodes after empty payload (cold start)"
  else
    say "INFO: provider A state after empty payload: $(curl -s --max-time 3 "$API/providers/proxies/$PROV_A" | head -c 200) (recorded honestly)"
  fi
  expect_fail_closed "$GEMINI_URL/dpr-neg-2" "N2 GEMINI with empty provider A"
  select_control_exit
  expect_exit "$CTRL_URL/ctrl-neg-2" "$EGRESS_V4" "N2 control MATCH,GLOBAL via B"
else
  lab_fail "N2: mihomo did not become ready with an empty provider at cold start (observed; see mihomo-vps.out)"
fi

# ---------- N3: cold start with A all-unhealthy (dead payload from boot) ----------
say "== N3: cold start with A all-unhealthy -> GEMINI fail-closed =="
set_mode dead
if restart_vps configA-dpr; then
  wait_provider_state "$PROV_A" node-a-dead 30 \
    || say "INFO: provider A nodes at cold start: $(curl -s --max-time 3 "$API/providers/proxies/$PROV_A" | head -c 200)"
  expect_fail_closed "$GEMINI_URL/dpr-neg-3" "N3 GEMINI cold start with unhealthy A"
  select_control_exit
  expect_exit "$CTRL_URL/ctrl-neg-3" "$EGRESS_V4" "N3 control MATCH,GLOBAL via B"
  assert_single_exit "ctrl-neg-3" "$EGRESS_V4" "$NODEA_V4" "$VPS_V4" "N3 control endpoint evidence"
else
  lab_fail "N3: mihomo did not become ready at cold start with an all-unhealthy provider A"
fi

# ---------- summary + terminal verdict ----------
say "== DPR endpoint summary =="
say "hc204 service-plane health checks through nodes: $(grep -c '"kind":"hc"' "$SUB_LOG" 2>/dev/null || true)"
say "provider fetches (service plane, from VPS IP): $(grep -c "\"remote\":\"$VPS_V4\"" "$SUB_LOG" 2>/dev/null || true)"
say "dest hits from VPS IP excluding marked selftests: $(grep -h "\"remote\":\"$VPS_V4\"" "$DEST_LOG" 2>/dev/null | grep -vc 'selftest-direct\|self-vps' || true)"
lab_verdict "$DEST_LOG" "$VPS_V4" "$VPS_V6"
