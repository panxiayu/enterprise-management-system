#!/bin/bash

# 投票系统和报餐系统测试脚本

BASE_URL="http://localhost:3000"
ADMIN_TOKEN=""
USER_TOKEN=""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== 投票系统和报餐系统测试 ===${NC}\n"

# 1. 登录获取 token
echo -e "${YELLOW}1. 登录获取 token${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"openid":"test_user_001"}')

USER_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo -e "${GREEN}✓ 用户 token: ${USER_TOKEN:0:20}...${NC}\n"

# 2. 创建投票
echo -e "${YELLOW}2. 创建投票${NC}"
VOTING_RESPONSE=$(curl -s -X POST "$BASE_URL/api/voting/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{
    "title": "午餐投票",
    "description": "选择今天的午餐",
    "options": ["红烧肉", "清蒸鱼", "宫保鸡丁"],
    "deadline": "2026-03-26T12:00:00Z",
    "multipleChoice": false
  }')

VOTING_ID=$(echo $VOTING_RESPONSE | grep -o '"votingId":[0-9]*' | cut -d':' -f2)
echo -e "${GREEN}✓ 投票 ID: $VOTING_ID${NC}"
echo -e "响应: $VOTING_RESPONSE\n"

# 3. 获取投票列表
echo -e "${YELLOW}3. 获取投票列表${NC}"
curl -s -X GET "$BASE_URL/api/voting/list" \
  -H "Authorization: Bearer $USER_TOKEN" | jq .
echo ""

# 4. 获取投票详情
echo -e "${YELLOW}4. 获取投票详情${NC}"
curl -s -X GET "$BASE_URL/api/voting/$VOTING_ID" \
  -H "Authorization: Bearer $USER_TOKEN" | jq .
echo ""

# 5. 投票
echo -e "${YELLOW}5. 投票${NC}"
curl -s -X POST "$BASE_URL/api/voting/$VOTING_ID/vote" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"optionIds": [1]}' | jq .
echo ""

# 6. 创建报餐活动
echo -e "${YELLOW}6. 创建报餐活动${NC}"
MEAL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/meal/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{
    "title": "周一午餐报餐",
    "description": "请选择您的午餐",
    "deadline": "2026-03-26T11:00:00Z",
    "menus": [
      {"name": "红烧肉", "price": 15, "description": "精选猪肉"},
      {"name": "清蒸鱼", "price": 18, "description": "新鲜海鱼"},
      {"name": "宫保鸡丁", "price": 12, "description": "辣味鸡丁"}
    ]
  }')

MEAL_ID=$(echo $MEAL_RESPONSE | grep -o '"activityId":[0-9]*' | cut -d':' -f2)
echo -e "${GREEN}✓ 报餐活动 ID: $MEAL_ID${NC}"
echo -e "响应: $MEAL_RESPONSE\n"

# 7. 获取报餐活动列表
echo -e "${YELLOW}7. 获取报餐活动列表${NC}"
curl -s -X GET "$BASE_URL/api/meal/list" \
  -H "Authorization: Bearer $USER_TOKEN" | jq .
echo ""

# 8. 获取报餐活动详情
echo -e "${YELLOW}8. 获取报餐活动详情${NC}"
curl -s -X GET "$BASE_URL/api/meal/$MEAL_ID" \
  -H "Authorization: Bearer $USER_TOKEN" | jq .
echo ""

# 9. 报餐
echo -e "${YELLOW}9. 报餐${NC}"
curl -s -X POST "$BASE_URL/api/meal/$MEAL_ID/order" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"menuId": 1, "quantity": 2, "remarks": "不要辣"}' | jq .
echo ""

echo -e "${GREEN}=== 测试完成 ===${NC}"
