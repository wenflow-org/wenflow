# WenFlow environment setup helper

param(
    [switch]$EditOnly,
    [switch]$NoPause
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
    $aiModelCurrent = 'deepseek-v4.1-flash'
}
$aiModelInput = Read-Host "AI_MODEL [$aiModelCurrent]"
if (-not [string]::IsNullOrWhiteSpace($aiModelInput)) {
    $aiModelCurrent = $aiModelInput
}
Set-EnvValue -Path $envPath -Key 'AI_MODEL' -Value $aiModelCurrent

# 平台只有这一个默认模型（2026-11-04 起不再问 AI_MODEL_REASONING：某个 Skill 要不要长思考
# 由它的思考模式 / 推理强度决定，不是换一个模型）。旧 .env 里残留的该键不再被后端读取。

# 向量 / 重排（基础设施模型）：只作首次部署种子与回落，管理台「模型与接入」优先。
# 留空即不启用语义层（fail-open 回退关键词/窗口），不影响启动。默认模型名给出可直接用的值。
$embedUrlCurrent = Get-EnvValue -Path $envPath -Key 'EMBEDDING_API_URL'
$embedUrlInput = Read-Host "EMBEDDING_API_URL (向量模型地址，留空 = 不启用 [$($embedUrlCurrent)])"
if (-not [string]::IsNullOrWhiteSpace($embedUrlInput)) {
    $embedUrlCurrent = $embedUrlInput
}
if (-not [string]::IsNullOrWhiteSpace($embedUrlCurrent)) {
    Set-EnvValue -Path $envPath -Key 'EMBEDDING_API_URL' -Value $embedUrlCurrent
}

$embedKeyCurrent = Get-EnvValue -Path $envPath -Key 'EMBEDDING_API_KEY'
$embedKeyInput = Read-Host "EMBEDDING_API_KEY (向量模型密钥，回车沿用当前)"
if (-not [string]::IsNullOrWhiteSpace($embedKeyInput)) {
    $embedKeyCurrent = $embedKeyInput
}
if (-not [string]::IsNullOrWhiteSpace($embedKeyCurrent)) {
    Set-EnvValue -Path $envPath -Key 'EMBEDDING_API_KEY' -Value $embedKeyCurrent
}

$rerankUrlCurrent = Get-EnvValue -Path $envPath -Key 'RERANK_API_URL'
$rerankUrlInput = Read-Host "RERANK_API_URL (重排模型地址，留空 = 不启用 [$($rerankUrlCurrent)])"
if (-not [string]::IsNullOrWhiteSpace($rerankUrlInput)) {
    $rerankUrlCurrent = $rerankUrlInput
}
if (-not [string]::IsNullOrWhiteSpace($rerankUrlCurrent)) {
    Set-EnvValue -Path $envPath -Key 'RERANK_API_URL' -Value $rerankUrlCurrent
}

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
