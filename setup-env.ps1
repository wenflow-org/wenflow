# WenFlow environment setup helper

param(
    [switch]$EditOnly,
    [switch]$NoPause
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

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($bytes)
}

function New-EncryptionKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($bytes)
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
        if ($trimmed -eq $invalid) {
            return $false
        }
    }

    return $true
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendPath = Join-Path $scriptDir 'backend'
$envPath = Join-Path $backendPath '.env'
$envExamplePath = Join-Path $backendPath '.env.example'

if (-not (Test-Path $backendPath)) {
    Write-Host "Backend directory not found: $backendPath" -ForegroundColor Red
    exit 1
}

Ensure-EnvFileHealthy -Path $envPath

if (-not (Test-Path $envPath)) {
    Initialize-EnvFile -Path $envPath
    Write-Host "Created minimal backend/.env" -ForegroundColor Green
}

if ($EditOnly) {
    Write-Host "Opening backend/.env..." -ForegroundColor Cyan
    Start-Process notepad.exe -ArgumentList $envPath
    exit 0
}

Write-Host "WenFlow environment setup" -ForegroundColor Cyan
Write-Host "Press Enter to keep the current value." -ForegroundColor DarkGray

$currentJwtSecret = Get-EnvValue -Path $envPath -Key 'JWT_SECRET'
if ([string]::IsNullOrWhiteSpace($currentJwtSecret) -or $currentJwtSecret.Length -lt 32) {
    Write-Host "JWT_SECRET is missing or too short." -ForegroundColor Yellow
    $jwtInput = Read-Host 'Input JWT_SECRET, or type G to auto-generate'
    if ([string]::IsNullOrWhiteSpace($jwtInput) -or $jwtInput.ToUpper() -eq 'G') {
        $currentJwtSecret = New-RandomSecret
        Write-Host 'Generated a strong JWT_SECRET.' -ForegroundColor Green
    } else {
        $currentJwtSecret = $jwtInput
    }
    Set-EnvValue -Path $envPath -Key 'JWT_SECRET' -Value $currentJwtSecret
}

$encryptionKeys = Get-EnvValue -Path $envPath -Key 'SECRET_ENCRYPTION_KEYS'
if ([string]::IsNullOrWhiteSpace($encryptionKeys)) {
    $encryptionKeys = "v1:$(New-EncryptionKey)"
    Set-EnvValue -Path $envPath -Key 'SECRET_ENCRYPTION_CURRENT_KEY_ID' -Value 'v1'
    Set-EnvValue -Path $envPath -Key 'SECRET_ENCRYPTION_KEYS' -Value $encryptionKeys
    Write-Host 'Generated a database Secret encryption key.' -ForegroundColor Green
}

$defaultLocalFrontendUrl = 'http://localhost:5173'
$defaultLocalCorsOrigin = 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173'

$frontendUrlCurrent = Get-EnvValue -Path $envPath -Key 'FRONTEND_URL'
if ([string]::IsNullOrWhiteSpace($frontendUrlCurrent)) {
    $frontendUrlCurrent = $defaultLocalFrontendUrl
}

$corsOriginCurrent = Get-EnvValue -Path $envPath -Key 'CORS_ORIGIN'
if ([string]::IsNullOrWhiteSpace($corsOriginCurrent)) {
    $corsOriginCurrent = $defaultLocalCorsOrigin
}

Set-EnvValue -Path $envPath -Key 'FRONTEND_URL' -Value $frontendUrlCurrent
Set-EnvValue -Path $envPath -Key 'CORS_ORIGIN' -Value $corsOriginCurrent

$apiUrlCurrent = Get-EnvValue -Path $envPath -Key 'AI_API_URL'
if ([string]::IsNullOrWhiteSpace($apiUrlCurrent)) {
    $apiUrlCurrent = 'https://api.deepseek.com'
}
$apiUrlInput = Read-Host "AI_API_URL [$apiUrlCurrent]"
if (-not [string]::IsNullOrWhiteSpace($apiUrlInput)) {
    $apiUrlCurrent = $apiUrlInput
}
Set-EnvValue -Path $envPath -Key 'AI_API_URL' -Value $apiUrlCurrent

$apiKeyCurrent = Get-EnvValue -Path $envPath -Key 'AI_API_KEY'
if (-not (Test-AIConfigValue -Value $apiKeyCurrent -InvalidValues @('sk-your-api-key', 'your-api-key'))) {
    $apiKeyCurrent = ''
}
$apiKeyPrompt = 'AI_API_KEY'
if (-not [string]::IsNullOrWhiteSpace($apiKeyCurrent)) {
    $apiKeyPrompt = 'AI_API_KEY (leave empty to keep current)'
}
$apiKeyInput = Read-Host $apiKeyPrompt
if (-not [string]::IsNullOrWhiteSpace($apiKeyInput)) {
    $apiKeyCurrent = $apiKeyInput
}
Set-EnvValue -Path $envPath -Key 'AI_API_KEY' -Value $apiKeyCurrent

if (-not (Test-AIConfigValue -Value $apiKeyCurrent -InvalidValues @('sk-your-api-key', 'your-api-key'))) {
    Write-Host 'Warning: AI_API_KEY is still missing. start-dev.ps1 will block startup until you set a real key.' -ForegroundColor Yellow
}

$aiModelCurrent = Get-EnvValue -Path $envPath -Key 'AI_MODEL'
if ([string]::IsNullOrWhiteSpace($aiModelCurrent)) {
    $aiModelCurrent = 'deepseek-v4-flash'
}
$aiModelInput = Read-Host "AI_MODEL [$aiModelCurrent]"
if (-not [string]::IsNullOrWhiteSpace($aiModelInput)) {
    $aiModelCurrent = $aiModelInput
}
Set-EnvValue -Path $envPath -Key 'AI_MODEL' -Value $aiModelCurrent

$aiReasoningModelCurrent = Get-EnvValue -Path $envPath -Key 'AI_MODEL_REASONING'
if ([string]::IsNullOrWhiteSpace($aiReasoningModelCurrent)) {
    $aiReasoningModelCurrent = 'deepseek-v4-pro'
}
$aiReasoningModelInput = Read-Host "AI_MODEL_REASONING [$aiReasoningModelCurrent]"
if (-not [string]::IsNullOrWhiteSpace($aiReasoningModelInput)) {
    $aiReasoningModelCurrent = $aiReasoningModelInput
}
Set-EnvValue -Path $envPath -Key 'AI_MODEL_REASONING' -Value $aiReasoningModelCurrent

$adminNameCurrent = Get-EnvValue -Path $envPath -Key 'INIT_ADMIN_NAME'
if ([string]::IsNullOrWhiteSpace($adminNameCurrent)) {
    $adminNameCurrent = 'admin'
}
$adminNameInput = Read-Host "INIT_ADMIN_NAME [$adminNameCurrent]"
if (-not [string]::IsNullOrWhiteSpace($adminNameInput)) {
    $adminNameCurrent = $adminNameInput
}
Set-EnvValue -Path $envPath -Key 'INIT_ADMIN_NAME' -Value $adminNameCurrent

$adminPasswordInput = Read-Host 'INIT_ADMIN_PASSWORD (leave empty to keep current)'
if (-not [string]::IsNullOrWhiteSpace($adminPasswordInput)) {
    Set-EnvValue -Path $envPath -Key 'INIT_ADMIN_PASSWORD' -Value $adminPasswordInput
}

$jwtMasked = (Get-EnvValue -Path $envPath -Key 'JWT_SECRET')
$apiKeyMasked = (Get-EnvValue -Path $envPath -Key 'AI_API_KEY')
$encryptionKeyMasked = (Get-EnvValue -Path $envPath -Key 'SECRET_ENCRYPTION_KEYS')
$aiKeyConfigured = Test-AIConfigValue -Value $apiKeyMasked -InvalidValues @('sk-your-api-key', 'your-api-key')

Write-Host ''
Write-Host 'Environment ready.' -ForegroundColor Green
Write-Host "  File: $envPath" -ForegroundColor DarkGray
Write-Host "  JWT_SECRET: $(if ($jwtMasked) { 'configured' } else { 'missing' })" -ForegroundColor DarkGray
Write-Host "  AI_API_KEY: $(if ($aiKeyConfigured) { 'configured' } else { 'missing' })" -ForegroundColor DarkGray
Write-Host "  SECRET_ENCRYPTION_KEYS: $(if ($encryptionKeyMasked) { 'configured' } else { 'missing' })" -ForegroundColor DarkGray
Write-Host "  FRONTEND_URL: $frontendUrlCurrent" -ForegroundColor DarkGray
Write-Host "  CORS_ORIGIN: $corsOriginCurrent" -ForegroundColor DarkGray
Write-Host 'You can run ./start-dev.ps1 to start services.' -ForegroundColor Cyan

if (-not $NoPause) {
    Write-Host ''
    Write-Host 'Initial setup complete. Press any key to exit...' -ForegroundColor Green
    try {
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    } catch {
        Read-Host 'Press Enter to exit'
    }
}
