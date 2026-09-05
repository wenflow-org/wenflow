# 监督一个虚拟学习者完整学完一节课（teaching-step 循环直到 task 完成）
$ErrorActionPreference = 'Continue'
$Base = 'http://127.0.0.1:3001'
$OutFile = Join-Path $PSScriptRoot '..\logs\vlab-lesson.log'

function Log($msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Write-Host $line
  Add-Content -Path $OutFile -Value $line -Encoding UTF8
}

# 登录
$envContent = Get-Content (Join-Path $PSScriptRoot '..\backend\.env')
$adminName = ($envContent | Where-Object { $_ -match '^INIT_ADMIN_NAME=' }) -replace '^INIT_ADMIN_NAME=',''
$adminPass = ($envContent | Where-Object { $_ -match '^INIT_ADMIN_PASSWORD=' }) -replace '^INIT_ADMIN_PASSWORD=',''
$body = @{ name = $adminName; password = $adminPass; remember = $true } | ConvertTo-Json
$resp = Invoke-WebRequest -Uri "$Base/api/admin-auth/login" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20 -UseBasicParsing
$sid = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$cookie = ($resp.Headers['Set-Cookie'] -split ';')[0]
$sid.Cookies.SetCookies('http://127.0.0.1:3001/', $cookie)
$h = @{ Origin = 'http://localhost:5173' }
Log 'LOGIN OK'

$sessionId = '6d53ee90-dfc5-4cc1-b2f1-b2f868bda7e5'

function Call-Api($method, $path, $payload = $null) {
  $params = @{ Uri = "$Base$path"; Method = $method; WebSession = $sid; Headers = $h; TimeoutSec = 420 }
  if ($payload) { $params.Body = ($payload | ConvertTo-Json -Depth 10); $params.ContentType = 'application/json' }
  try {
    return Invoke-RestMethod @params
  } catch {
    Log "API FAIL $method $path : $($_.Exception.Message)"
    if ($_.ErrorDetails) { Log "  detail: $($_.ErrorDetails.Message.Substring(0, [Math]::Min(300, $_.ErrorDetails.Message.Length)))" }
    return $null
  }
}

# 重启学习阶段
Log "restart-learning on $sessionId"
$rl = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/restart-learning"
if (-not $rl) { Log 'restart-learning failed'; exit 1 }
$rl | ConvertTo-Json -Depth 3 -Compress | ForEach-Object { Log "restart: $($_.Substring(0, [Math]::Min(300, $_.Length)))" }

$maxRounds = 15
$taskDone = $false
for ($i = 1; $i -le $maxRounds; $i++) {
  Log "===== teaching round $i ====="
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $step = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/teaching-step"
  $sw.Stop()
  Log "step duration: $([Math]::Round($sw.Elapsed.TotalSeconds, 1))s"
  if (-not $step) {
    Log 'step FAILED, sleep 30s and continue'
    Start-Sleep -Seconds 30
    continue
  }
  $d = $step.data
  if ($d.userMessage) { Log "learner: $($d.userMessage.Substring(0, [Math]::Min(200, $d.userMessage.Length)))" }
  if ($d.aiResponse) { Log "teacher: $($d.aiResponse.Substring(0, [Math]::Min(300, $d.aiResponse.Length)))" }
  if ($d.error) { Log "step error: $d.error" }
  Log "taskCompleted=$($d.taskCompleted) isPathCompleted=$($d.isPathCompleted) milestone=$($d.milestoneProgress.currentMilestone)/$($d.milestoneProgress.totalMilestones) task=$($d.milestoneProgress.currentTask)"
  if ($d.taskCompleted -or $d.isPathCompleted) { $taskDone = $true; Log 'TASK COMPLETED'; break }
  Start-Sleep -Seconds 3
}

if (-not $taskDone) {
  Log "REACHED MAX ROUNDS ($maxRounds) without completion"
  # 尝试触发 wrapup 看能否收尾
  $w = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/wrapup"
  if ($w) { Log "wrapup triggered: $(($w | ConvertTo-Json -Depth 2 -Compress).Substring(0, [Math]::Min(200, ($w | ConvertTo-Json -Depth 2 -Compress).Length)))" }
} else {
  # 任务完成，等 wrapup 自动/手动生成
  Start-Sleep -Seconds 5
  $w = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/wrapup"
  if ($w) { Log "wrapup triggered" }
}

Log '===== LESSON SUPERVISION END ====='
