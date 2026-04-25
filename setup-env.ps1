# WenFlow environment setup helper

param(
    [switch]$EditOnly
)

$ErrorActionPreference = 'Stop'

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

    Set-Content -Path $Path -Value $content -Encoding UTF8
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

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendPath = Join-Path $scriptDir 'backend'
$envPath = Join-Path $backendPath '.env'
$envExamplePath = Join-Path $backendPath '.env.example'

if (-not (Test-Path $backendPath)) {
    Write-Host "Backend directory not found: $backendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $envPath)) {
    if (Test-Path $envExamplePath) {
        Copy-Item -Path $envExamplePath -Destination $envPath
        Write-Host "Created backend/.env from .env.example" -ForegroundColor Green
    } else {
        New-Item -ItemType File -Path $envPath | Out-Null
        Write-Host "Created empty backend/.env" -ForegroundColor Green
    }
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
$apiKeyInput = Read-Host 'AI_API_KEY (leave empty to keep current)'
if (-not [string]::IsNullOrWhiteSpace($apiKeyInput)) {
    $apiKeyCurrent = $apiKeyInput
    Set-EnvValue -Path $envPath -Key 'AI_API_KEY' -Value $apiKeyCurrent
}

$aiModelCurrent = Get-EnvValue -Path $envPath -Key 'AI_MODEL'
if ([string]::IsNullOrWhiteSpace($aiModelCurrent)) {
    $aiModelCurrent = 'deepseek-chat'
}
$aiModelInput = Read-Host "AI_MODEL [$aiModelCurrent]"
if (-not [string]::IsNullOrWhiteSpace($aiModelInput)) {
    $aiModelCurrent = $aiModelInput
}
Set-EnvValue -Path $envPath -Key 'AI_MODEL' -Value $aiModelCurrent

$aiReasoningModelCurrent = Get-EnvValue -Path $envPath -Key 'AI_MODEL_REASONING'
if ([string]::IsNullOrWhiteSpace($aiReasoningModelCurrent)) {
    $aiReasoningModelCurrent = 'deepseek-reasoner'
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

Write-Host ''
Write-Host 'Environment ready.' -ForegroundColor Green
Write-Host "  File: $envPath" -ForegroundColor DarkGray
Write-Host "  JWT_SECRET: $(if ($jwtMasked) { 'configured' } else { 'missing' })" -ForegroundColor DarkGray
Write-Host "  AI_API_KEY: $(if ($apiKeyMasked) { 'configured' } else { 'missing' })" -ForegroundColor DarkGray
Write-Host 'You can run ./start-dev.ps1 to start services.' -ForegroundColor Cyan
