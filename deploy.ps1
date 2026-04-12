# AI Learning Platform 部署脚本 (PowerShell)
# 适用于 Windows 环境

Write-Host "🚀 开始部署 AI Learning Platform..." -ForegroundColor Green

# 设置错误处理
$ErrorActionPreference = "Stop"

# 1. 拉取最新代码
Write-Host "[1/8] 拉取最新代码..." -ForegroundColor Cyan
if (Test-Path .git) {
    git pull origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠️  代码拉取失败，继续部署..." -ForegroundColor Yellow
    }
} else {
    Write-Host "ℹ️  非 Git 仓库，跳过代码拉取" -ForegroundColor Yellow
}

# 2. 检查环境变量
Write-Host "[2/8] 检查环境变量..." -ForegroundColor Cyan
if (-not (Test-Path backend\.env.production)) {
    Write-Host "❌ 错误：backend\.env.production 文件不存在" -ForegroundColor Red
    Write-Host "请从 backend\.env.production.example 复制并修改" -ForegroundColor Yellow
    Write-Host "命令：Copy-Item backend\.env.production.example backend\.env.production" -ForegroundColor Gray
    exit 1
}

if (-not (Test-Path frontend\.env.production)) {
    Write-Host "ℹ️  frontend\.env.production 不存在，使用默认配置" -ForegroundColor Yellow
}

# 3. 检查 Docker
Write-Host "[3/8] 检查 Docker 环境..." -ForegroundColor Cyan
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker 已安装：$dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ 错误：Docker 未安装" -ForegroundColor Red
    exit 1
}

try {
    $composeVersion = docker compose version
    Write-Host "✅ Docker Compose 已安装：$composeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ 错误：Docker Compose 未安装" -ForegroundColor Red
    exit 1
}

# 4. 创建必要的目录
Write-Host "[4/8] 创建必要的目录..." -ForegroundColor Cyan
$directories = @(
    "backend\logs",
    "nginx\ssl"
)

foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Host "  ✅ 创建目录：$dir" -ForegroundColor Green
    }
}

# 5. 构建 Docker 镜像
Write-Host "[5/8] 构建 Docker 镜像..." -ForegroundColor Cyan
docker compose build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 镜像构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 镜像构建完成" -ForegroundColor Green

# 6. 启动服务
Write-Host "[6/8] 启动服务..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 服务启动失败" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 服务启动完成" -ForegroundColor Green

# 7. 等待服务就绪
Write-Host "[7/8] 等待服务就绪..." -ForegroundColor Cyan
Start-Sleep -Seconds 15

# 8. 健康检查
Write-Host "[8/8] 健康检查..." -ForegroundColor Cyan

# 后端健康检查
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -TimeoutSec 10 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ 后端健康检查通过" -ForegroundColor Green
    } else {
        Write-Host "❌ 后端健康检查失败 (状态码：$($response.StatusCode))" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ 后端健康检查失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "查看日志：docker compose logs backend" -ForegroundColor Yellow
    exit 1
}

# 前端健康检查
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -TimeoutSec 10 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ 前端健康检查通过" -ForegroundColor Green
    } else {
        Write-Host "❌ 前端健康检查失败 (状态码：$($response.StatusCode))" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ 前端健康检查失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "查看日志：docker compose logs frontend" -ForegroundColor Yellow
    exit 1
}

# 部署完成
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ 部署完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "服务访问地址:" -ForegroundColor White
Write-Host "  前端：http://localhost:5173" -ForegroundColor Cyan
Write-Host "  后端：http://localhost:3001" -ForegroundColor Cyan
Write-Host "  API 文档：http://localhost:3001/api/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "查看日志:" -ForegroundColor White
Write-Host "  docker compose logs -f backend" -ForegroundColor Gray
Write-Host "  docker compose logs -f frontend" -ForegroundColor Gray
Write-Host ""
Write-Host "停止服务:" -ForegroundColor White
Write-Host "  docker compose down" -ForegroundColor Gray
Write-Host ""
Write-Host "重启服务:" -ForegroundColor White
Write-Host "  docker compose restart" -ForegroundColor Gray
Write-Host ""
