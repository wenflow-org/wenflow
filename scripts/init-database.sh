#!/bin/bash

# 数据库初始化脚本

set -e

echo "🗄️  开始初始化数据库..."

# 颜色定义
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 检查 Docker 是否运行
if ! docker compose ps > /dev/null 2>&1; then
    echo -e "${RED}❌ 错误：Docker Compose 服务未运行${NC}"
    echo -e "${YELLOW}请先运行：docker compose up -d${NC}"
    exit 1
fi

# 等待数据库就绪
echo -e "${CYAN}[1/4] 等待数据库就绪...${NC}"
sleep 5

# 生成 Prisma 客户端
echo -e "${CYAN}[2/4] 生成 Prisma 客户端...${NC}"
docker compose exec backend npx prisma generate
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Prisma 生成失败${NC}"
    exit 1
fi

# 执行数据库迁移
echo -e "${CYAN}[3/4] 执行数据库迁移...${NC}"
docker compose exec backend npx prisma migrate deploy
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 数据库迁移失败${NC}"
    exit 1
fi

# 创建管理员账户（可选）
echo -e "${CYAN}[4/4] 数据库初始化完成！${NC}"
echo ""
echo -e "${GREEN}✅ 数据库初始化成功！${NC}"
echo ""
echo "下一步:"
echo "  1. 创建管理员账户：node create-admin.js"
echo "  2. 查看数据库：docker compose exec backend npx prisma studio"
echo "  3. 查看日志：docker compose logs -f backend"
echo ""
