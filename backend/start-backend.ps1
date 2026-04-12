#!/usr/bin/env pwsh
# WenFlow - Backend Startup Script
# 用法: .\start-backend.ps1

Write-Host "🚀 Starting WenFlow Backend..." -ForegroundColor Green

$backendDir = "C:\Users\myadmin\.openclaw\workspace\wenflow\backend"
Set-Location $backendDir

# 检查端口占用
$port = 3001
$portInfo = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if ($portInfo) {
    Write-Host "⚠️ Port $port is in use, killing existing process..." -ForegroundColor Yellow
    Get-Process -Id $portInfo.OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# 启动后端服务
Write-Host "📡 Starting backend server on port $port..." -ForegroundColor Cyan
npm run dev