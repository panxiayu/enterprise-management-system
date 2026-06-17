#!/bin/bash

# 集成测试脚本 - 测试所有 API 端点

API_URL="http://localhost:3000/api"
TOKEN=""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数
TOTAL=0
PASSED=0
FAILED=0

# 测试函数
test_api() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_code=$4
    local description=$5

    TOTAL=$((TOTAL + 1))
    
    echo -e "\n${YELLOW}测试 $TOTAL: $description${NC}"
    echo "请求: $method $endpoint"

    if [ -z "$data" ]; then
        response=$(curl -s -X $method "$API_URL$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json")
    else
        response=$(curl -s -X $method "$API_URL$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    echo "响应: $response"

    # 检查响应中的 code 字段
    code=$(echo $response | grep -o '"code":[0-9]*' | grep -o '[0-9]*')
    
    if [ "$code" = "$expected_code" ]; then
        echo -e "${GREEN}✓ 通过${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ 失败 (期望 code=$expected_code, 实际 code=$code)${NC}"
        FAILED=$((FAILED + 1))
    fi
}

echo "=========================================="
echo "兴利汽车模具 - 系统集成测试"
echo "=========================================="

# 1. 登录测试
echo -e "\n${YELLOW}=== 第一部分: 认证测试 ===${NC}"

login_response=$(curl -s -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}')

echo "登录响应: $login_response"
TOKEN=$(echo $login_response | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo -e "${RED}登录失败，无法获取 token${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 登录成功，Token: ${TOKEN:0:20}...${NC}"

# 2. 人员管理 API 测试
echo -e "\n${YELLOW}=== 第二部分: 人员管理 API 测试 ===${NC}"

# 添加员工
test_api "POST" "/staff" \
    '{"name":"张三","employee_id":"E'$(date +%s)'","phone":"13800138000","status":"active"}' \
    "0" \
    "添加员工"

# 获取员工列表
test_api "GET" "/staff" "" "0" "获取员工列表"

# 获取员工详情（先获取最新的员工ID）
STAFF_ID=$(curl -s -X GET "$API_URL/staff" \
    -H "Authorization: Bearer $TOKEN" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
test_api "GET" "/staff/$STAFF_ID" "" "0" "获取员工详情"

# 3. 工作任务 API 测试
echo -e "\n${YELLOW}=== 第三部分: 工作任务 API 测试 ===${NC}"

# 创建任务
test_api "POST" "/task" \
    '{"title":"完成Q1报告","type":"exam","assigned_to":1,"priority":"high","status":"pending"}' \
    "0" \
    "创建任务"

# 获取任务列表
test_api "GET" "/task" "" "0" "获取任务列表"

# 获取任务详情（假设 ID 为 1）
test_api "GET" "/task/1" "" "0" "获取任务详情"

# 4. 系统设置 API 测试
echo -e "\n${YELLOW}=== 第四部分: 系统设置 API 测试 ===${NC}"

# 获取系统设置
test_api "GET" "/settings" "" "0" "获取系统设置"

# 更新系统设置
test_api "PUT" "/settings" \
    '{"exam_enabled":"true","exam_max_duration":"120","company_name":"兴利汽车模具"}' \
    "0" \
    "更新系统设置"

# 获取考试设置
test_api "GET" "/settings/exam" "" "0" "获取考试设置"

# 获取报餐设置
test_api "GET" "/settings/meal" "" "0" "获取报餐设置"

# 5. 考试系统 API 测试
echo -e "\n${YELLOW}=== 第五部分: 考试系统 API 测试 ===${NC}"

# 获取考试列表
test_api "GET" "/exam/list" "" "0" "获取考试列表"

# 6. 投票系统 API 测试
echo -e "\n${YELLOW}=== 第六部分: 投票系统 API 测试 ===${NC}"

# 获取投票列表
test_api "GET" "/voting/list" "" "0" "获取投票列表"

# 7. 报餐系统 API 测试
echo -e "\n${YELLOW}=== 第七部分: 报餐系统 API 测试 ===${NC}"

# 获取报餐列表
test_api "GET" "/meal/list" "" "0" "获取报餐列表"

# 测试总结
echo -e "\n=========================================="
echo -e "${YELLOW}测试总结${NC}"
echo "=========================================="
echo -e "总测试数: $TOTAL"
echo -e "${GREEN}通过: $PASSED${NC}"
echo -e "${RED}失败: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✓ 所有测试通过！${NC}"
    exit 0
else
    echo -e "\n${RED}✗ 有 $FAILED 个测试失败${NC}"
    exit 1
fi
