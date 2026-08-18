#!/bin/bash
# Agent API 测试脚本
# 用法: bash test-agent-api.sh
# 前提: Electron 应用已启动（端口 1519）

BASE="http://localhost:1519/api/agent"

echo "=== 1. 获取会话列表 ==="
curl -s "$BASE/sessions" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/sessions"
echo ""

echo "=== 2. 创建新会话 ==="
CREATE_RESP=$(curl -s -X POST "$BASE/sessions" \
  -H "Content-Type: application/json" \
  -d '{"title": "API 测试会话"}')
echo "$CREATE_RESP" | python3 -m json.tool 2>/dev/null || echo "$CREATE_RESP"
SESSION_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
echo "会话 ID: $SESSION_ID"
echo ""

if [ -z "$SESSION_ID" ]; then
  echo "创建会话失败，退出"
  exit 1
fi

echo "=== 3. 发送消息（SSE 流式）==="
echo "问题: 你好，请用一句话介绍你自己"
echo "---"
curl -N -X POST "$BASE/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"text": "你好，请用一句话介绍你自己"}' \
  --no-buffer 2>/dev/null | while IFS= read -r line; do
    if [[ "$line" == event:* ]]; then
      echo "[EVENT] ${line#event: }"
    elif [[ "$line" == data:* ]]; then
      echo "[DATA] ${line#data: }"
    fi
  done
echo ""
echo "---"
echo ""

echo "=== 4. 获取会话详情 ==="
curl -s "$BASE/sessions/$SESSION_ID" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/sessions/$SESSION_ID"
echo ""

echo "=== 5. 再次获取会话列表 ==="
curl -s "$BASE/sessions" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/sessions"
echo ""

echo "=== 测试完成 ==="
