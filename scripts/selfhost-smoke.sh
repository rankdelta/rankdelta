#!/usr/bin/env bash
# Self-host smoke test: edge functions served with SELF_HOST=true must answer the browser app on its
# own origin and never send users to the cloud. Runs against a local `supabase start` + `functions serve`.
#
#   FUNCTIONS_URL      default http://127.0.0.1:54321/functions/v1
#   SMOKE_APP_ORIGIN   default http://localhost:8080 (the Docker frontend)
set -uo pipefail

BASE="${FUNCTIONS_URL:-http://127.0.0.1:54321/functions/v1}"
APP="${SMOKE_APP_ORIGIN:-http://localhost:8080}"
CLOUD="https://rankdelta.ai"
failures=0

pass() { echo "ok    $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }

allow_origin() { # $1 function, $2 origin → the Access-Control-Allow-Origin it answers
  curl -s -o /dev/null -D - -X OPTIONS "$BASE/$1" \
    -H "Origin: $2" -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization, content-type' |
    tr -d '\r' | awk -F': ' 'tolower($1) == "access-control-allow-origin" { print $2 }'
}

# Wait for the edge runtime to load the functions.
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/seo-proxy" -H "Origin: $APP" || true)
  case "$code" in 000 | 502 | 503) sleep 2 ;; *) break ;; esac
done

for fn in seo-proxy visibility-ops api-keys wp-publish delete-account; do
  got=$(allow_origin "$fn" "$APP")
  [ "$got" = "$APP" ] && pass "CORS $fn allows $APP" || fail "CORS $fn: expected '$APP', got '${got:-<none>}'"
  got=$(allow_origin "$fn" "$CLOUD")
  [ -z "$got" ] && pass "CORS $fn does not trust $CLOUD" || fail "CORS $fn trusts $CLOUD on a self-hosted backend"
done

prm=$(curl -s "$BASE/mcp/.well-known/oauth-protected-resource/mcp")
if echo "$prm" | jq -e '.resource and (.authorization_servers | length > 0)' >/dev/null 2>&1; then
  pass "MCP protected-resource metadata served"
else
  fail "MCP protected-resource metadata: $prm"
fi
echo "$prm" | grep -q 'rankdelta\.ai' && fail "MCP metadata points at the cloud: $prm" || pass "MCP metadata stays on this install"

authorize="$BASE/mcp/authorize?response_type=code&client_id=smoke&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=abc&code_challenge_method=S256"
location=$(curl -s -o /dev/null -w '%{redirect_url}' "$authorize")
case "$location" in
  "$APP/oauth/mcp-authorize"*) pass "MCP sign-in opens on $APP" ;;
  *) fail "MCP sign-in redirect: expected $APP/oauth/mcp-authorize…, got '${location:-<none>}'" ;;
esac

# The cloud's public AI-visibility widget must not be open on a self-host: anyone could spend the LLM key.
anon_bearer="${SMOKE_ANON_KEY:-none}"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/ai-visibility-check" -H "Authorization: Bearer $anon_bearer" \
  -H 'Content-Type: application/json' -d '{"domain":"example.org","email":"smoke@example.com","lang":"en"}')
[ "$code" = "401" ] && pass "ai-visibility-check refuses anonymous calls" || fail "ai-visibility-check without a session: expected 401, got $code"

# Missing provider keys must reach the browser as a readable, actionable error (needs a user JWT).
if [ -n "${SMOKE_AUTH_URL:-}" ] && [ -n "${SMOKE_ANON_KEY:-}" ]; then
  token=$(curl -s -X POST "$SMOKE_AUTH_URL/signup" -H "apikey: $SMOKE_ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"smoke-$(date +%s)@example.com\",\"password\":\"Smoke-selfhost-9fX!\"}" | jq -r '.access_token // empty')
  if [ -z "$token" ]; then
    fail "could not sign up a smoke user at $SMOKE_AUTH_URL"
  else
    headers=$(mktemp)
    body=$(curl -s -D "$headers" -X POST "$BASE/seo-proxy" -H "Origin: $APP" -H "Authorization: Bearer $token" \
      -H "apikey: $SMOKE_ANON_KEY" -H 'Content-Type: application/json' \
      -d '{"action":"dataforseo","endpoint":"/serp/google/organic/live/advanced","payload":[]}')
    got=$(tr -d '\r' <"$headers" | awk -F': ' 'tolower($1) == "access-control-allow-origin" { print $2 }')
    [ "$got" = "$APP" ] && pass "missing-key error carries CORS for $APP" || fail "missing-key error without CORS (got '${got:-<none>}')"
    echo "$body" | grep -q 'DATAFORSEO_LOGIN' && pass "missing-key error names DATAFORSEO_LOGIN" || fail "missing-key error: $body"
    rm -f "$headers"
  fi
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures self-host smoke check(s) failed"
  exit 1
fi
echo "self-host smoke: all checks passed"
