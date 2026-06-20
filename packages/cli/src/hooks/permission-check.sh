#!/bin/bash
# ──────────────────────────────────────────────
# Agent Hub Permission Check — Claude Code PreToolUse Hook
# 当 Claude Code 每次调用工具前触发
# 注册方式：agent-hub hook install
# ──────────────────────────────────────────────

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // "{}"')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')

# 读取本地配置目录
AGENT_HUB_DIR="${HOME}/.agent-hub"
CONFIG_FILE="${AGENT_HUB_DIR}/config.json"
PERM_FILE="${AGENT_HUB_DIR}/permissions.json"

# 如果配置或权限文件不存在 → 未连接或未 sync，放行
if [ ! -f "$CONFIG_FILE" ] || [ ! -f "$PERM_FILE" ]; then
  echo '{"permissionDecision": "allow"}'
  exit 0
fi

# 映射工具名到 Agent Hub 工具类型
case "$TOOL_NAME" in
  "Edit"|"Write")             FRAMEWORK_TOOL="edit" ;;
  "Bash"|"Execute")           FRAMEWORK_TOOL="bash" ;;
  "Read")                     FRAMEWORK_TOOL="read" ;;
  "WebFetch"|"Fetch")         FRAMEWORK_TOOL="webfetch" ;;
  *)                           FRAMEWORK_TOOL="" ;;
esac

# 如果无法映射到已知工具 → 放行
if [ -z "$FRAMEWORK_TOOL" ]; then
  echo '{"permissionDecision": "allow"}'
  exit 0
fi

# 读取权限规则，用 python3 解析 JSON（比 jq 更跨平台）
DECISION=$(python3 -c "
import json, sys

try:
    with open('$PERM_FILE', 'r') as f:
        perm = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    print('allow')
    sys.exit(0)

rules = perm.get('rules', {})
safety_mode = perm.get('safetyMode', False)
tool = '$FRAMEWORK_TOOL'

# 安全模式下 deny bash
if safety_mode and tool == 'bash':
    print('deny')
    sys.exit(0)

# 检查 tool 配置
rule = rules.get(tool, {})
if rule.get('deny', False):
    print('deny')
elif rule.get('ask', False):
    print('ask')
else:
    # allow 或无规则 → 放行
    print('allow')
" 2>/dev/null || echo "allow")

echo "{\"permissionDecision\": \"$DECISION\"}"