#!/usr/bin/env bash
# Fleqo process-level reliability check.
#
# Runs the COMPILED API and worker in production mode against THROWAWAY PostgreSQL + Redis
# containers (own names and ports), then injects real failures: worker downtime, Redis outage,
# worker SIGKILL during retry back-off, Redis restart, PostgreSQL restart and API restart.
# After every scenario it asserts exact database state. It never touches the dev database.
#
#   npm run build --workspace=apps/api && bash scripts/reliability-check.sh
#
# Requirements: bash, docker, node, curl. Results: apps/api/test-results/reliability/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/apps/api"
OUT="$API_DIR/test-results/reliability"
PG=fleqo-rel-pg
RD=fleqo-rel-redis
PG_PORT=55432
RD_PORT=56379
API_PORT=4600
WORKER_HEALTH_PORT=4601
ORIGIN=http://localhost:3600
JAR="$OUT/cookies.txt"
API_PID=""
WORKER_PID=""

mkdir -p "$OUT"
rm -f "$OUT"/*.log "$JAR" "$OUT/summary.json"

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true
  docker rm -f "$PG" "$RD" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Environment for the compiled services (fresh secrets every run; TLS verification enforced) ──
unset NODE_TLS_REJECT_UNAUTHORIZED
export NODE_ENV=production
export DATABASE_URL="postgresql://fleqo:fleqo@127.0.0.1:$PG_PORT/fleqo?schema=public"
export REDIS_URL="redis://127.0.0.1:$RD_PORT"
export QUEUE_PREFIX=fleqo-rel
export BETTER_AUTH_URL="$ORIGIN"
export WEB_ORIGINS="$ORIGIN"
BETTER_AUTH_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")"
ENCRYPTION_KEY="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")"
export BETTER_AUTH_SECRET ENCRYPTION_KEY
export WORKFLOW_BACKOFF_MS=1000
export DISPATCH_POLL_MS=500
export RUN_LEASE_MS=5000
export LOG_LEVEL=info

sql() { docker exec "$PG" psql -U fleqo -d fleqo -tAc "$1" | tr -d '[:space:]'; }
api() { # api METHOD PATH [JSON]
  local args=(-sS -X "$1" "http://localhost:$API_PORT$2" -H "Origin: $ORIGIN" -b "$JAR" -c "$JAR")
  [ $# -ge 3 ] && args+=(-H "Content-Type: application/json" -d "$3")
  curl "${args[@]}"
}
status_of() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=($1);process.stdout.write(typeof v==='string'?v:JSON.stringify(v))})"; }
wait_for() { # wait_for SECONDS DESCRIPTION COMMAND...
  local seconds=$1 what=$2; shift 2
  for _ in $(seq 1 $((seconds * 2))); do if "$@"; then return 0; fi; sleep 0.5; done
  fail "timed out after ${seconds}s waiting for: $what"
}
http_is() { [ "$(status_of "$1")" = "$2" ]; }
sql_is() { [ "$(sql "$1")" = "$2" ]; }
succeeded_is() { [ "$(sql "SELECT count(*) FROM workflow_run WHERE status='succeeded'")" = "$1" ]; }
expect_eq() { [ "$1" = "$2" ] || fail "$3: expected $2, got $1"; echo "  ✔ $3 = $2"; }

start_api() { (cd "$API_DIR" && PORT=$API_PORT exec node dist/server.js >>"$OUT/api.log" 2>&1) & API_PID=$!; wait_for 60 "API ready" http_is "http://localhost:$API_PORT/api/ready" 200; }
start_worker() { (cd "$API_DIR" && WORKER_HEALTH_PORT=$WORKER_HEALTH_PORT FLEQO_SERVICE=fleqo-worker exec node dist/worker.js >>"$OUT/worker.log" 2>&1) & WORKER_PID=$!; wait_for 60 "worker health" http_is "http://localhost:$WORKER_HEALTH_PORT/health" 200; }
stop_process() { kill "-$1" "$2" 2>/dev/null || true; wait "$2" 2>/dev/null || true; }
simulate() { api POST /api/demo/simulate-order "$1"; }

[ -f "$API_DIR/dist/server.js" ] || fail "build the API first: npm run build --workspace=apps/api"

log "Starting throwaway PostgreSQL 18 (:$PG_PORT) and Redis 8 (:$RD_PORT, AOF on, noeviction)"
docker rm -f "$PG" "$RD" >/dev/null 2>&1 || true
docker run -d --name "$PG" -e POSTGRES_USER=fleqo -e POSTGRES_PASSWORD=fleqo -e POSTGRES_DB=fleqo -p "127.0.0.1:$PG_PORT:5432" postgres:18-alpine >/dev/null
docker run -d --name "$RD" -p "127.0.0.1:$RD_PORT:6379" redis:8-alpine redis-server --appendonly yes --maxmemory-policy noeviction >/dev/null
wait_for 60 "PostgreSQL" docker exec "$PG" pg_isready -U fleqo -d fleqo -q
wait_for 30 "Redis" docker exec "$RD" redis-cli ping

log "Release step: prisma migrate deploy"
(cd "$API_DIR" && npx prisma migrate deploy 2>&1 | grep -E "applied|No pending" || true)

log "Starting compiled API (:$API_PORT) and worker (health :$WORKER_HEALTH_PORT) in NODE_ENV=production"
start_api
start_worker

log "Tenant setup: sign-up, organization, 3 connections, active Order Sync, synthetic import"
api POST /api/auth/sign-up/email '{"email":"reliability@example.test","password":"reliability-pass-123","name":"Reliability"}' >/dev/null
api POST /api/organizations '{"name":"Reliability Co"}' >/dev/null
for p in mock_store mock_crm mock_sheet; do api POST /api/connections "{\"provider\":\"$p\"}" >/dev/null; done
api POST /api/workflows '{"name":"Order Sync","enabled":true,"actions":[{"key":"mock_crm.upsert_customer"},{"key":"mock_sheet.append_order"}]}' >/dev/null
api POST /api/demo/import '{"source":"fleqo_synthetic","limit":30}' >/dev/null
expect_eq "$(sql "SELECT count(*) FROM workflow WHERE status='active'")" 1 "active workflows"

log "S1 baseline: 10 signed events"
FIRST_EVENT=$(simulate '{"count":10}' | field 'j.deliveries[0].eventId')
wait_for 60 "10 succeeded" succeeded_is 10
expect_eq "$(sql "SELECT count(*) FROM mock_sheet_row")" 10 "sheet rows"

log "S2 worker down: events are accepted and wait in the queue; restart drains them"
stop_process TERM "$WORKER_PID"
accepted=$(simulate '{"count":10}' | field 'j.deliveries.filter(d=>d.status==="accepted").length')
expect_eq "$accepted" 10 "accepted while worker down"
sleep 3
expect_eq "$(sql "SELECT count(*) FROM workflow_run WHERE status='queued'")" 10 "runs waiting (not lost)"
start_worker
wait_for 90 "20 succeeded" succeeded_is 20

log "S3 Redis outage at ingestion: API keeps accepting (outbox), worker dispatches after recovery"
docker stop "$RD" >/dev/null
expect_eq "$(status_of "http://localhost:$API_PORT/api/ready")" 503 "/api/ready during Redis outage"
accepted=$(simulate '{"count":5}' | field 'j.deliveries.filter(d=>d.status==="accepted").length')
expect_eq "$accepted" 5 "accepted during Redis outage"
expect_eq "$(sql "SELECT count(*) FROM event_dispatch WHERE status='pending'")" 5 "outbox rows pending"
docker start "$RD" >/dev/null
wait_for 30 "Redis back" docker exec "$RD" redis-cli ping
wait_for 120 "25 succeeded" succeeded_is 25
expect_eq "$(sql "SELECT count(*) FROM event_dispatch WHERE status='pending'")" 0 "outbox rows pending after recovery"

log "S4 worker SIGKILL during retry back-off: completed CRM action is never repeated"
CRASH_EVENT=$(simulate '{"count":1,"failures":{"sheet":3}}' | field 'j.deliveries[0].eventId')
wait_for 30 "first Sheet failure" sql_is "SELECT count(*) FROM action_run a JOIN workflow_run r ON r.id=a.\"workflowRunId\" JOIN incoming_event e ON e.id=r.\"incomingEventId\" WHERE e.\"externalEventId\"='$CRASH_EVENT' AND a.\"actionType\"='append_order' AND a.attempts>=1" 1
stop_process KILL "$WORKER_PID"
sleep 2
start_worker
wait_for 120 "26 succeeded" succeeded_is 26
attempts=$(sql "SELECT string_agg(a.\"actionType\"||':'||a.attempts, ',' ORDER BY a.position) FROM action_run a JOIN workflow_run r ON r.id=a.\"workflowRunId\" JOIN incoming_event e ON e.id=r.\"incomingEventId\" WHERE e.\"externalEventId\"='$CRASH_EVENT'")
expect_eq "$attempts" "upsert_customer:1,append_order:4" "action attempts after crash"

log "S5 Redis restart while a retry is scheduled (AOF persistence, or outbox recovery as fallback)"
RESTART_EVENT=$(simulate '{"count":1,"failures":{"sheet":3}}' | field 'j.deliveries[0].eventId')
wait_for 30 "first Sheet failure" sql_is "SELECT count(*) FROM workflow_run r JOIN incoming_event e ON e.id=r.\"incomingEventId\" WHERE e.\"externalEventId\"='$RESTART_EVENT' AND r.status='retrying'" 1
docker restart "$RD" >/dev/null
wait_for 200 "27 succeeded" succeeded_is 27
expect_eq "$(sql "SELECT count(*) FROM mock_sheet_row s JOIN incoming_event e ON e.id=s.\"incomingEventId\" WHERE e.\"externalEventId\"='$RESTART_EVENT'")" 1 "sheet rows for restarted event"

log "S6 PostgreSQL restart: data persists, API and worker reconnect"
before=$(sql "SELECT count(*) FROM mock_sheet_row")
docker restart "$PG" >/dev/null
wait_for 60 "PostgreSQL back" docker exec "$PG" pg_isready -U fleqo -d fleqo -q
wait_for 60 "API ready after PostgreSQL restart" http_is "http://localhost:$API_PORT/api/ready" 200
expect_eq "$(sql "SELECT count(*) FROM mock_sheet_row")" "$before" "sheet rows persisted across restart"
simulate '{"count":5}' >/dev/null
wait_for 90 "32 succeeded" succeeded_is 32

log "S7 API restart: the existing session keeps working (database-backed sessions)"
stop_process TERM "$API_PID"
start_api
expect_eq "$(api GET /api/me | field 'j.user.email')" "reliability@example.test" "session after API restart"

log "S8 duplicate delivery after all restarts"
expect_eq "$(simulate "{\"duplicateOfEventId\":\"$FIRST_EVENT\"}" | field 'j.deliveries[0].status')" duplicate "re-sent first event"
sleep 2

log "Final invariants"
expect_eq "$(sql "SELECT count(*) FROM workflow_run")" 32 "runs"
expect_eq "$(sql "SELECT count(*) FROM workflow_run WHERE status='succeeded'")" 32 "runs succeeded"
expect_eq "$(sql "SELECT count(*) FROM mock_sheet_row")" 32 "sheet rows"
expect_eq "$(sql "SELECT count(*) FROM (SELECT \"orderExternalId\" FROM mock_sheet_row GROUP BY 1 HAVING count(*)>1) d")" 0 "orders with duplicate rows"
expect_eq "$(sql "SELECT count(*) FROM action_run WHERE \"actionType\"='upsert_customer' AND attempts<>1")" 0 "CRM actions executed more than once"
expect_eq "$(sql "SELECT count(*) FROM dead_letter_event")" 0 "dead letters"
customers=$(sql "SELECT count(*) FROM mock_customer")
dupes=$(sql "SELECT coalesce(sum(\"duplicateCount\"),0) FROM incoming_event")
recovered=$(grep -c "Recovered stale run" "$OUT/worker.log" || true)

cat >"$OUT/summary.json" <<JSON
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "mode": "compiled API + worker, NODE_ENV=production, throwaway PostgreSQL 18 + Redis 8",
  "scenarios": ["S1 baseline", "S2 worker down", "S3 Redis outage at ingestion", "S4 worker SIGKILL during back-off", "S5 Redis restart during retry", "S6 PostgreSQL restart", "S7 API restart + session", "S8 duplicate after restarts"],
  "results": { "runs": 32, "runsSucceeded": 32, "sheetRows": 32, "crmCustomers": $customers, "duplicatesAcknowledged": $dupes, "deadLetters": 0, "staleRunRecoveries": $recovered }
}
JSON
log "All reliability scenarios passed. Summary: $OUT/summary.json"
