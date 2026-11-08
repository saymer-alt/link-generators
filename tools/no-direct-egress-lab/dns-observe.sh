#!/usr/bin/env bash
# DNS observation scenario (#284, item Ж): hostname request with ALL upstreams
# dead, with a lab dns section pointing at the logging stub. Mandatory
# conditions: liveness, fail-closed client behavior, no direct egress.
# The DNS observations themselves are informational (owner contract: DNS
# packet path is a separate evaluation) — they never produce PASS on their own.
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_RUN_DIR="$LAB/run"
MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"
# shellcheck source=lib/netns.sh
source "$LAB/lib/netns.sh"
# shellcheck source=lib/verdict.sh
source "$LAB/lib/verdict.sh"
require_lab_isolation "$@"
lab_run_lock
# namespace-local forwarding in the outer lab ns (vps→egress child transit)
sysctl -w net.ipv4.ip_forward=1 >/dev/null
trap lab_cleanup EXIT INT TERM

LAB_WD_DIR="$LAB_RUN_DIR/$LAB_RUN_ID"
LOGS="$LAB_RUN_DIR/logs"; RESULTS="$LOGS/results-dns.txt"
mkdir -p "$LAB_WD_DIR" "$LOGS"
: > "$LOGS/dest.jsonl"; : > "$LOGS/dns.jsonl"; : > "$RESULTS"
say() { echo "$@" | tee -a "$RESULTS"; }

VPS_V4=10.210.0.3; EGRESS_V4=10.211.0.2; DEST_V4=10.210.0.1
EGRESS_GW_V4=10.211.0.1
API="http://$VPS_V4:9090"; CLIENT="http://127.0.0.1:7897"; DEST_LOG="$LOGS/dest.jsonl"

mkdir -p "$LAB/certs"
[ -f "$LAB/certs/server-cert.pem" ] || openssl req -x509 -newkey rsa:2048 \
  -keyout "$LAB/certs/server-key.pem" -out "$LAB/certs/server-cert.pem" -days 3 -nodes \
  -subj "/CN=lab.local" -addext "subjectAltName=DNS:lab.local,IP:10.211.0.2,IP:10.210.0.3" \
  -addext "basicConstraints=critical,CA:TRUE" >/dev/null 2>&1
export SSL_CERT_FILE="$LAB/certs/server-cert.pem"
node "$LAB/gen.mjs" >"$LOGS/gen.out" 2>&1 || { say "FATAL: gen.mjs failed"; exit 1; }
"$MIHOMO" -t -d "$LAB_WD_DIR/t" -f "$LAB/run/configs/configA-dns-observe.yaml" >/dev/null 2>&1 \
  || { say "FATAL: mihomo -t configA-dns-observe FAILED"; exit 1; }

node "$LAB/dest.mjs" --run "$LAB_RUN_ID" >"$LOGS/dest.stdout" 2>&1 &
lab_own "$!" "$LAB_RUN_ID"
VPS_PID=$(lab_start_vns "$LAB_WD_DIR/vps.ready" "$LAB_WD_DIR/vps" "$LAB/run/configs/configA-dns-observe.yaml" "$LOGS/mihomo-A.out")
lab_own "$VPS_PID" "$LAB_WD_DIR/vps"
EGRESS_PID=$(lab_start_vns "$LAB_WD_DIR/egress.ready" "$LAB_WD_DIR/egress" "$LAB/run/configs/configB.yaml" "$LOGS/mihomo-B.out")
lab_own "$EGRESS_PID" "$LAB_WD_DIR/egress"
lab_wire_veth "$VPS_PID" vps-v0 "$VPS_V4/24" "$DEST_V4/24"
lab_wire_veth "$EGRESS_PID" eg-v0 "$EGRESS_V4/24" "$EGRESS_GW_V4/24"
touch "$LAB_WD_DIR/vps.ready" "$LAB_WD_DIR/egress.ready"
"$MIHOMO" -d "$LAB_WD_DIR/client" -f "$LAB/run/configs/configC.yaml" >"$LOGS/mihomo-C.out" 2>&1 &
lab_own "$!" "$LAB_WD_DIR/client"

lab_wait_port "http://127.0.0.1:8099/self-outer" 40 || { say "FATAL: dest not listening"; exit 1; }
lab_curl 200 "http://127.0.0.1:8099/self-outer" >/dev/null || { say "FATAL: dest down"; exit 1; }
nsenter -t "$VPS_PID" -n curl -s -o /dev/null --max-time 3 "http://$DEST_V4:8099/self-vps" || { say "FATAL: dest unreachable from vps ns"; exit 1; }
lab_wait_api_ready "$API" 60 || { say "FATAL: A API not ready"; exit 1; }
lab_wait_port "$CLIENT" 60 || { say "FATAL: client C down"; exit 1; }
api_select "$API" dead-upstream-1 || { say "FATAL: GLOBAL select dead-upstream-1 refused"; exit 1; }
sleep 1

say "== DNS observation run (contained netns) =="
# control: IP-literal request with dead upstream must fail closed
body_code=$(curl -sS --max-time 10 -x "$CLIENT" -o /dev/null -w '%{http_code}' "http://$DEST_V4:8099/dnsctl-ipliteral" 2>/dev/null)
[ "$body_code" != "200" ] || lab_fail "control: IP-literal request unexpectedly succeeded with dead upstream"
say "control (IP-literal, dead upstream): http=$body_code"
# observation: hostname request with dead upstream
host_code=$(curl -sS --max-time 10 -x "$CLIENT" -o /dev/null -w '%{http_code}' "http://probe-hostname.example.test:8099/dnsctl-hostname" 2>/dev/null)
[ "$host_code" != "200" ] || lab_fail "hostname request unexpectedly succeeded with dead upstream"
say "observation (hostname, dead upstream): http=$host_code"
say "DNS stub log (who queried what; empty = the VPS resolver was never used):"
cat "$LOGS/dns.jsonl" | tee -a "$RESULTS"
lab_verdict "$DEST_LOG" "$VPS_V4" ""
