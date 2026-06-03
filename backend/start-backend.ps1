#!/usr/bin/env pwsh
# WenFlow - Backend Startup Script
# 用法: .\start-backend.ps1

Write-Host "🚀 Starting WenFlow Backend..." -ForegroundColor Green

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $backendDir

# 检查端口占用
$port = 3001
$portInfo = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if ($portInfo) {
    Write-Host "⚠️ Port $port is in use, killing existing process..." -ForegroundColor Yellow
    Get-Process -Id $portInfo.OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host "🧩 Syncing core prompts from code..." -ForegroundColor Yellow
npm run prompts:sync-core
if ($LASTEXITCODE -ne 0) {
    Write-Host "core prompt sync failed" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 启动后端服务
Write-Host "📡 Starting backend server on port $port..." -ForegroundColor Cyan
npm run dev
