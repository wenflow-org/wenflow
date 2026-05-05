# WenFlow LAN Mode Start Script
# Automatically detects local IP, updates CORS, and starts dev services

param(
    [string]$LanIP = '',
    [switch]$SkipPrisma,
    [switch]$NoBrowser,
    [switch]$Setup,
    [switch]$EditEnv
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

    $escapedKey = [Regex]::Escape($Key)
    $line = Get-Content -Path $Path | Where-Object { $_ -match "^\s*$escapedKey\s*=" } | Select-Object -First 1
    if (-not $line) {
        return ''
    }

    return (($line -replace "^\s*$escapedKey\s*=", '').Trim())
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

    $content = @()
    if (Test-Path $Path) {
        $content = @(Get-Content -Path $Path)
    }

    $escapedKey = [Regex]::Escape($Key)
    $newLine = "$Key=$Value"
    $updated = $false

    for ($i = 0; $i -lt $content.Count; $i++) {
        if ($content[$i] -match "^\s*$escapedKey\s*=") {
            $content[$i] = $newLine
            $updated = $true
            break
        }
    }

    if (-not $updated) {
        if ($content.Count -gt 0 -and $content[-1] -ne '') {
            $content += ''
        }
        $content += $newLine
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $content, $utf8NoBom)
}

function Get-LocalIPAddress {
    param(
        [string]$PreferredIP = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($PreferredIP)) {
        return $PreferredIP.Trim()
    }

    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 |
               Where-Object {
                   $_.InterfaceAlias -notlike "Loopback*" -and
                   $_.InterfaceAlias -notlike "vEthernet*" -and
                   $_.IPAddress -notlike "169.254.*" -and
                   ($_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*")
               } |
               Select-Object -First 1 -ExpandProperty IPAddress)

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

    Write-Host "Preparing database schema (Prisma)..." -ForegroundColor Yellow
    Push-Location $BackendPath
    try {
        npx prisma generate
        if ($LASTEXITCODE -ne 0) {
            Write-Host "prisma generate failed" -ForegroundColor Red
            exit $LASTEXITCODE
        }

        npx prisma db push
        if ($LASTEXITCODE -ne 0) {
            Write-Host "prisma db push failed" -ForegroundColor Red
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
$needsEnvSetup = (-not (Test-Path $backendEnvPath)) -or [string]::IsNullOrWhiteSpace($jwtSecret) -or $jwtSecret.Length -lt 32
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
} else {
    Write-Host "Skipping Prisma setup due to -SkipPrisma" -ForegroundColor DarkYellow
}

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
Write-Host "Backend health: http://localhost:3001/health"
Write-Host "Backend API:    http://localhost:3001/api"
Write-Host "Frontend UI:    http://$localIP`:5173"
Write-Host "LAN Access:     http://$localIP`:5173"
