#!/usr/bin/env bash
#
# WenFlow 本地开发一键启动（Linux / macOS）。
#
# 用法：
#   ./start-dev.sh                # 生成 Prisma Client、部署迁移、同步 core prompts，然后起前后端
#   ./start-dev.sh --skip-prisma  # 跳过 Prisma / prompts 同步（数据库已就绪时更快）
#   ./start-dev.sh --no-browser   # 不自动打开浏览器
#   ./start-dev.sh --help
#
# 说明：
#   - Windows 请用 start-dev.ps1；不想在本机装依赖的请优先 docker-start.sh。
#   - 本脚本覆盖「本机开发」路径；Nginx / 局域网部署请走 Docker 或 PowerShell 脚本。
#
set -euo pipefail

NO_BROWSER=0
SKIP_PRISMA=0
for arg in "$@"; do
  case "$arg" in
    --no-browser) NO_BROWSER=1 ;;
    --skip-prisma) SKIP_PRISMA=1 ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
      exit 0 ;;
    *) echo "未知参数: $arg（可用: --no-browser --skip-prisma --help）" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_ENV="$BACKEND_DIR/.env"
BACKEND_READY_URL="http://localhost:3001/readyz"
FRONTEND_READY_URL="http://localhost:5173"

c_reset="\033[0m"; c_cyan="\033[0;36m"; c_green="\033[0;32m"; c_yellow="\033[1;33m"; c_red="\033[0;31m"
info(){ printf "${c_cyan}%s${c_reset}\n" "$*"; }
ok(){ printf "${c_green}%s${c_reset}\n" "$*"; }
warn(){ printf "${c_yellow}%s${c_reset}\n" "$*"; }
die(){ printf "${c_red}%s${c_reset}\n" "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "未检测到 node，请安装 Node.js >= 20.17"
command -v npm  >/dev/null 2>&1 || die "未检测到 npm"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 版本过低（$(node -v)），需要 >= 20.17"

if [ ! -f "$BACKEND_ENV" ]; then
  warn "缺少 backend/.env"
  cat <<'EOF'
  请先配置环境变量（至少 JWT_SECRET >= 32 字符、AI_API_KEY）：
    cp backend/.env.example backend/.env
    然后编辑 backend/.env
  不想手工配置的话，可直接用 Docker： ./docker-start.sh
EOF
  exit 1
fi

ensure_deps(){
  local dir="$1" name="$2"
  if [ ! -d "$dir/node_modules" ]; then
    warn "$name 依赖缺失，执行 npm install ..."
    ( cd "$dir" && npm install )
  fi
}
ensure_deps "$BACKEND_DIR" "backend"
ensure_deps "$FRONTEND_DIR" "frontend"

if [ "$SKIP_PRISMA" -eq 0 ]; then
  info "生成 Prisma Client 并部署迁移 ..."
  ( cd "$BACKEND_DIR" && npm run prisma:prepare )
  info "同步 core prompts ..."
  ( cd "$BACKEND_DIR" && npm run prompts:sync-core ) || warn "prompts:sync-core 失败，继续启动（可稍后手动重跑）"
fi

port_in_use(){
  local port="$1"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3>&- 3<&-
    return 0
  fi
  return 1
}
for p in 3001 5173; do
  port_in_use "$p" && die "端口 $p 已被占用，请先停掉占用进程"
done

wait_ready(){
  local url="$1" tries="${2:-60}"
  for _ in $(seq 1 "$tries"); do
    if command -v curl >/dev/null 2>&1; then
      curl -fsS "$url" >/dev/null 2>&1 && return 0
    else
      node -e 'fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' "$url" 2>/dev/null && return 0
    fi
    sleep 2
  done
  return 1
}

PIDS=()
cleanup(){
  warn "正在停止 WenFlow 开发进程 ..."
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

info "启动后端 (http://localhost:3001) ..."
( cd "$BACKEND_DIR" && npm run dev:server ) &
PIDS+=("$!")

if wait_ready "$BACKEND_READY_URL"; then
  ok "后端就绪：http://localhost:3001/health"
else
  warn "后端在 120s 内未就绪，请查看上方日志"
fi

info "启动前端 (http://localhost:5173) ..."
( cd "$FRONTEND_DIR" && npm run dev ) &
PIDS+=("$!")

if wait_ready "$FRONTEND_READY_URL"; then
  ok "前端就绪：http://localhost:5173"
else
  warn "前端在 120s 内未就绪，请查看上方日志"
fi

echo
ok "WenFlow 已启动（Ctrl+C 停止）"
echo "  前端:     http://localhost:5173"
echo "  管理后台: http://localhost:5173/admin"
echo "  后端 API: http://localhost:3001/api"
echo "  健康检查: http://localhost:3001/health"

if [ "$NO_BROWSER" -eq 0 ]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:5173" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:5173" >/dev/null 2>&1 || true
  fi
fi

wait
