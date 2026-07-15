#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/backend/.env"
ENV_EXAMPLE="$SCRIPT_DIR/backend/.env.example"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}================================${NC}"
echo -e "${CYAN}${BOLD}  WenFlow Docker 一键启动      ${NC}"
echo -e "${CYAN}${BOLD}================================${NC}"
echo ""

# ==========================================
# 前置检查
# ==========================================

if ! command -v docker &>/dev/null; then
    echo -e "${RED}错误: 未检测到 Docker，请先安装 Docker${NC}"
    echo "  https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo -e "${RED}错误: docker compose 不可用，需要 Docker Compose v2+${NC}"
    exit 1
fi

# ==========================================
# 1. 确保 .env 存在
# ==========================================

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        echo -e "${GREEN}> 已从 .env.example 创建 backend/.env${NC}"
        echo ""
    else
        echo -e "${RED}错误: backend/.env.example 不存在${NC}"
        exit 1
    fi
fi

# ==========================================
# 辅助函数
# ==========================================

get_env() {
    local key="$1"
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | sed 's/^[^=]*=//'
}

set_env() {
    local key="$1"
    local value="$2"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        case "$(uname -s)" in
            Darwin) sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" ;;
            *)      sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" ;;
        esac
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

generate_secret() {
    if command -v openssl &>/dev/null; then
        openssl rand -base64 48 2>/dev/null
    elif [ -c /dev/urandom ]; then
        head -c 48 /dev/urandom 2>/dev/null | base64 2>/dev/null || echo ""
    else
        date +%s | sha256sum 2>/dev/null | cut -c1-64 || date +%s | shasum -a 256 2>/dev/null | cut -c1-64 || echo ""
    fi
}

is_placeholder() {
    local val="$1"
    [ -z "$val" ] && return 0
    for p in "sk-your-api-key" "your-api-key"; do
        [ "$val" = "$p" ] && return 0
    done
    return 1
}

# ==========================================
# 判断交互模式
# ==========================================

NON_INTERACTIVE=false
if [ -n "${JWT_SECRET:-}" ] || [ -n "${AI_API_KEY:-}" ]; then
    NON_INTERACTIVE=true
    echo -e "${YELLOW}> 检测到环境变量传入，跳过交互提示${NC}"
    echo ""
fi

# ==========================================
# 2. JWT_SECRET
# ==========================================

JWT=$(get_env "JWT_SECRET")
if [ ${#JWT} -lt 32 ]; then
    if [ "$NON_INTERACTIVE" = true ] && [ -n "${JWT_SECRET:-}" ]; then
        JWT="$JWT_SECRET"
    else
        echo -e "${YELLOW}> JWT_SECRET 未设置或长度不足（需 >= 32 字符）${NC}"
        read -r -p "  输入 JWT_SECRET (回车 = 自动生成): " input
        if [ -z "$input" ]; then
            JWT=$(generate_secret)
            echo -e "${GREEN}  已自动生成 JWT_SECRET${NC}"
        else
            JWT="$input"
        fi
        echo ""
    fi
    set_env "JWT_SECRET" "$JWT"
fi
echo -e "${GREEN}> JWT_SECRET: 已配置${NC}"

# ==========================================
# 3. AI_API_KEY
# ==========================================

AI_KEY=$(get_env "AI_API_KEY")
if is_placeholder "$AI_KEY"; then
    if [ "$NON_INTERACTIVE" = true ] && [ -n "${AI_API_KEY:-}" ]; then
        AI_KEY="$AI_API_KEY"
    else
        echo ""
        echo -e "${YELLOW}> AI_API_KEY 未设置或仍为占位值${NC}"
        read -r -p "  AI_API_KEY (必填): " input
        if [ -n "$input" ]; then
            AI_KEY="$input"
        fi
        echo ""
    fi
    if ! is_placeholder "$AI_KEY" && [ -n "$AI_KEY" ]; then
        set_env "AI_API_KEY" "$AI_KEY"
    fi
fi
AI_KEY_FINAL=$(get_env "AI_API_KEY")
if is_placeholder "$AI_KEY_FINAL"; then
    echo -e "${YELLOW}> AI_API_KEY: 未配置 (AI 功能将不可用)${NC}"
else
    echo -e "${GREEN}> AI_API_KEY: 已配置${NC}"
fi

# ==========================================
# 4-7. 交互式可选配置
# ==========================================

if [ "$NON_INTERACTIVE" != true ]; then
    echo ""

    # AI_API_URL
    CURRENT=$(get_env "AI_API_URL")
    [ -z "$CURRENT" ] && CURRENT="https://api.deepseek.com"
    read -r -p "  AI_API_URL [$CURRENT]: " input
    [ -n "$input" ] && set_env "AI_API_URL" "$input"

    # AI_MODEL
    CURRENT=$(get_env "AI_MODEL")
    [ -z "$CURRENT" ] && CURRENT="deepseek-v4-flash"
    read -r -p "  AI_MODEL [$CURRENT]: " input
    [ -n "$input" ] && set_env "AI_MODEL" "$input"

    # AI_MODEL_REASONING
    CURRENT=$(get_env "AI_MODEL_REASONING")
    [ -z "$CURRENT" ] && CURRENT="deepseek-v4-pro"
    read -r -p "  AI_MODEL_REASONING [$CURRENT]: " input
    [ -n "$input" ] && set_env "AI_MODEL_REASONING" "$input"

    echo ""

    # 管理员
    CURRENT=$(get_env "INIT_ADMIN_NAME")
    [ -z "$CURRENT" ] && CURRENT="admin"
    read -r -p "  管理员用户名 [$CURRENT]: " input
    [ -n "$input" ] && set_env "INIT_ADMIN_NAME" "$input"

    read -r -p "  管理员密码 (回车保持当前): " input
    [ -n "$input" ] && set_env "INIT_ADMIN_PASSWORD" "$input"
fi

# ==========================================
# 8. 配置摘要
# ==========================================

echo ""
echo -e "${BOLD}────────── 配置摘要 ──────────${NC}"

AI_FINAL=$(get_env "AI_API_KEY")
if is_placeholder "$AI_FINAL"; then
    AI_STATUS="${YELLOW}警告${NC}"
else
    AI_STATUS="${GREEN}已配置${NC}"
fi

JWT_FINAL=$(get_env "JWT_SECRET")
if [ ${#JWT_FINAL} -ge 32 ]; then
    JWT_STATUS="${GREEN}已配置${NC}"
else
    JWT_STATUS="${RED}无效${NC}"
fi

printf "  %-20s %b\n" "JWT_SECRET" "$JWT_STATUS"
printf "  %-20s %b\n" "AI_API_KEY" "$AI_STATUS"
printf "  %-20s %s\n" "AI_API_URL" "$(get_env "AI_API_URL")"
printf "  %-20s %s\n" "AI_MODEL" "$(get_env "AI_MODEL")"
printf "  %-20s %s\n" "AI_MODEL_REASONING" "$(get_env "AI_MODEL_REASONING")"
printf "  %-20s %s\n" "管理员" "$(get_env "INIT_ADMIN_NAME")"

if [ ${#JWT_FINAL} -lt 32 ]; then
    echo ""
    echo -e "${RED}JWT_SECRET 无效，后端将拒绝启动。请重新运行此脚本。${NC}"
    exit 1
fi

# ==========================================
# 9. 构建并启动
# ==========================================

echo ""
echo -e "${CYAN}${BOLD}> 构建并启动 Docker 容器...${NC}"
echo ""
docker compose up -d --build

# ==========================================
# 10. 等待后端就绪
# ==========================================

echo ""
printf "> 等待后端启动"

for i in $(seq 1 30); do
    if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}> 后端已就绪${NC}"
        break
    fi
    printf "."
    sleep 2
done

# ==========================================
# 11. 完成
# ==========================================

echo ""
echo -e "${GREEN}${BOLD}================================${NC}"
echo -e "${GREEN}${BOLD}  WenFlow 启动完成              ${NC}"
echo -e "${GREEN}${BOLD}================================${NC}"
echo ""
echo -e "  访问地址   ${CYAN}http://localhost${NC}"
echo -e "  健康检查   ${CYAN}http://localhost/health${NC}"
echo -e "  后端 API   ${CYAN}http://localhost:3001/health${NC}"
echo ""
echo "管理命令:"
echo "  docker compose logs -f      # 查看日志"
echo "  docker compose down         # 停止并清理容器"
echo "  docker compose restart      # 重启服务"
echo ""
