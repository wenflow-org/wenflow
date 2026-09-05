# One-click start script for WenFlow

param(
    [switch]$NoBrowser,
    [switch]$Setup,
    [switch]$EditEnv,
    [switch]$SkipPrisma,
    [switch]$UseNginx,
    [switch]$Lan,
    [string]$Domain = '',
    [string]$NginxExePath = '',
    [string]$LanIP = ''
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

function Ensure-FrontendBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FrontendPath
    )

    Write-Host "Building frontend for Nginx..." -ForegroundColor Yellow
    Push-Location $FrontendPath
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "frontend build failed" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
}

function Get-NormalizedOrigin {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $trimmed = $Value.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return ''
    }

    if ($trimmed.EndsWith('/')) {
        $trimmed = $trimmed.TrimEnd('/')
    }

    return $trimmed
}

function Resolve-ServerName {
    param(
        [AllowEmptyString()]
        [string]$DomainValue = '',
        [Parameter(Mandatory = $true)]
        [string]$EnvPath
    )

    $candidate = [string]$DomainValue
    $candidate = $candidate.Trim()
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $frontendUrl = Get-EnvValue -Path $EnvPath -Key 'FRONTEND_URL'
        $candidate = $frontendUrl.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($candidate)) {
        return 'localhost'
    }

    $candidate = $candidate.TrimEnd('/')
    if ($candidate -match '^https?://') {
        try {
            $uri = [System.Uri]$candidate
            if (-not [string]::IsNullOrWhiteSpace($uri.Host)) {
                return $uri.Host
            }
        } catch {
        }
    }

    if ($candidate.Contains('/')) {
        $candidate = $candidate.Split('/')[0]
    }

    return $candidate
}

function Resolve-NginxExecutable {
    param(
        [string]$PreferredPath
    )

    if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
        if (Test-Path $PreferredPath) {
            return $PreferredPath
        }

        Write-Host "Nginx executable not found: $PreferredPath" -ForegroundColor Red
        exit 1
    }

    $nginxCommand = Get-Command nginx -ErrorAction SilentlyContinue
    if ($nginxCommand) {
        return $nginxCommand.Source
    }

    Write-Host "Nginx not found in PATH. Install Nginx or use -NginxExePath." -ForegroundColor Red
    exit 1
}

function Ensure-BackendEnvForNginx {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvPath,
        [Parameter(Mandatory = $true)]
        [string]$ServerName
    )

    $defaultLocalCorsOrigin = 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173'
    if ($ServerName -eq 'localhost') {
        $frontendUrl = 'http://localhost'
        $corsOrigin = $defaultLocalCorsOrigin
    } else {
        $frontendUrl = "https://$ServerName"
        $corsOrigin = "https://$ServerName,http://$ServerName,$defaultLocalCorsOrigin"
    }

    Set-EnvValue -Path $EnvPath -Key 'FRONTEND_URL' -Value $frontendUrl
    Set-EnvValue -Path $EnvPath -Key 'CORS_ORIGIN' -Value $corsOrigin
    Set-EnvValue -Path $EnvPath -Key 'TRUST_PROXY' -Value '127.0.0.1'

    Write-Host "Updated backend env for Nginx mode:" -ForegroundColor DarkGray
    Write-Host "  FRONTEND_URL=$frontendUrl" -ForegroundColor DarkGray
    Write-Host "  CORS_ORIGIN=$corsOrigin" -ForegroundColor DarkGray
    Write-Host "  TRUST_PROXY=127.0.0.1" -ForegroundColor DarkGray
}

function Ensure-NginxReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$NginxExecutable,
        [Parameter(Mandatory = $true)]
        [string]$RuntimeDir,
        [Parameter(Mandatory = $true)]
        [string]$ConfigFileName,
        [Parameter(Mandatory = $true)]
        [string]$ServerName,
        [Parameter(Mandatory = $true)]
        [string]$FrontendDistPath,
        [int]$BackendPort = 3001
    )

    if (-not (Test-Path $RuntimeDir)) {
        New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
    }

    $logsDir = Join-Path $RuntimeDir 'logs'
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir | Out-Null
    }

    $tempDir = Join-Path $RuntimeDir 'temp'
    if (-not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
    }

    $frontendDistNginxPath = $FrontendDistPath.Replace('\', '/')
    $nginxHome = Split-Path -Parent $NginxExecutable
    $mimeTypesPath = (Join-Path $nginxHome 'conf\mime.types').Replace('\', '/')
    if (-not (Test-Path ($mimeTypesPath -replace '/', '\\'))) {
        Write-Host "Nginx mime.types not found near executable: $mimeTypesPath" -ForegroundColor Red
        exit 1
    }

    $configTemplate = @'
worker_processes  1;

error_log  logs/error.log warn;
pid        logs/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       __MIME_TYPES__;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    client_body_temp_path temp/client_body;
    proxy_temp_path       temp/proxy;
    fastcgi_temp_path     temp/fastcgi;
    uwsgi_temp_path       temp/uwsgi;
    scgi_temp_path        temp/scgi;

    server {
        listen       80;
        server_name  __SERVER_NAME__;

        root __FRONTEND_DIST__;
        index index.html;

        location /api {
            proxy_pass http://127.0.0.1:__BACKEND_PORT__;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 300s;
        }

        location ~ ^/(health|livez|readyz)$ {
            access_log off;
            proxy_pass http://127.0.0.1:__BACKEND_PORT__;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
        }

        gzip on;
        gzip_vary on;
        gzip_proxied any;
        gzip_comp_level 6;
        gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
'@

    $configContent = $configTemplate
    $configContent = $configContent.Replace('__MIME_TYPES__', $mimeTypesPath)
    $configContent = $configContent.Replace('__SERVER_NAME__', "$ServerName localhost 127.0.0.1")
    $configContent = $configContent.Replace('__FRONTEND_DIST__', $frontendDistNginxPath)
    $configContent = $configContent.Replace('__BACKEND_PORT__', [string]$BackendPort)

    $configPath = Join-Path $RuntimeDir $ConfigFileName
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configPath, $configContent, $utf8NoBom)

    Write-Host "Validating Nginx config..." -ForegroundColor Yellow
    & $NginxExecutable -t -p "$RuntimeDir\" -c $ConfigFileName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Nginx config validation failed" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    $pidFile = Join-Path $RuntimeDir 'logs\nginx.pid'
    $canReload = $false
    if (Test-Path $pidFile) {
        try {
            $pidValue = (Get-Content -Path $pidFile | Select-Object -First 1).Trim()
            if ($pidValue -match '^\d+$') {
                $existingProcess = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
                if ($existingProcess) {
                    $canReload = $true
                }
            }
        } catch {
            $canReload = $false
        }
    }

    if ($canReload) {
        Write-Host "Reloading Nginx..." -ForegroundColor Yellow
        & $NginxExecutable -s reload -p "$RuntimeDir\" -c $ConfigFileName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Nginx reload failed, trying fresh start..." -ForegroundColor DarkYellow
            & $NginxExecutable -p "$RuntimeDir\" -c $ConfigFileName
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Nginx start failed" -ForegroundColor Red
                exit $LASTEXITCODE
            }
        }
    } else {
        Write-Host "Starting Nginx..." -ForegroundColor Yellow
        & $NginxExecutable -p "$RuntimeDir\" -c $ConfigFileName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Nginx start failed" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }
}

Write-Host "Starting WenFlow..." -ForegroundColor Cyan

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

Ensure-NpmDependencies -ProjectPath $backendPath -ProjectName 'Backend'
Ensure-NpmDependencies -ProjectPath $frontendPath -ProjectName 'Frontend'

if (-not $SkipPrisma) {
    Ensure-PrismaReady -BackendPath $backendPath
    Ensure-CoreAgentPromptsSync -BackendPath $backendPath
} else {
    Write-Host "Skipping Prisma setup due to -SkipPrisma" -ForegroundColor DarkYellow
}

if ($Lan) {
    $localIP = Get-LocalIPAddress -PreferredIP $LanIP
    if ([string]::IsNullOrWhiteSpace($localIP)) {
        Write-Host "Warning: Could not detect local IP address. LAN mode will be skipped." -ForegroundColor Yellow
    } else {
        $currentCors = Get-EnvValue -Path $backendEnvPath -Key 'CORS_ORIGIN'
        $lanOrigins = "http://$localIP`:5173", "http://$localIP`:3000"
        $existingOrigins = $currentCors -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
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
    }
}

$serverName = 'localhost'
if ($UseNginx) {
    $serverName = Resolve-ServerName -DomainValue $Domain -EnvPath $backendEnvPath
    $serverName = Get-NormalizedOrigin -Value $serverName
    if ([string]::IsNullOrWhiteSpace($serverName)) {
        $serverName = 'localhost'
    }

    Ensure-BackendEnvForNginx -EnvPath $backendEnvPath -ServerName $serverName
}

Write-Host "Checking ports..." -ForegroundColor Yellow
Assert-PortAvailable -Port 3001 -Purpose 'backend'
if (-not $UseNginx) {
    Assert-PortAvailable -Port 5173 -Purpose 'frontend'
} else {
    Assert-PortAvailable -Port 80 -Purpose 'Nginx gateway'
}

Write-Host "Starting backend on port 3001..." -ForegroundColor Green
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-Command', 'npm run dev:server' -WorkingDirectory $backendPath | Out-Null

Write-Host "Waiting for backend health check..." -ForegroundColor Yellow
$backendReady = Test-ServiceReady -Url 'http://localhost:3001/readyz'
if ($backendReady) {
    Write-Host "Backend is ready." -ForegroundColor Green
} else {
    Write-Host "Backend did not become ready in time. Check the backend window for errors." -ForegroundColor Yellow
    if ($UseNginx) {
        Write-Host "Stopping Nginx startup because the backend is unavailable. Otherwise the domain would serve the frontend but return 502 for /api requests." -ForegroundColor Red
        exit 1
    }
}

if ($UseNginx) {
    Ensure-FrontendBuild -FrontendPath $frontendPath

    $nginxExecutable = Resolve-NginxExecutable -PreferredPath $NginxExePath
    $nginxRuntimeDir = Join-Path $scriptDir 'runtime\nginx'
    $nginxConfigFile = 'wenflow.nginx.conf'
    $frontendDistPath = Join-Path $frontendPath 'dist'

    if (-not (Test-Path $frontendDistPath)) {
        Write-Host "Frontend dist folder missing: $frontendDistPath" -ForegroundColor Red
        exit 1
    }

    Ensure-NginxReady -NginxExecutable $nginxExecutable -RuntimeDir $nginxRuntimeDir -ConfigFileName $nginxConfigFile -ServerName $serverName -FrontendDistPath $frontendDistPath -BackendPort 3001

    Write-Host "Waiting for Nginx health check..." -ForegroundColor Yellow
    $nginxReady = Test-ServiceReady -Url 'http://127.0.0.1/readyz'
    if ($nginxReady) {
        Write-Host "Nginx gateway is ready." -ForegroundColor Green
    } else {
        Write-Host "Nginx health check failed. See runtime/nginx/logs/error.log" -ForegroundColor Yellow
    }

    $browserUrl = "http://$serverName"
    if ($serverName -eq 'localhost') {
        $browserUrl = 'http://localhost'
    }

    if (-not $NoBrowser) {
        Write-Host "Opening browser..." -ForegroundColor Cyan
        Start-Process $browserUrl
    }

    Write-Host "`nNginx deployment startup finished." -ForegroundColor Green
    Write-Host "Backend health: http://localhost:3001/health"
    Write-Host "Gateway health: http://127.0.0.1/health"
    Write-Host "Frontend UI:    $browserUrl"
    Write-Host "Nginx config:   runtime/nginx/$nginxConfigFile"
    exit 0
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
