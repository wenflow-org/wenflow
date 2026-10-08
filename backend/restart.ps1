# restart.ps1 — 后端统一重启入口（2026-10-08 流程卫生：止血挖掘模式⑥）
#
# 替代「杀端口 + ts-node 裸启 + touch 触发 respawn」的土法三件套：
#   1. tsc --noEmit 快检（--transpile-only 运行时不做类型检查，类型错误只等 CI 才炸）；
#   2. 杀指定端口进程；
#   3. ts-node --transpile-only 启动；
#   4. 轮询 /readyz 直到就绪（默认 90s 超时），失败即报非零退出码。
# 参数：
#   -Port 3001        目标端口（默认 3001）
#   -SkipTypeCheck    跳过 tsc 快检（赶时间时用，默认不跳）
# 用法：powershell -File backend/restart.ps1 -Port 3011
param(
    [int]$Port = 3001,
    [switch]$SkipTypeCheck
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'

Set-Location $backendDir

# 1) 类型快检
if (-not $SkipTypeCheck) {
    Write-Host '[restart] tsc --noEmit 快检…'
    node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw "[restart] 类型检查未过，取消重启（-SkipTypeCheck 可跳过）" }
}

# 2) 杀旧进程
$old = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($old) {
    $oldPid = ($old | Select-Object -First 1).OwningProcess
    Write-Host "[restart] 停止旧进程 PID=$oldPid (port $Port)"
    Stop-Process -Id $oldPid -Force
    Start-Sleep -Seconds 2
}

# 3) 启动（新窗口独立进程；日志走 backend/logs/）
$logFile = Join-Path $backendDir ('logs/backend-' + $Port + '.log')
Start-Process -FilePath 'node' -ArgumentList 'node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/index.ts' `
    -WorkingDirectory $backendDir -WindowStyle Hidden `
    -RedirectStandardOutput $logFile -RedirectStandardError ($logFile + '.err')

# 4) readyz 轮询
Write-Host "[restart] 等待 /readyz（最长 90s）…"
$deadline = (Get-Date).AddSeconds(90)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
        $resp = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $Port + "/readyz") -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -in 200..299) { $ready = $true; break }
    } catch { }
}
if ($ready) {
    Write-Host "[restart] 就绪：http://127.0.0.1:$Port （日志 $logFile）"
    exit 0
} else {
    Write-Host "[restart] 超时未就绪——查看 $logFile / $logFile.err"
    exit 1
}
