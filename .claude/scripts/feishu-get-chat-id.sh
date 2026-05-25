#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/feishu-config.json"
TOKEN_CACHE="$SCRIPT_DIR/.feishu-token-cache"

log() { echo "[feishu-get-chat] $(date '+%H:%M:%S') $*"; }

# --- read config ---
APP_ID=$(jq -r '.app_id' "$CONFIG_FILE")
APP_SECRET=$(jq -r '.app_secret' "$CONFIG_FILE")

# --- get token ---
RESP=$(curl -sS --max-time 10 \
  -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$APP_ID" --arg secret "$APP_SECRET" \
    '{app_id: $id, app_secret: $secret}')")

TOKEN=$(echo "$RESP" | jq -r '.tenant_access_token // empty')
if [[ -z "$TOKEN" ]]; then
  log "ERROR: auth failed: $RESP"
  exit 1
fi

echo "=== 最近会话 ==="
CHATS=$(curl -sS --max-time 10 \
  -X GET "https://open.feishu.cn/open-apis/im/v1/chats?page_size=20" \
  -H "Authorization: Bearer $TOKEN")

echo "$CHATS" | jq -r '.data.items[]? | "  chat_id: \(.chat_id)\n  name: \(.name // "私聊")\n  type: \(.chat_type)\n---"'

echo ""
echo "若上面没有结果，请确认："
echo "  1. 已在飞书开发者后台为应用添加权限: im:chat"
echo "  2. 已经给机器人发送过一条消息"
echo ""
echo "找到目标会话的 chat_id 后，手动填入 feishu-config.json 的 chat_id 字段"
