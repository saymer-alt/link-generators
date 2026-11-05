#!/usr/bin/env bash
# DNS observation scenario: hostname request with ALL upstreams dead.
# Observations only (owner contract: DNS packet path is a separate evaluation).
set -u
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=$LAB/run/configs; MIHOMO="${MIHOMO_BIN:?set MIHOMO_BIN to the pinned mihomo binary (>= 1.19.31)}"; DEST_IP=10.210.0.1
pkill -f 'dest.mjs' 2>/dev/null; pkill -x A_our_unpacked_ 2>/dev/null
ip netns del vps 2>/dev/null; ip netns del egress 2>/dev/null; sleep 1
ip netns add vps; ip netns add egress
ip link add vps-v1 type veth peer name vps-v0; ip link add eg-v1 type veth peer name eg-v0
ip link set vps-v0 netns vps; ip link set eg-v0 netns egress
ip addr add 10.210.0.1/24 dev vps-v1; ip addr add 10.211.0.1/24 dev eg-v1
ip link set vps-v1 up; ip link set eg-v1 up
ip -n vps addr add 10.210.0.3/24 dev vps-v0; ip -n egress addr add 10.211.0.2/24 dev eg-v0
ip -n vps link set vps-v0 up; ip -n egress link set eg-v0 up
ip -n vps link set lo up; ip -n egress link set lo up
ip -n vps route add default via 10.210.0.1; ip -n egress route add default via 10.211.0.1
sysctl -w net.ipv4.ip_forward=1 >/dev/null
node "$LAB/dest.mjs" >"$LAB/run/logs/dest.stdout" 2>&1 &
rm -rf "$LAB/wdB"; mkdir -p "$LAB/wdB"
ip netns exec egress sh -c "exec $MIHOMO -d $LAB/wdB -f $CONF/configB.yaml" >"$LAB/run/logs/mihomo-B.out" 2>&1 &
rm -rf "$LAB/wdC"; mkdir -p "$LAB/wdC"
$MIHOMO -d "$LAB/wdC" -f "$CONF/configC.yaml" >"$LAB/run/logs/mihomo-C.out" 2>&1 &
rm -rf "$LAB/wdA"; mkdir -p "$LAB/wdA"
ip netns exec vps sh -c "exec $MIHOMO -d $LAB/wdA -f $CONF/configA-dns-observe.yaml" >"$LAB/run/logs/mihomo-A.out" 2>&1 &
sleep 4
curl -s -X PUT -d '{"name":"dead-upstream-1"}' http://10.210.0.3:9090/proxies/GLOBAL -o /dev/null
sleep 1
echo "--- 1) IP-literal request with dead upstream (control) ---"
curl -sS --max-time 10 -x http://127.0.0.1:7897 "http://$DEST_IP:8099/dnsctl-ipliteral" -o /dev/null -w "http=%{http_code}\n"
echo "--- 2) HOSTNAME request with dead upstream ---"
curl -sS --max-time 10 -x http://127.0.0.1:7897 "http://probe-hostname.example.test:8099/dnsctl-hostname" -o /dev/null -w "http=%{http_code}\n"
echo "--- 3) direct connection attempt check: dest log tail ---"
tail -6 "$LAB/run/logs/dest.jsonl"
echo "--- 4) DNS stub log (who queried what) ---"
cat "$LAB/run/logs/dns.jsonl"
echo "--- 5) A dial/DNS errors ---"
grep -E "error|dns" "$LAB/run/logs/mihomo-A.out" | tail -6
