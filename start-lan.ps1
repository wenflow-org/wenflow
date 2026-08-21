# WenFlow LAN Mode Start Script
# Automatically detects local IP, updates CORS, and starts dev services

param(
    [string]$LanIP = '',
    [switch]$SkipPrisma,
    [switch]$NoBrowser,
    [switch]$Setup,
    [switch]$EditEnv,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Shared backend/.env helpers live in scripts/lib/wenflow-env.psm1.
# 环境文件函数已收敛到公共模块，修复时改模块，不要在这里恢复副本。
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$wenflowEnvModulePath = Join-Path $scriptDir 'scripts\lib\wenflow-env.psm1'
if (-not (Test-Path -LiteralPath $wenflowEnvModulePath)) {
    Write-Host "Shared env module not found: $wenflowEnvModulePath" -ForegroundColor Red
    exit 1
}

Import-Module -Name $wenflowEnvModulePath -DisableNameChecking

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
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    return $false
}

function Ensure-NpmDependencies {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectPath,
        [Parameter(Mandatory = $true)]
        [string]$ProjectName
    )

    $nodeModulesPath = Join-Path $ProjectPath 'node_modules'
    if (Test-Path $nodeModulesPath) {
        return
    }

    Write-Host "$ProjectName dependencies missing, running npm install..." -ForegroundColor Yellow
    Push-Location $ProjectPath
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "npm install failed in $ProjectName" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
}

function Ensure-PrismaReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BackendPath
    )

    Write-Host "Generating Prisma clients and deploying migrations..." -ForegroundColor Yellow
    Push-Location $BackendPath
    try {
        npm run prisma:prepare
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Prisma migration deployment failed. Existing databases may require baseline audit or a side-by-side rebuild." -ForegroundColor Red
            Write-Host "Run: npm run prisma:baseline:audit" -ForegroundColor Yellow
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
}

function Get-PortOwnerProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        foreach ($connection in $connections) {
            if ($connection.OwningProcess) {
                return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
            }
        }
    } catch {
        return $null
    }

    return $null
}

function Assert-PortAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$Purpose
    )

    $owner = Get-PortOwnerProcess -Port $Port
    if ($null -eq $owner) {
        return
    }

    Write-Host "Port $Port is already in use by $($owner.ProcessName) (PID: $($owner.Id))." -ForegroundColor Red
    Write-Host "Stop that process before starting WenFlow $Purpose." -ForegroundColor Yellow
    exit 1
}

function Ensure-CoreAgentPromptsSync {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BackendPath
    )

    Write-Host "Syncing core agent prompts from code..." -ForegroundColor Yellow
    Push-Location $BackendPath
    try {
        npm run prompts:sync-core
        if ($LASTEXITCODE -ne 0) {
            Write-Host "core agent prompt sync failed" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Starting WenFlow (LAN Mode)..." -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendPath = Join-Path $scriptDir 'backend'
$frontendPath = Join-Path $scriptDir 'frontend'
$backendEnvPath = Join-Path $backendPath '.env'
$setupScriptPath = Join-Path $scriptDir 'setup-env.ps1'

if (-not (Test-Path $backendPath)) {
    Write-Host "Backend directory not found: $backendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $frontendPath)) {
    Write-Host "Frontend directory not found: $frontendPath" -ForegroundColor Red
    exit 1
}

Ensure-EnvFileHealthy -Path $backendEnvPath

# 局域网安全检查：development 模式下未设置 INIT_ADMIN_PASSWORD 时，后端会用内置默认口令
# （ChangeMe_2026_Admin，见 init-admin.service.ts）创建管理员；LAN 模式把 admin 入口暴露给
# 整个网段，同网段任意设备可用公开文档中的默认口令直接登录管理台。
# Read-EnvValue 已移入 scripts/lib/wenflow-env.psm1（纯文本读取，无修复副作用）。
$initAdminPassword = Read-EnvValue -Path $backendEnvPath -Key 'INIT_ADMIN_PASSWORD'
if ([string]::IsNullOrWhiteSpace($initAdminPassword)) {
    Write-Host ''
    Write-Host '==============================================================' -ForegroundColor Red
    Write-Host '  [安全警告] INIT_ADMIN_PASSWORD 未设置' -ForegroundColor Red
    Write-Host '  LAN 模式下管理后台将对整个局域网开放，而开发环境会以' -ForegroundColor Red
    Write-Host '  内置默认口令创建管理员（admin / ChangeMe_2026_Admin）。' -ForegroundColor Red
    Write-Host '  同网段任意设备均可登录管理台查看全部用户数据。' -ForegroundColor Red
    Write-Host '  建议：在 backend/.env 中设置强口令后重启，或首次登录后立即改密。' -ForegroundColor Red
    Write-Host '==============================================================' -ForegroundColor Red
    if (-not $Force) {
        $answer = Read-Host '仍要以当前配置继续启动吗？(y/N)'
        if ($answer -notmatch '^[Yy]') {
            Write-Host '已取消启动。请先在 backend/.env 设置 INIT_ADMIN_PASSWORD。' -ForegroundColor Yellow
            exit 1
        }
    }
}

if ($EditEnv) {
    if (-not (Test-Path $setupScriptPath)) {
        Write-Host "setup-env.ps1 not found: $setupScriptPath" -ForegroundColor Red
        exit 1
    }

    & $setupScriptPath -EditOnly
    exit $LASTEXITCODE
}

if ($Setup) {
    if (-not (Test-Path $setupScriptPath)) {
        Write-Host "setup-env.ps1 not found: $setupScriptPath" -ForegroundColor Red
        exit 1
    }

    & $setupScriptPath -NoPause
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$jwtSecret = Get-EnvValue -Path $backendEnvPath -Key 'JWT_SECRET'
$encryptionKeys = Get-EnvValue -Path $backendEnvPath -Key 'SECRET_ENCRYPTION_KEYS'
$encryptionKeyId = Get-EnvValue -Path $backendEnvPath -Key 'SECRET_ENCRYPTION_CURRENT_KEY_ID'
$needsEnvSetup = (-not (Test-Path $backendEnvPath)) -or [string]::IsNullOrWhiteSpace($jwtSecret) -or $jwtSecret.Length -lt 32 -or [string]::IsNullOrWhiteSpace($encryptionKeys) -or [string]::IsNullOrWhiteSpace($encryptionKeyId)
if ($needsEnvSetup) {
    if (-not (Test-Path $setupScriptPath)) {
        Write-Host "Missing backend/.env and setup helper not found: $setupScriptPath" -ForegroundColor Red
        exit 1
    }

    Write-Host "Backend env is missing required values, launching setup..." -ForegroundColor Yellow
    & $setupScriptPath -NoPause
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Assert-RequiredEnvConfiguration -EnvPath $backendEnvPath
Assert-SafeSqliteDatabaseUrl -EnvPath $backendEnvPath

$localIP = Get-LocalIPAddress -PreferredIP $LanIP
if ([string]::IsNullOrWhiteSpace($localIP)) {
    Write-Host "Warning: Could not detect local IP address. Using localhost instead." -ForegroundColor Yellow
    $localIP = 'localhost'
} else {
    Write-Host "Detected LAN IP: $localIP" -ForegroundColor Green
}

$currentCors = Get-EnvValue -Path $backendEnvPath -Key 'CORS_ORIGIN'
$lanOrigins = "http://$localIP`:5173", "http://$localIP`:3000"
$existingOrigins = @()
if ($currentCors) {
    $existingOrigins = $currentCors -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$newOrigins = @()
foreach ($origin in $lanOrigins) {
    if ($origin -notin $existingOrigins) {
        $newOrigins += $origin
    }
}

if ($newOrigins.Count -gt 0) {
    $allOrigins = @($existingOrigins) + $newOrigins
    $updatedCors = ($allOrigins -join ',').Trim()
    Set-EnvValue -Path $backendEnvPath -Key 'CORS_ORIGIN' -Value $updatedCors
    Write-Host "Added LAN IP to CORS_ORIGIN: $($newOrigins -join ', ')" -ForegroundColor Green
} else {
    Write-Host "LAN IP already in CORS_ORIGIN: $localIP" -ForegroundColor DarkGray
}

Ensure-NpmDependencies -ProjectPath $backendPath -ProjectName 'Backend'
Ensure-NpmDependencies -ProjectPath $frontendPath -ProjectName 'Frontend'

if (-not $SkipPrisma) {
    Ensure-PrismaReady -BackendPath $backendPath
    Ensure-CoreAgentPromptsSync -BackendPath $backendPath
} else {
    Write-Host "Skipping Prisma setup due to -SkipPrisma" -ForegroundColor DarkYellow
}

Write-Host "Checking ports..." -ForegroundColor Yellow
Assert-PortAvailable -Port 3001 -Purpose 'backend'
Assert-PortAvailable -Port 5173 -Purpose 'frontend'

Write-Host "Starting backend on port 3001..." -ForegroundColor Green
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-Command', 'npm run dev:server' -WorkingDirectory $backendPath | Out-Null

Write-Host "Waiting for backend health check..." -ForegroundColor Yellow
$backendReady = Test-ServiceReady -Url 'http://localhost:3001/readyz'
if ($backendReady) {
    Write-Host "Backend is ready." -ForegroundColor Green
} else {
    Write-Host "Backend did not become ready in time. Check the backend window for errors." -ForegroundColor Yellow
}

Write-Host "Starting frontend on port 5173..." -ForegroundColor Green
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-Command', 'npm run dev' -WorkingDirectory $frontendPath | Out-Null

Write-Host "Waiting for frontend dev server..." -ForegroundColor Yellow
$frontendReady = Test-ServiceReady -Url "http://$localIP`:5173"
if ($frontendReady) {
    Write-Host "Frontend is ready." -ForegroundColor Green
} else {
    Write-Host "Frontend did not become ready in time. Check the frontend window for errors." -ForegroundColor Yellow
}

if (-not $NoBrowser) {
    Write-Host "Opening browser to LAN address..." -ForegroundColor Cyan
    Start-Process "http://$localIP`:5173"
}

Write-Host "`nLAN mode startup finished." -ForegroundColor Green
Write-Host "Backend readiness: http://localhost:3001/readyz"
Write-Host "Backend API:    http://localhost:3001/api"
Write-Host "Frontend UI:    http://$localIP`:5173"
Write-Host "LAN Access:     http://$localIP`:5173"
