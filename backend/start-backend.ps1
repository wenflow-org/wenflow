#!/usr/bin/env pwsh
# WenFlow - Backend Startup Script
# 用法: .\start-backend.ps1

Write-Host "🚀 Starting WenFlow Backend..." -ForegroundColor Green

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $backendDir

# 端口 / 旧进程 / 就绪等待统一交给 restart.mjs（#80：不再手工杀端口、不再裸启）
# 端口解析：--port > 环境变量 PORT > backend/.env 的 PORT > 3001

Write-Host "Preparing Prisma clients and database schemas..." -ForegroundColor Yellow
npm run prisma:prepare
if ($LASTEXITCODE -ne 0) {
    Write-Host "Prisma database preparation failed" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "🧩 Syncing core prompts from code..." -ForegroundColor Yellow
npm run prompts:sync-core
if ($LASTEXITCODE -ne 0) {
    Write-Host "core prompt sync failed" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 启动后端服务（统一入口：tsc 快检 → 停旧进程 → 起进程 → 等 /readyz）
Write-Host "📡 Starting backend via restart.mjs..." -ForegroundColor Cyan
node restart.mjs
