#!/bin/bash
# 手动测试 /team create Step 1 流程

echo "=== 测试 /team create Step 1 ==="
echo ""
echo "启动 REPL 后依次输入："
echo ""
echo "1. /team create"
echo "2. Test Team"
echo "3. A test team for demo"
echo "4. [按Enter使用默认路径]"
echo "5. 2"
echo "6. developer"
echo "7. Develops features"
echo "8. reviewer"
echo "9. Reviews code"
echo "10. 3"
echo "11. developer"
echo "12. reviewer"
echo "13. developer"
echo ""
echo "预期结果："
echo "- 显示 '✓ Step 1 Complete!'"
echo "- 显示 'Moving to Step 2'"
echo "- wizardState.step = 2"
echo "- wizardState.data 包含完整的 Step 1 数据"
echo ""
echo "按任意键启动 REPL..."
read -n 1

cd "$(dirname "$0")"
npm run compile > /dev/null 2>&1
node out/cli.js

