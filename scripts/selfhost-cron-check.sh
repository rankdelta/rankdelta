#!/usr/bin/env bash
# Scheduled jobs on a self-host: run the one-time Vault setup (supabase/setup/cron-secrets.sql) the way
# SELF_HOSTING.md describes, then fire both pg_cron entry points by hand and check the edge functions
# accept them. This chain (Vault → pg_net → Edge, secret checked through get_cron_secret) is what
# fails silently when any link is missing.
#
#   DB_CONTAINER    the local Supabase Postgres container (supabase_db_…)
#   FUNCTIONS_BASE  URL the database uses to reach the API gateway, e.g. http://supabase_kong_…:8000
set -uo pipefail

DB="${DB_CONTAINER:?set DB_CONTAINER}"
BASE="${FUNCTIONS_BASE:?set FUNCTIONS_BASE}"
failures=0
pass() { echo "ok    $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }
sql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

sed "s#https://<project-ref>.supabase.co#${BASE}#" supabase/setup/cron-secrets.sql | sql >/dev/null &&
  pass "cron-secrets.sql applied" || fail "cron-secrets.sql failed"
# Idempotent, as documented: a second run must change nothing and not fail.
sed "s#https://<project-ref>.supabase.co#${BASE}#" supabase/setup/cron-secrets.sql | sql >/dev/null &&
  pass "cron-secrets.sql is idempotent" || fail "cron-secrets.sql second run failed"

jobs=$(sql -c "select string_agg(jobname, ',' order by jobname) from cron.job where jobname in ('visibility-autoscan','report-schedules-daily')")
[ "$jobs" = "report-schedules-daily,visibility-autoscan" ] && pass "pg_cron jobs scheduled" || fail "pg_cron jobs: '$jobs'"

response() { # $1 request id → "status|first 200 chars of body", waiting for pg_net
  for _ in $(seq 1 30); do
    row=$(sql -c "select status_code || '|' || coalesce(left(content, 200), '') from net._http_response where id = $1")
    [ -n "$row" ] && { echo "$row"; return; }
    sleep 1
  done
  echo "timeout|no response from pg_net"
}

id=$(sql -c "select public.run_visibility_autoscan()")
if [ -z "$id" ]; then
  fail "visibility autoscan did not send a request (Vault secrets not visible?)"
else
  row=$(response "$id")
  case "${row%%|*}" in 2??) pass "visibility-ops accepted the scheduled scan (${row%%|*})" ;; *) fail "visibility-ops answered: $row" ;; esac
fi

# run_due_report_schedules() discards the request id, so wait for the first response newer than
# everything seen so far.
before=$(sql -c "select coalesce(max(id), 0) from net._http_response")
sql -c "select run_due_report_schedules()" >/dev/null
row="timeout|no response from pg_net"
for _ in $(seq 1 30); do
  got=$(sql -c "select status_code || '|' || coalesce(left(content, 200), '') from net._http_response where id > $before order by id limit 1")
  [ -n "$got" ] && { row="$got"; break; }
  sleep 1
done
case "${row%%|*}" in 2??) pass "report-schedule-runner accepted the daily run (${row%%|*})" ;; *) fail "report-schedule-runner answered: $row" ;; esac

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures scheduled-job check(s) failed"
  exit 1
fi
echo "scheduled jobs: all checks passed"
