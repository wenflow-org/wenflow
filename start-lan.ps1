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

$script:EnvFileMaxBytes = 1MB
$script:EnvFileMaxLines = 500
$script:EnvFileMaxLineLength = 4096
$script:EnvFileRecoveryReadLimitBytes = 8MB

function Get-Utf8NoBomEncoding {
    return New-Object System.Text.UTF8Encoding($false)
}

function Get-EnvLineRegex {
    return '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$'
}

function Get-DefaultEnvEntries {
    $defaults = [ordered]@{
        NODE_ENV = 'development'
        PORT = '3001'
        CORS_ORIGIN = 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173'
        TRUST_PROXY = ''
        DATABASE_URL = 'file:./dev.db'
        SYSTEM_DATABASE_URL = 'file:../system.db'
        JWT_SECRET = ''
        SECRET_ENCRYPTION_CURRENT_KEY_ID = 'v1'
        SECRET_ENCRYPTION_KEYS = ''
        ADMIN_ACCESS_MODE = 'private'
        LOGIN_MAX_ATTEMPTS = '5'
        LOGIN_LOCK_DURATION_SECONDS = '900'
        JWT_EXPIRES_IN = '7d'
        AI_API_URL = 'https://api.deepseek.com'
        AI_API_KEY = ''
        AI_MODEL = 'deepseek-v4-flash'
        AI_MODEL_REASONING = 'deepseek-v4-pro'
        FRONTEND_URL = 'http://localhost:5173'
        INIT_ADMIN_NAME = 'admin'
        INIT_ADMIN_EMAIL = 'admin@wenflow.local'
        INIT_ADMIN_PASSWORD = ''
    }

    return $defaults
}

function Write-EnvLinesUtf8 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string[]]$Lines
    )

    $parentPath = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parentPath) -and -not (Test-Path -LiteralPath $parentPath)) {
        New-Item -ItemType Directory -Path $parentPath | Out-Null
    }

    [System.IO.File]::WriteAllLines($Path, $Lines, (Get-Utf8NoBomEncoding))
}

function Read-EnvFileLines {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    return [System.IO.File]::ReadAllLines($Path, (Get-Utf8NoBomEncoding))
}

function Get-EnvEntriesFromFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $entries = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $entries
    }

    $lineRegex = Get-EnvLineRegex
    foreach ($line in [System.IO.File]::ReadLines($Path, (Get-Utf8NoBomEncoding))) {
        if ($line -match $lineRegex) {
            $key = $matches[1]
            if (-not $entries.Contains($key)) {
                $entries[$key] = $matches[2].Trim()
            }
        }
    }

    return $entries
}

function Get-MinimalEnvLines {
    param(
        [System.Collections.IDictionary]$RecoveredEntries = $null
    )

    $entries = Get-DefaultEnvEntries
    if ($RecoveredEntries) {
        foreach ($key in $RecoveredEntries.Keys) {
            $entries[$key] = [string]$RecoveredEntries[$key]
        }
    }

    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($key in $entries.Keys) {
        $lines.Add("$key=$($entries[$key])")
    }

    return $lines.ToArray()
}

function Get-EnvFileRecoveryReason {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return ''
    }

    $fileInfo = Get-Item -LiteralPath $Path
    if ($fileInfo.Length -gt $script:EnvFileMaxBytes) {
        return "file size $($fileInfo.Length) bytes exceeds $($script:EnvFileMaxBytes) bytes"
    }

    $lineCount = 0
    foreach ($line in [System.IO.File]::ReadLines($Path, (Get-Utf8NoBomEncoding))) {
        $lineCount++
        if ($lineCount -gt $script:EnvFileMaxLines) {
            return "line count exceeds $($script:EnvFileMaxLines)"
        }

        if ($line.Length -gt $script:EnvFileMaxLineLength) {
            return "a line exceeds $($script:EnvFileMaxLineLength) characters"
        }

        if ($line.IndexOf([char]0) -ge 0) {
            return 'file contains NUL characters'
        }
    }

    return ''
}

function Initialize-EnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [System.Collections.IDictionary]$RecoveredEntries = $null
    )

    Write-EnvLinesUtf8 -Path $Path -Lines (Get-MinimalEnvLines -RecoveredEntries $RecoveredEntries)
}

function Ensure-EnvFileHealthy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        Initialize-EnvFile -Path $Path
        Write-Host "Created minimal backend/.env at $Path" -ForegroundColor Green
        return
    }

    $recoveryReason = Get-EnvFileRecoveryReason -Path $Path
    if ([string]::IsNullOrWhiteSpace($recoveryReason)) {
        return
    }

    $fileInfo = Get-Item -LiteralPath $Path
    $recoveredEntries = $null
    if ($fileInfo.Length -le $script:EnvFileRecoveryReadLimitBytes) {
        $recoveredEntries = Get-EnvEntriesFromFile -Path $Path
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = "$Path.corrupt.$timestamp.bak"
    Move-Item -LiteralPath $Path -Destination $backupPath
    Initialize-EnvFile -Path $Path -RecoveredEntries $recoveredEntries

    Write-Host "Recovered abnormal backend/.env ($recoveryReason). Backup: $backupPath" -ForegroundColor Yellow
    if ($null -eq $recoveredEntries) {
        Write-Host 'The backup was not parsed because the file was too large. Review the backup if you need to restore custom values.' -ForegroundColor Yellow
    }
}

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

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if (-not (Test-Path $Path)) {
        return ''
    }

    Ensure-EnvFileHealthy -Path $Path
    $escapedKey = [Regex]::Escape($Key)
    foreach ($line in (Read-EnvFileLines -Path $Path)) {
        if ($line -match "^\s*$escapedKey\s*=") {
            return (($line -replace "^\s*$escapedKey\s*=", '').Trim())
        }
    }

    return ''
}

function Set-EnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    Ensure-EnvFileHealthy -Path $Path

    $content = New-Object System.Collections.Generic.List[string]
    foreach ($line in (Read-EnvFileLines -Path $Path)) {
        $content.Add($line)
    }

    $escapedKey = [Regex]::Escape($Key)
    $newLine = "$Key=$Value"
    $updated = $false
    $resultLines = New-Object System.Collections.Generic.List[string]

    foreach ($line in $content) {
        if ($line -match "^\s*$escapedKey\s*=") {
            if (-not $updated) {
                $resultLines.Add($newLine)
                $updated = $true
            }
            continue
        }

        $resultLines.Add($line)
    }

    if (-not $updated) {
        if ($resultLines.Count -gt 0 -and $resultLines[$resultLines.Count - 1] -ne '') {
            $resultLines.Add('')
        }
        $resultLines.Add($newLine)
    }

    Write-EnvLinesUtf8 -Path $Path -Lines $resultLines.ToArray()
}

function Get-LocalIPAddress {
    param(
        [string]$PreferredIP = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($PreferredIP)) {
        return $PreferredIP.Trim()
    }

    # 虚拟/回环网卡别名关键字（不区分大小写）。这些网卡只在主机内部使用，
    # 不在真实局域网里，选它们会导致同局域网设备无法访问。
    $virtualInterfacePatterns = @(
        'Loopback*', 'vEthernet*', 'VMware*', 'VirtualBox*', 'Docker*',
        'WSL*', 'Hyper-V*', 'Default Switch*', 'Meta*', 'TAP*', 'Tunnel*',
        'Pseudo*'
    )

    try {
        $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.InterfaceAlias -notlike "Loopback*" -and
                $_.IPAddress -notlike "169.254.*" -and
                ($_.IPAddress -like "192.168.*" -or
                 $_.IPAddress -like "10.*" -or
                 ($_.IPAddress -like "172.*" -and
                  $_.IPAddress -notlike "172.26.*" -and
                  $_.IPAddress -notlike "172.27.*")) }

        # 排除虚拟网卡
        $physical = $candidates | Where-Object {
            $alias = $_.InterfaceAlias
            $isVirtual = $false
            foreach ($pattern in $virtualInterfacePatterns) {
                if ($alias -like $pattern) { $isVirtual = $true; break }
            }
            -not $isVirtual
        }

        $ip = ($physical | Select-Object -First 1).IPAddress
        if ([string]::IsNullOrWhiteSpace($ip)) {
            $ip = ($candidates | Select-Object -First 1).IPAddress
        }

        if (-not [string]::IsNullOrWhiteSpace($ip)) {
            return $ip
        }
    } catch {
    }

    try {
        $ip = (ipconfig | Select-String "IPv4" | Select-Object -First 1).ToString().Split(":")[1].Trim()
        if (-not [string]::IsNullOrWhiteSpace($ip)) {
            return $ip
        }
    } catch {
    }

    return ''
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

function Test-AIConfigValue {
    param(
        [AllowEmptyString()]
        [string]$Value,
        [Parameter(Mandatory = $true)]
        [string[]]$InvalidValues
    )

    $trimmed = $Value.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return $false
    }

    foreach ($invalid in $InvalidValues) {
        if ([string]::IsNullOrEmpty($invalid)) {
            continue
        }
        if ($trimmed -eq $invalid) {
            return $false
        }
    }

    return $true
}

function Assert-RequiredEnvConfiguration {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvPath
    )

    $jwtSecret = Get-EnvValue -Path $EnvPath -Key 'JWT_SECRET'
    if ([string]::IsNullOrWhiteSpace($jwtSecret) -or $jwtSecret.Length -lt 32) {
        Write-Host 'JWT_SECRET is missing or shorter than 32 characters.' -ForegroundColor Red
        Write-Host 'Run ./setup-env.ps1 first.' -ForegroundColor Yellow
        exit 1
    }

    $aiApiUrl = Get-EnvValue -Path $EnvPath -Key 'AI_API_URL'
    if (-not (Test-AIConfigValue -Value $aiApiUrl -InvalidValues @('https://api.deepseek.com/'))) {
        Write-Host 'AI_API_URL is missing or invalid.' -ForegroundColor Red
        Write-Host 'Run ./setup-env.ps1 and provide a valid AI endpoint.' -ForegroundColor Yellow
        exit 1
    }

    $aiApiKey = Get-EnvValue -Path $EnvPath -Key 'AI_API_KEY'
    if (-not (Test-AIConfigValue -Value $aiApiKey -InvalidValues @('sk-your-api-key', 'your-api-key'))) {
        Write-Host 'AI_API_KEY is missing or still using the example placeholder.' -ForegroundColor Red
        Write-Host 'Run ./setup-env.ps1 and provide a real AI API key.' -ForegroundColor Yellow
        exit 1
    }

    $aiModel = Get-EnvValue -Path $EnvPath -Key 'AI_MODEL'
    if ([string]::IsNullOrWhiteSpace($aiModel)) {
        Write-Host 'AI_MODEL is missing.' -ForegroundColor Red
        Write-Host 'Run ./setup-env.ps1 and provide a default chat model.' -ForegroundColor Yellow
        exit 1
    }
}

function Assert-SafeSqliteDatabaseUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvPath
    )

    $databaseUrl = Get-EnvValue -Path $EnvPath -Key 'DATABASE_URL'
    if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
        return
    }

    $trimmed = $databaseUrl.Trim()
    if ($trimmed -notmatch '^file:') {
        return
    }

    if ($trimmed -match '^file:\./prisma/') {
        Write-Host "DATABASE_URL=$trimmed is not a safe local SQLite path for WenFlow." -ForegroundColor Red
        Write-Host 'Use DATABASE_URL=file:./dev.db for the local development database.' -ForegroundColor Yellow
        Write-Host 'Because the main schema is already under backend/prisma, file:./prisma/... creates a nested database.' -ForegroundColor Yellow
        exit 1
    }

    $systemDatabaseUrl = Get-EnvValue -Path $EnvPath -Key 'SYSTEM_DATABASE_URL'
    if ($systemDatabaseUrl.Trim() -match '^file:\./(prisma/)?system\.db$') {
        Write-Host "SYSTEM_DATABASE_URL=$systemDatabaseUrl is ambiguous after the System schema directory split." -ForegroundColor Red
        Write-Host 'Use SYSTEM_DATABASE_URL=file:../system.db to target backend/prisma/system.db.' -ForegroundColor Yellow
        exit 1
    }
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
function Read-EnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $regex = Get-EnvLineRegex
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $regex -and $Matches[1] -eq $Key) {
            return $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return ''
}

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
