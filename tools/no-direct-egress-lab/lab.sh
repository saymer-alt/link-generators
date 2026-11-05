#!/usr/bin/env bash
# Synthetic field test for issue #284 (no-direct user egress), lab in WSL netns.
# Topology:
#   root ns  : dest.mjs (dest :8099 "internet", sub :8098, dns stub :5300)
#   vps ns   : 10.210.0.3 = simulated VPS public IP, mihomo A (Builder YAML)
#   egress ns: 10.211.0.2 = allowed external egress node, mihomo B
#   root ns  : client C mihomo (mixed :7897) = Joe Doe's phone stand-in
# Leak = dest.jsonl hit with source 10.210.0.3 (user-plane direct egress).
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=$LAB/run/configs
LOGS=$LAB/run/logs
MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"
VPS_IP=10.210.0.3
EGRESS_IP=10.211.0.2
DEST_IP=10.210.0.1
RESULTS=$LAB/run/results.txt
: > "$RESULTS"
say() { echo "$@" | tee -a "$RESULTS"; }

# Cleanup trap: this script owns ONLY the processes it starts (dest server,
# mihomo instances under the lab wd dirs) and the lab netns/veths created
# below. Nothing outside this lab is touched.
cleanup() {
  pkill -f 'dest\.mjs' 2>/dev/null
  pkill -f 'wd-run\|wdB\|wdC\|wdA' 2>/dev/null
  ip netns del vps 2>/dev/null; ip netns del egress 2>/dev/null
}
trap cleanup EXIT

mkdir -p "$LOGS"; : > "$LOGS/dest.jsonl"; : > "$LOGS/sub.jsonl"; : > "$LOGS/dns.jsonl"

# ---------- cleanup previous run ----------
pkill -f 'dest.mjs' 2>/dev/null; pkill -x A_our_unpacked_ 2>/dev/null
pkill -f 'configA\|configB\|configC' 2>/dev/null
ip netns del vps 2>/dev/null; ip netns del egress 2>/dev/null
sleep 1

# ---------- namespace / link setup ----------
ip netns add vps
ip netns add egress
ip link add vps-v1 type veth peer name vps-v0
ip link add eg-v1 type veth peer name eg-v0
ip link set vps-v0 netns vps
ip link set eg-v0 netns egress
ip addr add 10.210.0.1/24 dev vps-v1
ip addr add 10.211.0.1/24 dev eg-v1
ip link set vps-v1 up; ip link set eg-v1 up
ip -n vps addr add $VPS_IP/24 dev vps-v0
ip -n egress addr add $EGRESS_IP/24 dev eg-v0
ip -n vps link set vps-v0 up; ip -n egress link set eg-v0 up
ip -n vps link set lo up; ip -n egress link set lo up
ip -n vps route add default via 10.210.0.1
ip -n egress route add default via 10.211.0.1
sysctl -w net.ipv4.ip_forward=1 >/dev/null
if command -v iptables >/dev/null 2>&1; then
  iptables -C FORWARD -s 10.210.0.0/24 -d 10.211.0.0/24 -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD 1 -s 10.210.0.0/24 -d 10.211.0.0/24 -j ACCEPT
  iptables -C FORWARD -s 10.211.0.0/24 -d 10.210.0.0/24 -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD 1 -s 10.211.0.0/24 -d 10.210.0.0/24 -j ACCEPT
fi
say "== topology: vps=$VPS_IP egress=$EGRESS_IP dest=$DEST_IP =="
ip netns exec vps ping -c1 -W2 $DEST_IP >/dev/null && say "topology: vps->dest OK" || { say "FATAL: vps->dest unreachable"; exit 1; }

# ---------- lab cert + configs ----------
# The lab CA lives ONLY in $LAB/certs and is trusted ONLY through the
# SSL_CERT_FILE environment of the processes that need it (the provider-fetch
# verification in mihomo A) — the system trust store is never modified.
mkdir -p "$LAB/certs"
if [ ! -f "$LAB/certs/server-cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -keyout "$LAB/certs/server-key.pem" \
    -out "$LAB/certs/server-cert.pem" -days 3 -nodes -subj "/CN=lab.local" \
    -addext "subjectAltName=DNS:lab.local,IP:10.211.0.2,IP:10.210.0.3" \
    -addext "basicConstraints=critical,CA:TRUE" >/dev/null 2>&1
fi
export SSL_CERT_FILE="$LAB/certs/server-cert.pem"
node "$LAB/gen.mjs" >"$LOGS/gen.out" 2>&1 || { say "FATAL: gen.mjs failed"; cat "$LOGS/gen.out"; exit 1; }

# ---------- configs: validate then start lab services ----------
for f in configA configA-outage configA-sub configA-sub-dead configA-dns-observe configB configC; do
  $MIHOMO -t -d "$LAB/wd-$f" -f "$CONF/$f.yaml" >/dev/null 2>"$LOGS/t-$f.err" \
    && say "mihomo -t $f: ACCEPT" || { say "FATAL: mihomo -t $f FAILED"; cat "$LOGS/t-$f.err"; exit 1; }
done

node "$LAB/dest.mjs" >"$LOGS/dest.stdout" 2>&1 &
# egress node B (allowed external egress) — in the egress namespace
rm -rf "$LAB/run/wdB"; mkdir -p "$LAB/run/wdB"
ip netns exec egress sh -c "exec $MIHOMO -d $LAB/wdB -f $CONF/configB.yaml" >"$LOGS/mihomo-B.out" 2>&1 &
# client C (Joe Doe stand-in) — in the root namespace
rm -rf "$LAB/run/wdC"; mkdir -p "$LAB/run/wdC"
$MIHOMO -d "$LAB/run/wdC" -f "$CONF/configC.yaml" >"$LOGS/mihomo-C.out" 2>&1 &
sleep 2
curl -s --max-time 3 http://$DEST_IP:8099/selftest >/dev/null && say "dest server: reachable" || { say "FATAL: dest server down"; exit 1; }
ip netns exec egress curl -s --max-time 3 http://$DEST_IP:8099/b-reachability >/dev/null \
  && say "egress ns -> dest reachable" || { say "FATAL: egress ns cannot reach dest"; exit 1; }
(echo > /dev/tcp/127.0.0.1/7897) 2>/dev/null \
  && say "client C port up" || { say "FATAL: client C not listening"; tail -3 "$LOGS/mihomo-C.out"; exit 1; }

# selftest: prove leak detection works — direct connection from vps ns
ip netns exec vps curl -s --max-time 3 http://$DEST_IP:8099/selftest-direct >/dev/null
grep -q '"remote":"'$VPS_IP'".*selftest-direct' "$LOGS/dest.jsonl" \
  && say "leak-detection selftest: source $VPS_IP logged on dest OK" \
  || { say "FATAL: leak detection selftest failed"; exit 1; }
SUB_LINES=$(wc -l < "$LOGS/dest.jsonl")

start_a() { # $1=config name
  rm -rf "$LAB/run/wd-run"; mkdir -p "$LAB/run/wd-run"
  ip netns exec vps sh -c "exec $MIHOMO -d $LAB/wd-run -f $CONF/$1.yaml" >"$LOGS/mihomo-A.out" 2>&1 &
  for i in $(seq 1 30); do
    curl -s --max-time 1 http://$VPS_IP:9090/version >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  say "FATAL: mihomo A ($1) API not reachable"; cat "$LOGS/mihomo-A.out"; exit 1
}
api_groups_audit() { # assert: no DIRECT member in ANY group; REJECT present in GLOBAL
  node -e '
    const http=require("http");
    http.get("http://10.210.0.3:9090/proxies",(r)=>{let b="";r.on("data",c=>b+=c);r.on("end",()=>{
      const p=JSON.parse(b).proxies; let bad=[],g=p["GLOBAL"];
      for(const [n,v] of Object.entries(p)) if(Array.isArray(v.all)&&v.all.includes("DIRECT")) bad.push(n);
      const ok = bad.length===0 && g && g.all.includes("REJECT") && !g.all.includes("DIRECT");
      console.log(ok?"AUDIT-OK":"AUDIT-FAIL direct_members="+JSON.stringify(bad)+" global="+(g?g.all.join("|"):"absent"));
    });}).on("error",(e)=>console.log("AUDIT-FAIL "+e.message));'
}
api_select() { curl -s -X PUT -d '{"name":"'"$1"'"}' http://$VPS_IP:9090/proxies/GLOBAL -o /dev/null -w '%{http_code}'; }
dest_hits_since() { tail -n +$(( $1 + 1 )) "$LOGS/dest.jsonl" | grep -c '"kind":"dest"' || true; }
dest_vps_hits() { grep -c '"remote":"'$VPS_IP'"' "$LOGS/dest.jsonl" || true; }

client_curl() { # $1=url $2=timeout  → via client C (VLESS ingress, root ns)
  local body code
  body=$(curl -sS --max-time "${2:-15}" -x http://127.0.0.1:7897 -w $'\n%{http_code}' "$1" 2>&1); local rc=$?
  code=$(echo "$body" | tail -n1); echo "rc=$rc http=$code body=${body%$'\n'*}" | head -c 300; }
xray_curl() { # via A mixed-port loopback inside vps ns (Xray stand-in position)
  local body code
  body=$(ip netns exec vps curl -sS --max-time "${2:-15}" -x http://127.0.0.1:7890 -w $'\n%{http_code}' "$1" 2>&1); local rc=$?
  code=$(echo "$body" | tail -n1); echo "rc=$rc http=$code body=${body%$'\n'*}" | head -c 300; }
client_curl_ok() { # PASS iff rc=0 AND http=200 AND body has egress_ip=$1
  local out; out=$(client_curl "$2" "${3:-15}")
  echo "$out" | grep -q "rc=0 http=200" && echo "$out" | grep -q "\"egress_ip\":\"$1\""; }
client_curl_fail() { # PASS iff network-level failure or HTTP-level failure (rc!=0 or http!=200)
  local out; out=$(client_curl "$1" "${2:-20}")
  echo "$out" | grep -qv "rc=0 http=200"; }

# ============ Scenario A: live upstream ============
say "== Scenario A: live upstream (VLESS ingress + Xray-standin ingress) =="
start_a configA
say "GLOBAL members audit: $(api_groups_audit)"
say "select GLOBAL=egress-live -> http $(api_select egress-live)"
sleep 1
R1=$(client_curl "http://$DEST_IP:8099/ipcheck-a1")
echo "$R1" | grep -q "rc=0 http=200" && echo "$R1" | grep -q "\"egress_ip\":\"$EGRESS_IP\"" \
  && say "A1 VLESS ingress  -> PASS (endpoint saw egress IP $EGRESS_IP)" \
  || say "A1 VLESS ingress  -> FAIL: $R1"
R2=$(xray_curl "http://$DEST_IP:8099/ipcheck-a2")
echo "$R2" | grep -q "rc=0 http=200" && echo "$R2" | grep -q "\"egress_ip\":\"$EGRESS_IP\"" \
  && say "A2 loopback mixed -> PASS (endpoint saw egress IP $EGRESS_IP)" \
  || say "A2 loopback mixed -> FAIL: $R2"
H1=$(dest_hits_since $SUB_LINES); V1=$(dest_vps_hits)
say "A dest hits since start: $H1 (expect 2), hits from VPS IP ever: $V1 (expect 1 = selftest only)"
pkill -f 'configA.yaml' 2>/dev/null; sleep 1

# ============ Scenario B: full outage ============
say "== Scenario B: full upstream outage (fail-closed) =="
B0=$(wc -l < "$LOGS/dest.jsonl")
start_a configA-outage
say "GLOBAL members audit: $(api_groups_audit)"
say "GLOBAL default = first member (⚡ Fastest, url-test over all-dead nodes)"
sleep 1
RB=$(client_curl "http://$DEST_IP:8099/ipcheck-b-fastest" 20)
echo "$RB" | grep -q "rc=0 http=200" && say "B1 Fastest/all-dead -> UNEXPECTED SUCCESS: $RB" || say "B1 Fastest/all-dead -> client failed closed: $RB"
RB2=$(xray_curl "http://$DEST_IP:8099/ipcheck-b-fastest2" 20)
echo "$RB2" | grep -q "rc=0 http=200" && say "B2 loopback all-dead -> UNEXPECTED SUCCESS: $RB2" || say "B2 loopback all-dead -> client failed closed: $RB2"
say "select GLOBAL=dead-upstream-1 -> http $(api_select dead-upstream-1)"
sleep 1
RB3=$(client_curl "http://$DEST_IP:8099/ipcheck-b-dead" 20)
echo "$RB3" | grep -q "rc=0 http=200" && say "B3 manual dead node -> UNEXPECTED SUCCESS: $RB3" || say "B3 manual dead node -> client failed closed: $RB3"
say "select GLOBAL=REJECT -> http $(api_select REJECT)"
sleep 1
RB4=$(client_curl "http://$DEST_IP:8099/ipcheck-b-reject" 10)
echo "$RB4" | grep -q "rc=0 http=200" && say "B4 GLOBAL=REJECT -> UNEXPECTED SUCCESS: $RB4" || say "B4 GLOBAL=REJECT -> client failed closed: $RB4"
HB=$(dest_hits_since $B0); VB=$(dest_vps_hits)
say "B dest hits during outage: $HB (MUST be 0), hits from VPS IP ever: $VB (MUST be 1 = selftest only)"
pkill -f 'configA' 2>/dev/null; sleep 1

# ============ Scenario C: GLOBAL switching — positive control back ============
say "== Scenario C: GLOBAL manual switching back to allowed egress =="
start_a configA
C0=$(wc -l < "$LOGS/dest.jsonl")
say "select GLOBAL=egress-live -> http $(api_select egress-live)"
sleep 1
RC=$(client_curl "http://$DEST_IP:8099/ipcheck-c")
echo "$RC" | grep -q "rc=0 http=200" && echo "$RC" | grep -q "\"egress_ip\":\"$EGRESS_IP\"" \
  && say "C manual re-select -> PASS (egress IP $EGRESS_IP)" || say "C manual re-select -> FAIL: $RC"
HC=$(dest_hits_since $C0)
say "C dest hits: $HC (expect 1)"
pkill -f 'configA' 2>/dev/null; sleep 1

# ============ Scenario D: Sub Mode ON (provider fetch = service plane) ============
say "== Scenario D: Sub Mode ON provider fetch + user plane =="
D0=$(wc -l < "$LOGS/dest.jsonl"); DS0=$(wc -l < "$LOGS/sub.jsonl")
start_a configA-sub
sleep 2
DS1=$(wc -l < "$LOGS/sub.jsonl")
grep -q '"remote":"'$VPS_IP'"' <(tail -n +$((DS0+1)) "$LOGS/sub.jsonl") \
  && say "D provider fetch: sub server saw source $VPS_IP -> OK (service plane bootstrap, expected)" \
  || say "D provider fetch: no fetch logged from VPS (FAIL — Sub Mode broken?)"
say "GLOBAL members audit: $(api_groups_audit)"
say "GLOBAL.all/now: $(curl -s http://$VPS_IP:9090/proxies/GLOBAL | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{const g=JSON.parse(b);process.stdout.write(JSON.stringify(g.all)+" now="+g.now)})')"
# Select the provider-fed node directly: the lab has no internet, so the
# url-test group (health URL gstatic) refuses to route regardless — selecting
# the node via GLOBAL exercises the same user-plane path as scenario A.
say "select GLOBAL=sub-egress-live -> http $(api_select sub-egress-live)"
sleep 1
RD=$(client_curl "http://$DEST_IP:8099/ipcheck-d")
echo "$RD" | grep -q "rc=0 http=200" && echo "$RD" | grep -q "\"egress_ip\":\"$EGRESS_IP\"" \
  && say "D user plane via provider node -> PASS (egress IP $EGRESS_IP)" || say "D user plane via provider node -> FAIL: $RD"
pkill -f 'configA' 2>/dev/null; sleep 1

# ---- D2: provider fetch works while upstream dead (service plane independent) ----
say "== Scenario D2: provider fetch with dead node in subscription =="
DS2=$(wc -l < "$LOGS/sub.jsonl")
start_a configA-sub-dead
sleep 3
grep -q '"remote":"'$VPS_IP'"' <(tail -n +$((DS2+1)) "$LOGS/sub.jsonl") \
  && say "D2 provider fetch with dead node: fetch OK from $VPS_IP (service plane unaffected by upstream health)" \
  || say "D2 provider fetch FAILED (unexpected)"
RB5=$(client_curl "http://$DEST_IP:8099/ipcheck-d2" 15)
echo "$RB5" | grep -q "rc=0 http=200" && say "D2 user plane via dead provider node -> UNEXPECTED SUCCESS: $RB5" || say "D2 user plane via dead provider node -> client failed closed: $RB5"
pkill -f 'configA' 2>/dev/null; sleep 1
# Final verdict: any destination hit whose source is the simulated VPS IP and
# whose URL is not the deliberate leak-detection selftest is a direct user
# egress — the run FAILS, not just "connection failed".
LEAKS=$(grep '"remote":"'$VPS_IP'"' "$LOGS/dest.jsonl" | grep -vc 'selftest-direct' || true)
VB=$(dest_vps_hits)
say "== FINAL: dest hits from VPS IP total: $VB, non-selftest (user-plane direct egress): $LEAKS =="
if [ "$LEAKS" != "0" ]; then
  say "VERDICT: FAIL — direct user egress with the VPS IP detected:"
  grep '"remote":"'$VPS_IP'"' "$LOGS/dest.jsonl" | grep -v 'selftest-direct' | tee -a "$RESULTS"
  exit 1
fi
say "VERDICT: PASS — zero user-plane direct egress in the entire matrix"
tail -5 "$LOGS/dest.jsonl" >> "$RESULTS" 2>/dev/null || true
say "== done =="
