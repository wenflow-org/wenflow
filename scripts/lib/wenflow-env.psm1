# WenFlow shared backend/.env helper module.
# Single source of truth for the environment-file helpers that were previously
# duplicated verbatim across start-dev.ps1, start-lan.ps1 and setup-env.ps1.
# 三个启动脚本共用的环境文件函数模块：修复或调整时只改这一份，勿再复制回脚本。

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
    # 用 ReadAllLines 一次性物化：ReadLines 是惰性枚举，提前 return 不 Dispose
    # 会延迟释放句柄，导致随后的 Move-Item 备份偶发「文件被占用」
    foreach ($line in [System.IO.File]::ReadAllLines($Path, (Get-Utf8NoBomEncoding))) {
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

# 只做纯文本读取：不触发 Ensure-EnvFileHealthy 的修复/备份副作用，并剥离成对引号。
# 供 start-lan.ps1 的 INIT_ADMIN_PASSWORD 安全检查使用。
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

Export-ModuleMember -Function @(
    'Get-Utf8NoBomEncoding',
    'Get-EnvLineRegex',
    'Get-DefaultEnvEntries',
    'Write-EnvLinesUtf8',
    'Read-EnvFileLines',
    'Get-EnvEntriesFromFile',
    'Get-MinimalEnvLines',
    'Get-EnvFileRecoveryReason',
    'Initialize-EnvFile',
    'Ensure-EnvFileHealthy',
    'Get-EnvValue',
    'Set-EnvValue',
    'Read-EnvValue',
    'Get-LocalIPAddress',
    'Test-AIConfigValue',
    'Assert-RequiredEnvConfiguration',
    'Assert-SafeSqliteDatabaseUrl'
)
