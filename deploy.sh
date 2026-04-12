#!/bin/bash

set -e

echo "🚀 开始部署 WenFlow..."

# 颜色定义
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 1. 拉取最新代码
echo -e "${CYAN}[1/8] 拉取最新代码...${NC}"
if [ -d ".git" ]; then
    git pull origin main || echo -e "${YELLOW}⚠️  代码拉取失败，继续部署...${NC}"
else
    echo -e "${YELLOW}ℹ️  非 Git 仓库，跳过代码拉取${NC}"
fi

# 2. 检查环境变量
echo -e "${CYAN}[2/8] 检查环境变量...${NC}"
if [ ! -f backend/.env.production ]; then
    echo -e "${RED}❌ 错误：backend/.env.production 文件不存在${NC}"
    echo -e "${YELLOW}请从 backend/.env.production.example 复制并修改${NC}"
    echo "命令：cp backend/.env.production.example backend/.env.production"
    exit 1
fi

if [ ! -f frontend/.env.production ]; then
    echo -e "${YELLOW}ℹ️  frontend/.env.production 不存在，使用默认配置${NC}"
fi

# 3. 检查 Docker
echo -e "${CYAN}[3/8] 检查 Docker 环境...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ 错误：Docker 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker 已安装：$(docker --version)${NC}"

if ! command -v docker compose &> /dev/null; then
    echo -e "${RED}❌ 错误：Docker Compose 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker Compose 已安装：$(docker compose version)${NC}"

# 4. 创建必要的目录
echo -e "${CYAN}[4/8] 创建必要的目录...${NC}"
mkdir -p backend/logs nginx/ssl
echo -e "${GREEN}  ✅ 目录创建完成${NC}"

# 5. 构建 Docker 镜像
echo -e "${CYAN}[5/8] 构建 Docker 镜像...${NC}"
docker compose build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 镜像构建失败${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 镜像构建完成${NC}"

# 6. 启动服务
echo -e "${CYAN}[6/8] 启动服务...${NC}"
docker compose up -d
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 服务启动失败${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 服务启动完成${NC}"

# 7. 等待服务就绪
echo -e "${CYAN}[7/8] 等待服务就绪...${NC}"
sleep 15

# 8. 健康检查
echo -e "${CYAN}[8/8] 健康检查...${NC}"

# 后端健康检查
if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 后端健康检查通过${NC}"
else
    echo -e "${RED}❌ 后端健康检查失败${NC}"
    echo -e "${YELLOW}查看日志：docker compose logs backend${NC}"
    exit 1
fi

# 前端健康检查
if curl -f http://localhost:5173 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 前端健康检查通过${NC}"
else
    echo -e "${RED}❌ 前端健康检查失败${NC}"
    echo -e "${YELLOW}查看日志：docker compose logs frontend${NC}"
    exit 1
fi

# 部署完成
echo ""
echo "========================================"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "========================================"
echo ""
echo -e "服务访问地址:"
echo -e "  前端：${CYAN}http://localhost:5173${NC}"
echo -e "  后端：${CYAN}http://localhost:3001${NC}"
echo -e "  API 文档：${CYAN}http://localhost:3001/api/docs${NC}"
echo ""
echo -e "查看日志:"
echo -e "  ${YELLOW}docker compose logs -f backend${NC}"
echo -e "  ${YELLOW}docker compose logs -f frontend${NC}"
echo ""
echo -e "停止服务:"
echo -e "  ${YELLOW}docker compose down${NC}"
echo ""
echo -e "重启服务:"
echo -e "  ${YELLOW}docker compose restart${NC}"
echo ""
