#!/bin/bash
# 测试 stdio wrapper 是否正常工作

set -e

WRAPPER="/Users/jiangyi/.local/bin/claw-plugin-manager-stdio"
CONTAINER="claw-plugin-manager"

echo "=== Plugin Manager Stdio Wrapper Test ==="
echo

# 1. 检查容器状态
echo "1. Checking container status..."
if podman ps --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    echo "   ✅ Container is running"
else
    echo "   ❌ Container is NOT running"
    echo "   Please start it first:"
    echo "   cd /Users/jiangyi/Documents/codedev/claw_manager && ./scripts/start.sh"
    exit 1
fi
echo

# 2. 检查 wrapper 存在性
echo "2. Checking wrapper..."
if [ -x "$WRAPPER" ]; then
    echo "   ✅ Wrapper is executable: $WRAPPER"
else
    echo "   ❌ Wrapper not found or not executable: $WRAPPER"
    exit 1
fi
echo

# 3. 测试 MCP initialize 请求
echo "3. Testing MCP initialize request..."
INIT_REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

RESPONSE=$(echo "$INIT_REQUEST" | timeout 5 "$WRAPPER" 2>&1 | head -1)

if echo "$RESPONSE" | jq -e '.result.serverInfo.name' > /dev/null 2>&1; then
    SERVER_NAME=$(echo "$RESPONSE" | jq -r '.result.serverInfo.name')
    SERVER_VERSION=$(echo "$RESPONSE" | jq -r '.result.serverInfo.version')
    echo "   ✅ MCP server responded: $SERVER_NAME@$SERVER_VERSION"
else
    echo "   ❌ Failed to get valid response"
    echo "   Response: $RESPONSE"
    exit 1
fi
echo

# 4. 测试 tools/list 请求
echo "4. Testing tools/list request..."
LIST_REQUEST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

TOOLS_RESPONSE=$(echo "$LIST_REQUEST" | timeout 5 "$WRAPPER" 2>&1 | head -1)

if echo "$TOOLS_RESPONSE" | jq -e '.result.tools' > /dev/null 2>&1; then
    TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | jq '.result.tools | length')
    echo "   ✅ Got $TOOL_COUNT tools"

    # 显示前 5 个工具
    echo "   First 5 tools:"
    echo "$TOOLS_RESPONSE" | jq -r '.result.tools[0:5][].name' | sed 's/^/     - /'
else
    echo "   ❌ Failed to list tools"
    echo "   Response: $TOOLS_RESPONSE"
    exit 1
fi
echo

# 5. 检查是否包含关键 MCP 工具
echo "5. Checking for key MCP tools..."
EXPECTED_TOOLS=("query_logs" "query_db" "query_trace")

for TOOL in "${EXPECTED_TOOLS[@]}"; do
    if echo "$TOOLS_RESPONSE" | jq -e ".result.tools[] | select(.name == \"$TOOL\")" > /dev/null 2>&1; then
        echo "   ✅ Found: $TOOL"
    else
        echo "   ⚠️  Not found: $TOOL (may not be configured)"
    fi
done
echo

# 6. 性能测试
echo "6. Performance test (5 sequential requests)..."
TOTAL_TIME=0
for i in {1..5}; do
    START=$(date +%s%N)
    echo "$INIT_REQUEST" | "$WRAPPER" > /dev/null 2>&1
    END=$(date +%s%N)
    ELAPSED=$((($END - $START) / 1000000))  # Convert to milliseconds
    TOTAL_TIME=$(($TOTAL_TIME + $ELAPSED))
    echo "   Request $i: ${ELAPSED}ms"
done
AVG_TIME=$(($TOTAL_TIME / 5))
echo "   Average: ${AVG_TIME}ms"

if [ $AVG_TIME -lt 300 ]; then
    echo "   ✅ Performance is good (< 300ms)"
else
    echo "   ⚠️  Performance is acceptable but could be optimized"
fi
echo

echo "=== All Tests Passed! ==="
echo
echo "Next steps:"
echo "1. Configure Cursor:"
echo "   Add to ~/Documents/code/cash_loan/.cursor/mcp.json:"
echo '   {"mcpServers": {"claw-plugin-manager": {"command": "'$WRAPPER'"}}}'
echo
echo "2. Enable in Cursor:"
echo "   cd ~/Documents/code/cash_loan"
echo "   cursor agent mcp enable claw-plugin-manager"
echo
echo "3. Test in Cursor:"
echo "   cursor agent mcp list-tools claw-plugin-manager"
