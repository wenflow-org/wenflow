# 虚拟学习者 UX 全链路测试脚本（只读 API 调用 + 触发模拟，不改代码）
# 用法: pwsh -File scripts/vlab-ux-test.ps1
$ErrorActionPreference = 'Continue'
$Base = 'http://127.0.0.1:3001'
$OutFile = Join-Path $PSScriptRoot '..\logs\vlab-ux-test.log'

function Log($msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Write-Host $line
  Add-Content -Path $OutFile -Value $line -Encoding UTF8
}

# ---- 登录 ----
$envContent = Get-Content (Join-Path $PSScriptRoot '..\backend\.env')
$adminName = ($envContent | Where-Object { $_ -match '^INIT_ADMIN_NAME=' }) -replace '^INIT_ADMIN_NAME=',''
$adminPass = ($envContent | Where-Object { $_ -match '^INIT_ADMIN_PASSWORD=' }) -replace '^INIT_ADMIN_PASSWORD=',''
$body = @{ name = $adminName; password = $adminPass; remember = $true } | ConvertTo-Json
$resp = Invoke-WebRequest -Uri "$Base/api/admin-auth/login" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20 -UseBasicParsing
$sid = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$cookie = ($resp.Headers['Set-Cookie'] -split ';')[0]
$sid.Cookies.SetCookies('http://127.0.0.1:3001/', $cookie)
Log 'LOGIN OK'

function Call-Api($method, $path, $payload = $null) {
  $params = @{ Uri = "$Base$path"; Method = $method; WebSession = $sid; TimeoutSec = 300 }
  if ($payload) { $params.Body = ($payload | ConvertTo-Json -Depth 10); $params.ContentType = 'application/json'; $params.Headers = @{ Origin = 'http://localhost:5173' } }
  try {
    $r = Invoke-RestMethod @params
    return $r
  } catch {
    Log "API FAIL $method $path : $($_.Exception.Message)"
    if ($_.ErrorDetails) { Log "  detail: $($_.ErrorDetails.Message.Substring(0, [Math]::Min(400, $_.ErrorDetails.Message.Length)))" }
    return $null
  }
}

# ---- 找有故事的虚拟学习者（直接取第一个）----
$vl = Call-Api 'GET' '/api/admin/virtual-learners'
$profiles = $vl.data.profiles
$target = $null
foreach ($p in $profiles) {
  $stories = $p.profile.storyPool
  if ($stories -and $stories.Count -gt 0) {
    $target = $p
    break
  }
}
if ($null -eq $target) { Log 'no stories available, exit'; exit 1 }
$story = $target.profile.storyPool[0]
Log "profiles=$($profiles.Count) selected=$($target.profile.nameHint) story=$($story.title) id=$($story.id)"

# ---- 启动会话 ----
$start = Call-Api 'POST' "/api/admin/virtual-learners/$($target.id)/start-session" @{ storyId = $story.id; frictionBudget = 'normal' }
if (-not $start) { Log 'start session failed'; exit 1 }
$sessionId = $start.data.id
Log "session started: $sessionId"

# ---- Goal 阶段：手动 step，观察收束节奏 ----
Log '===== GOAL PHASE ====='
$maxGoalRounds = 8
$goalDone = $false
for ($i = 1; $i -le $maxGoalRounds; $i++) {
  $step = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/step"
  if (-not $step) { break }
  $d = $step.data
  $stage = $d.currentStage
  # 尝试提取本轮可见消息（goal）
  $vis = $d.stageResults.goal.visibleMessages
  if (-not $vis) { $vis = $d.visibleMessages }
  if (-not $vis) { $vis = $d.messages }
  if ($vis) {
    $last = $vis | Select-Object -Last 1
    $prev = $vis | Select-Object -Last 2 | Select-Object -First 1
    $learnerTxt = if ($last.role -match 'learner|user') { $last.content } else { '' }
    $platformTxt = if ($last.role -match 'platform|ai|assistant') { $last.content } else { '' }
    if (-not $learnerTxt -and $prev -and $prev.role -match 'learner|user') { $learnerTxt = $prev.content }
    Log "round-$i stage=$stage learner=$([string]$learnerTxt).Substring(0, [Math]::Min(90, [string]$learnerTxt.Length))"
    Log "      platform=$([string]$platformTxt).Substring(0, [Math]::Min(160, [string]$platformTxt.Length))"
  } else {
    $keys = ''
    if ($null -ne $d.stageResults) {
      $names = @($d.stageResults | Get-Member -MemberType NoteProperty | ForEach-Object { $_.Name })
      $keys = [string]::Join(',', $names)
    }
    Log "round-$i stage=$stage no-visible-messages keys=$keys"
  }
  if ($stage -eq 'completed' -or $d.goalConversationId) { $goalDone = $true; Log 'goal converged'; break }
  Start-Sleep -Seconds 2
}
Log "goal done=$goalDone"

# ---- Path 阶段 ----
Log '===== PATH PHASE ====='
Start-Sleep -Seconds 5
$adv = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/advance-path"
if ($adv) {
  Log "advance-path success=$($adv.success) path=$($adv.data.learningPathId)"
  Start-Sleep -Seconds 20
  # 查询 path 状态
  $ps = Call-Api 'GET' "/api/admin/virtual-learners/sessions/$sessionId/path-status"
  if ($ps) { Log "path-status: $(($ps.data | ConvertTo-Json -Depth 5 -Compress).Substring(0, [Math]::Min(800, ($ps.data | ConvertTo-Json -Depth 5 -Compress).Length)))" }
}

# ---- Teaching 阶段 ----
Log '===== TEACHING PHASE ====='
$learn = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/start-learning"
if ($learn) { Log "start-learning OK" } else { Log 'start-learning failed' }
Start-Sleep -Seconds 5
for ($i = 1; $i -le 3; $i++) {
  $ts = Call-Api 'POST' "/api/admin/virtual-learners/sessions/$sessionId/teaching-step"
  if (-not $ts) { break }
  $vis = $ts.data.visibleMessages
  if ($vis) {
    $last = $vis | Select-Object -Last 1
    Log "教学round-$i [$($last.role)] $([string]$last.content).Substring(0, [Math]::Min(200, [string]$last.content.Length))"
  } else {
    Log "教学round-$i (no visible messages)"
  }
  Start-Sleep -Seconds 2
}

Log "===== TEST END sessionId=$sessionId ====="
