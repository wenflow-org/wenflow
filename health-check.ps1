#!/usr/bin/env pwsh
# Backend Health Check Script
# Run this periodically to check if backend is alive

$url = "http://localhost:3001/health"
$retryCount = 3
$retryDelay = 2

Write-Host "🔍 Checking backend health..." -ForegroundColor Cyan

for ($i = 1; $i -le $retryCount; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5

        if ($response.StatusCode -eq 200) {
            $data = $response.Content | ConvertFrom-Json
            Write-Host "✅ Backend is healthy!" -ForegroundColor Green
            Write-Host "   Status: $($data.status)" -ForegroundColor White
            Write-Host "   Uptime: $([math]::Round($data.uptime, 2))s" -ForegroundColor White
            Write-Host "   Timestamp: $($data.timestamp)" -ForegroundColor White
            exit 0
        }
    } catch {
        Write-Host "⚠️ Attempt $i/$retryCount failed: $($_.Exception.Message)" -ForegroundColor Yellow
        if ($i -lt $retryCount) {
            Start-Sleep -Seconds $retryDelay
        }
    }
}

Write-Host "❌ Backend is down after $retryCount attempts" -ForegroundColor Red
exit 1
