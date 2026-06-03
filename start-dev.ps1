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
        Write-Host 'Values under file:./prisma/... can resolve to a nested prisma/prisma/*.db during startup and split your data.' -ForegroundColor Yellow
        exit 1
    }
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
                   $_.IPAddress -notlike "169.254.*" -and
                   ($_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.16.*" -or $_.IPAddress -like "172.17.*" -or $_.IPAddress -like "172.18.*" -or $_.IPAddress -like "172.19.*" -or $_.IPAddress -like "172.20.*" -or $_.IPAddress -like "172.21.*" -or $_.IPAddress -like "172.22.*" -or $_.IPAddress -like "172.23.*" -or $_.IPAddress -like "172.24.*" -or $_.IPAddress -like "172.25.*" -or $_.IPAddress -like "172.26.*" -or $_.IPAddress -like "172.27.*" -or $_.IPAddress -like "172.28.*" -or $_.IPAddress -like "172.29.*" -or $_.IPAddress -like "172.30.*" -or $_.IPAddress -like "172.31.*")
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
        $frontendUrl = "http://$ServerName"
        $corsOrigin = "http://$ServerName,$defaultLocalCorsOrigin"
    }

    Set-EnvValue -Path $EnvPath -Key 'FRONTEND_URL' -Value $frontendUrl
    Set-EnvValue -Path $EnvPath -Key 'CORS_ORIGIN' -Value $corsOrigin
    Set-EnvValue -Path $EnvPath -Key 'TRUST_PROXY' -Value '1'

    Write-Host "Updated backend env for Nginx mode:" -ForegroundColor DarkGray
    Write-Host "  FRONTEND_URL=$frontendUrl" -ForegroundColor DarkGray
    Write-Host "  CORS_ORIGIN=$corsOrigin" -ForegroundColor DarkGray
    Write-Host "  TRUST_PROXY=1" -ForegroundColor DarkGray
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
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 300s;
        }

        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
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
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-Command', 'npm run dev' -WorkingDirectory $backendPath | Out-Null

Write-Host "Waiting for backend health check..." -ForegroundColor Yellow
$backendReady = Test-ServiceReady -Url 'http://localhost:3001/health'
if ($backendReady) {
    Write-Host "Backend is ready." -ForegroundColor Green
} else {
    Write-Host "Backend did not become ready in time. Check the backend window for errors." -ForegroundColor Yellow
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
    $nginxReady = Test-ServiceReady -Url 'http://127.0.0.1/health'
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
