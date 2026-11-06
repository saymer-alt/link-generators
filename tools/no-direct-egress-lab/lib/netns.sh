#!/usr/bin/env bash
# Lab namespace/process ownership helpers (no-direct-egress-lab, #284).
#
# Containment model: every lab script re-executes itself ONCE inside a
# private network namespace (`unshare -n`, gated by AMG_LAB_INSIDE). All
# sysctl/iptables/topology state below that gate is lab-local and disappears
# with the namespace; the shared host network state is never touched.
# Inner "vps"/"egress" namespaces are UNNAMED children created by PID
# (`unshare -n ... &` + `ip link set ... netns $PID`) — nothing is registered
# under /run/netns, so there is no shared name to collide with.
#
# Ownership: the runner records the PID of every process it starts and a
# per-run unique marker path; cleanup kills a recorded PID only if its
# /proc/PID/cmdline still contains that marker. There is no pattern-based process killing, no
# pattern killing, and no named-namespace deletion anywhere in the tool.

# require_lab_isolation: must be the FIRST side effect of every lab script.
# Re-executes the script inside a private network namespace; if unshare is
# unavailable the exec fails and the script refuses — there is no fallback
# to running on the shared host network namespace.
require_lab_isolation() {
  if [ "${AMG_LAB_INSIDE:-}" = "1" ]; then
    # Fresh private namespace: loopback is down and addressless — bring it up
    # so lab-local services can bind 127.0.0.1 (namespace-local state only).
    ip link set lo up
    ip addr add 127.0.0.1/8 dev lo 2>/dev/null
    return 0
  fi
  exec unshare -n env AMG_LAB_INSIDE=1 bash "$0" "$@"
}

# lab_run_lock: refuse concurrent lab runs. mkdir-based (atomic on every
# filesystem, unlike flock on network mounts) with the holder PID recorded;
# a lock whose recorded PID no longer exists is stale and taken over.
lab_run_lock() {
  mkdir -p "$LAB_RUN_DIR"
  local d="$LAB_RUN_DIR/lock.dir" old
  if mkdir "$d" 2>/dev/null; then
    echo $$ >"$d/pid"
    return 0
  fi
  old=$(cat "$d/pid" 2>/dev/null || true)
  if [ -n "$old" ] && [ ! -d "/proc/$old" ]; then
    echo "taking over a stale lab lock (holder pid $old is gone)" >&2
    rm -rf "$d"
    mkdir "$d" && { echo $$ >"$d/pid"; return 0; }
  fi
  echo "refusing: another lab run holds the lock ($d)" >&2
  exit 1
}

LAB_RUN_ID="run-$$"
LAB_OWNED_PIDS=""
LAB_OWNED_MARKERS=""

# lab_own <pid> <unique-marker-path>: register a started process for
# ownership-checked cleanup. The marker is a path unique to this run that
# MUST appear in the process cmdline (wd directory or flag argument).
lab_own() {
  LAB_OWNED_PIDS="$LAB_OWNED_PIDS $1"
  LAB_OWNED_MARKERS="$LAB_OWNED_MARKERS $2"
}

# lab_cleanup: kill ONLY registered processes whose cmdline still carries
# this run's unique marker; remove ONLY this run's wd directory. No global
# patterns, no namespace deletion, no certificate/sysctl/iptables changes.
lab_cleanup() {
  local i=0 pids markers pid marker
  for pid in $LAB_OWNED_PIDS; do
    set -- $LAB_OWNED_MARKERS; marker=$(eval "echo \${$((i + 1))}")
    if [ -d "/proc/$pid" ] && tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -qF "$marker"; then
      kill "$pid" 2>/dev/null
    fi
    i=$((i + 1))
  done
  wait 2>/dev/null
  [ -n "${LAB_WD_DIR:-}" ] && rm -rf "$LAB_WD_DIR"
  [ -n "${LAB_RUN_DIR:-}" ] && rm -rf "$LAB_RUN_DIR/lock.dir"
}

# lab_start_vns <marker> <wd> <config> [logfile]: start one inner (unnamed)
# namespace child that waits for the marker file, then execs mihomo. Echoes
# the PID. The child is registered by the CALLER via lab_own.
lab_start_vns() {
  local marker=$1 wd=$2 conf=$3 log=${4:-/dev/null} pid
  unshare -n bash -c '
    while [ ! -e "$1" ]; do sleep 0.05; done
    exec "$MIHOMO_BIN" -d "$2" -f "$3"
  ' _ "$marker" "$wd" "$conf" >"$log" 2>&1 &
  pid=$!
  echo "$pid"
}

# lab_wire_veth <child-pid> <inner-ifname> <inner-v4> <host-v4> <inner-v6> <host-v6>
# Wires one veth pair between the outer (lab root) namespace and a child
# namespace identified by PID, brings the inner side up and gives the child a
# default route via the outer side (v4 always; v6 when provided). All of this
# is namespace-local state of the contained lab.
lab_wire_veth() {
  local pid=$1 inner=$2 inner_v4=$3 host_v4=$4 inner_v6=${5:-} host_v6=${6:-}
  local host="amg-lab-$inner"
  local gw4=${host_v4%%/*}
  # retry the pair creation: a just-torn-down sibling namespace may lag a few
  # hundred ms before the kernel reaps its devices (RCU grace period)
  local attempt=0
  until ip link add "$host" type veth peer name "$inner" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 5 ]; then
      echo "lab_wire_veth: cannot create $host after $attempt attempts" >&2
      return 1
    fi
    sleep 0.3
  done
  ip link set "$inner" netns "$pid"
  # bring the host side UP and addressed BEFORE the child routes through it
  ip link set "$host" up
  ip addr add "$host_v4" dev "$host"
  nsenter -t "$pid" -n sh -c "ip link set lo up && ip link set $inner up && ip addr add $inner_v4 dev $inner && ip route add default via $gw4"
  if [ -n "$inner_v6" ]; then
    local gw6=${host_v6%%/*}
    # nodad: lab addresses are unique by construction; without it the address
    # sits tentative (duplicate-detection) for ~1s and early v6 dials fail
    ip addr add "$host_v6" dev "$host" nodad 2>/dev/null || ip addr add "$host_v6" dev "$host"
    nsenter -t "$pid" -n sh -c "ip addr add $inner_v6 dev $inner nodad 2>/dev/null || ip addr add $inner_v6 dev $inner; ip -6 route add default via $gw6"
  fi
}

# lab_wait_port <url> <tries>: poll a lab-internal endpoint until it answers.
lab_wait_port() {
  local url=$1 tries=${2:-40}
  for _ in $(seq 1 "$tries"); do
    curl -s -o /dev/null --max-time 1 "$url" && return 0
    sleep 0.25
  done
  return 1
}

# lab_wait_api_ready <api-base> <tries>: wait until the mihomo external
# controller has FINISHED applying its configuration. /version (and any TCP
# probe) already answers while the initial default config is still live —
# /proxies then has no GLOBAL and every selection would 404 — so readiness is
# proven only by a 200 on /proxies/GLOBAL, which exists solely once the real
# config (with its groups and members) is in effect.
lab_wait_api_ready() {
  local base=$1 tries=${2:-60} code
  for _ in $(seq 1 "$tries"); do
    code=$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "$base/proxies/GLOBAL" 2>/dev/null)
    [ "$code" = "200" ] && return 0
    sleep 0.25
  done
  return 1
}
