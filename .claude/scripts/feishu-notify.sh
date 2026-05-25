#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/feishu-config.json"
TOKEN_CACHE="$SCRIPT_DIR/.feishu-token-cache"

log() { echo "[feishu-notify] $(date '+%H:%M:%S') $*" >&2; }

# --- parse args ---
TITLE=""
BODY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --body)  BODY="$2"; shift 2 ;;
    *)       BODY="$1"; shift ;;
  esac
done

if [[ -z "$BODY" ]]; then
  log "ERROR: message body is required (--body '...')"
  exit 1
fi

# --- read config ---
APP_ID=$(jq -r '.app_id' "$CONFIG_FILE")
APP_SECRET=$(jq -r '.app_secret' "$CONFIG_FILE")
CHAT_ID=$(jq -r '.chat_id' "$CONFIG_FILE")

if [[ -z "$APP_ID" || -z "$APP_SECRET" ]]; then
  log "ERROR: feishu-config.json missing app_id or app_secret"
  exit 1
fi

if [[ -z "$CHAT_ID" || "$CHAT_ID" == "null" ]]; then
  log "ERROR: chat_id not configured. Send a message to the bot first, then run feishu-get-chat-id.sh"
  exit 1
fi

# --- get access token (with cache) ---
get_token() {
  if [[ -f "$TOKEN_CACHE" ]]; then
    local cached_at; cached_at=$(head -1 "$TOKEN_CACHE")
    local cached_token; cached_token=$(tail -1 "$TOKEN_CACHE")
    local now; now=$(date +%s)
    local age=$((now - cached_at))
    if [[ $age -lt 5400 ]]; then  # 1.5h, token valid for 2h
      echo "$cached_token"
      return
    fi
  fi

  local resp; resp=$(curl -sS --max-time 10 \
    -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg id "$APP_ID" --arg secret "$APP_SECRET" \
      '{app_id: $id, app_secret: $secret}')")

  local token; token=$(echo "$resp" | jq -r '.tenant_access_token // empty')
  if [[ -z "$token" ]]; then
    log "ERROR: failed to get access token: $resp"
    exit 1
  fi

  echo "$(date +%s)" > "$TOKEN_CACHE"
  echo "$token" >> "$TOKEN_CACHE"
  echo "$token"
}

TOKEN=$(get_token)

# --- build message content ---
if [[ -n "$TITLE" ]]; then
  CONTENT=$(jq -n --arg title "$TITLE" --arg body "$BODY" \
    '{text: ("🔔 \($title)\n\n\($body)")}')
else
  CONTENT=$(jq -n --arg body "$BODY" '{text: $body}')
fi

MSG_BODY=$(jq -n --arg content "$CONTENT" \
  --arg chat_id "$CHAT_ID" \
  '{receive_id: $chat_id, msg_type: "text", content: $content}')

# --- send message ---
RESP=$(curl -sS --max-time 10 \
  -X POST "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$MSG_BODY")

CODE=$(echo "$RESP" | jq -r '.code // -1')
if [[ "$CODE" != "0" ]]; then
  log "ERROR: send failed: $RESP"
  exit 1
fi

log "OK: message sent"
