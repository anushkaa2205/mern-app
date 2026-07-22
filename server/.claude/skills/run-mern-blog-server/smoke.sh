#!/usr/bin/env bash
# Driver for the mern-blog-server skill. Run under Git Bash (POSIX sh on Windows).
#
# Usage:
#   ./smoke.sh start   # ensure MongoDB service is running, start node server in background
#   ./smoke.sh verify  # curl-based smoke test of a running server (full CRUD lifecycle)
#   ./smoke.sh stop    # stop the node server (MongoDB service is left running)
#   ./smoke.sh         # start, verify, stop — full self-contained smoke test
set -uo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="/tmp/mern-blog-server-logs"
BASE_URL="http://localhost:5000"

mkdir -p "$LOG_DIR"

start() {
  # MongoDB ships installed as a Windows service (name: MongoDB, StartType:
  # Automatic) that owns C:\Program Files\MongoDB\Server\8.3\data. Do NOT
  # spawn a second mongod manually — it silently loses the port-27017 race
  # against the service and you end up talking to the service anyway while
  # believing your own instance is serving requests.
  local svc_status
  svc_status=$(powershell -NoProfile -Command "(Get-Service MongoDB -ErrorAction SilentlyContinue).Status")
  if [ "$svc_status" != "Running" ]; then
    echo "starting MongoDB service..."
    powershell -NoProfile -Command "Start-Service MongoDB" || {
      echo "FAILED to start MongoDB service — run as admin, or check 'Get-Service MongoDB'" >&2
      return 1
    }
    sleep 2
  else
    echo "MongoDB service already running"
  fi

  if ! powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue" | grep -q .; then
    echo "starting node server..."
    ( cd "$SERVER_DIR" && node server.js > "$LOG_DIR/server.log" 2>&1 & disown )
    for i in $(seq 1 20); do
      curl -sf "$BASE_URL/" > /dev/null 2>&1 && break
      sleep 0.5
    done
  else
    echo "server already listening on 5000"
  fi

  if curl -sf "$BASE_URL/" > /dev/null 2>&1; then
    echo "ready: $BASE_URL"
  else
    echo "FAILED to come up — see $LOG_DIR/server.log" >&2
    return 1
  fi
}

verify() {
  echo "--- root ---"
  curl -sf "$BASE_URL/" || return 1
  echo

  echo "--- list (before) ---"
  curl -sf "$BASE_URL/api/posts" || return 1
  echo

  echo "--- create ---"
  local resp id
  resp=$(curl -sf -X POST "$BASE_URL/api/posts" -H "Content-Type: application/json" \
    -d '{"title":"Smoke Test","content":"driver check","author":"skillgen"}') || return 1
  echo "$resp"
  id=$(echo "$resp" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)._id))")
  [ -n "$id" ] || { echo "FAILED: no id returned from create"; return 1; }

  echo "--- get by id ---"
  curl -sf "$BASE_URL/api/posts/$id" || return 1
  echo

  echo "--- update ---"
  curl -sf -X PUT "$BASE_URL/api/posts/$id" -H "Content-Type: application/json" \
    -d '{"title":"Smoke Test Updated","content":"driver check v2","author":"skillgen"}' || return 1
  echo

  echo "--- delete ---"
  curl -sf -X DELETE "$BASE_URL/api/posts/$id" || return 1
  echo

  echo "--- get after delete (expect 404) ---"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/posts/$id")
  [ "$code" = "404" ] || { echo "FAILED: expected 404, got $code"; return 1; }
  echo "404 (as expected)"

  echo "PASS"
}

stop() {
  # Only the node server — MongoDB is a system service, leave it running.
  powershell -NoProfile -Command "
    \$s = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
    if (\$s) { Stop-Process -Id (\$s.OwningProcess | Select-Object -Unique) -Force }
  " > /dev/null
  echo "stopped node server (port 5000 freed); MongoDB service left running"
}

case "${1:-full}" in
  start) start ;;
  verify) verify ;;
  stop) stop ;;
  full)
    start && verify
    result=$?
    stop
    exit $result
    ;;
  *) echo "usage: $0 {start|verify|stop}" >&2; exit 2 ;;
esac
