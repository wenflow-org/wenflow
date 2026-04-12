# One-click start script for WenFlow

param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

function Test-ServiceReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$RetryCount = 30,
        [int]$DelaySeconds = 2
    )

    for ($i = 0; $i -lt $RetryCount; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    return $false
}

function Stop-PortProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        foreach ($connection in $connections) {
            if ($connection.OwningProcess) {
                Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-Host "   Stopped process on port $Port (PID: $($connection.OwningProcess))" -ForegroundColor DarkGray
            }
        }
    } catch {
        Write-Host "   Unable to inspect port $Port, skipping cleanup" -ForegroundColor DarkYellow
    }
}

Write-Host "Starting WenFlow..." -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendPath = Join-Path $scriptDir 'backend'
$frontendPath = Join-Path $scriptDir 'frontend'

if (-not (Test-Path $backendPath)) {
    Write-Host "Backend directory not found: $backendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $frontendPath)) {
    Write-Host "Frontend directory not found: $frontendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $backendPath 'node_modules'))) {
    Write-Host "backend/node_modules missing, run npm install in backend first" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $frontendPath 'node_modules'))) {
    Write-Host "frontend/node_modules missing, run npm install in frontend first" -ForegroundColor Red
    exit 1
}

Write-Host "Checking ports (3001, 5173)..." -ForegroundColor Yellow
Stop-PortProcess -Port 3001
Stop-PortProcess -Port 5173

Write-Host "Starting backend on port 3001..." -ForegroundColor Green
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-Command', 'npm run dev' -WorkingDirectory $backendPath | Out-Null

Write-Host "Waiting for backend health check..." -ForegroundColor Yellow
$backendReady = Test-ServiceReady -Url 'http://localhost:3001/health'
if ($backendReady) {
    Write-Host "Backend is ready." -ForegroundColor Green
} else {
    Write-Host "Backend did not become ready in time. Check the backend window for errors." -ForegroundColor Yellow
}

Write-Host "Starting frontend on port 5173..." -ForegroundColor Green
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-Command', 'npm run dev' -WorkingDirectory $frontendPath | Out-Null

Write-Host "Waiting for frontend dev server..." -ForegroundColor Yellow
$frontendReady = Test-ServiceReady -Url 'http://localhost:5173'
if ($frontendReady) {
    Write-Host "Frontend is ready." -ForegroundColor Green
} else {
    Write-Host "Frontend did not become ready in time. Check the frontend window for errors." -ForegroundColor Yellow
}

if (-not $NoBrowser) {
    Write-Host "Opening browser..." -ForegroundColor Cyan
    Start-Process 'http://localhost:5173'
}

Write-Host "`nDevelopment environment startup finished." -ForegroundColor Green
Write-Host "Backend health: http://localhost:3001/health"
Write-Host "Backend API:    http://localhost:3001/api"
Write-Host "Frontend UI:    http://localhost:5173"
