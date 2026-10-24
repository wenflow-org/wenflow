# 离线评审基线修复与验证（2026-10-24）

> 基线：[OFFLINE-EVAL-BASELINE-2026-10-23.md](OFFLINE-EVAL-BASELINE-2026-10-23.md)
> 修复提交：`df937b81`（+ `67b28d69` 分层重构）

## 一、修了什么

### 课堂收口（基线：unclosedComplete 85%、summaryMismatch 50%）

- `teaching-closure.ts` 新增 `buildClosureAudit` / `appendClosureFollowUp`：
  与结算门禁同源（`allowOpenQuestion=false`）判定；`end_only`/复习课仍可带着未答问题收束，
  但 wrapup 必须落：
  - `closureAudit = { openQuestion, code, question, deferredTimes }`
  - `finalizationAction`（`end_only` / `complete_task` / `complete_review`）
  - `summary.actionPlan` 置顶「待验证：<原问题>」
- 这样「会话结束」不再被读成「任务完成/学员已掌握」；模型总结漏掉未答问题时也一定留痕。
- 离线评审同步：case 块注入收口事实，prompt 明确 `end_only ≠ 任务完成`；
  `openQuestion=true + 待验证` 判诚实收口，仍宣称完成才判 `unclosedComplete`。

### 路径结构（基线：prerequisiteGap 30%、budgetMismatch 35%、duplicateTask 20%）

- `path-structure-audit.ts`：
  - `auditPathStructure`：KC 前置边 vs `taskKcLinks` 的机械缺口、重复标题、课时偏差；
    前序任务标题/说明提到前置 KC 名时视为隐式引入，降低误报；
  - `reorderTasksForPrerequisites`：只对**同阶段**「前置任务排在后继之后」做稳定前移；
    有环保持原序、不丢任务。
- 生成期：`path-structure-integration.ts` 在创建任务前原地重排（DB 与模板顺序一致），
  生成后把审计写入 `aiPromptTemplate.pathAudit`（只记录，跨阶段依赖不移动任务）。
- 离线评审：课时比分母改用 `budgetConservation.after`（守恒后计划），
  `target` 是守恒前容量，避免把已声明的缩水误判为 `budgetMismatch`。
- 只读脚本：`backend/scripts/audit-path-structure.ts` 对存量路径复算。

## 二、静态回放（现有数据，不调模型）

| 对象 | 结果 |
|---|---|
| 已完成课堂 979 节（均有消息） | 434 节（44.3%）会被写入 `closureAudit` + 「待验证」 |
| 存量路径 352 条 | 160 条（45.5%）可被同阶段重排，共 303 条前置边 |

存量路径结构审计（321 条有 KC 标注的路径）：前置缺口 579 条（同阶段可重排 144 / 跨阶段 182），
重复任务 0，课时偏差 5。跨阶段依赖需要移动任务/阶段，仍只审计、不自动修复。

## 三、虚拟学习者验证：被平台 AI 余额阻断

2026-10-24 02:00 UTC 启动 4 个虚拟学习者（`[verify-1024] v01–v04`，20 模拟日）：

- `goal` 阶段正常，路径生成后 `day1` 反复返回 **HTTP 402 `Billing: insufficient_funds`**；
- 4 路均卡在 day1，没有产生可评估的课堂/路径数据；
- 已停止 4 个 harness（保留日志 `outputs/verify-20261024/`），后端仍 health=ready。

**这不是代码问题**：平台侧 LLM 通道余额不足。离线评审通道（`OFFLINE_EVAL_*`）正常，
但不能替平台跑生成/教学。打款或把平台通道切到可用余额后，重跑：

```bash
cd backend
npx ts-node --transpile-only src/scripts/simulate-learner-e2e.ts \
  --name="[verify-1024] v01" --days=20 --base-days-ago=22 \
  --advisory-response=keep --keep --state=../outputs/verify-20261024/v01.json
```

跑完后用同一 judgeVersion 对**旧基线样本**与**新样本**各跑一遍离线评审，
再用 `audit-path-structure.ts --days=1` 对比前置缺口率，才算端到端验证完成。

## 四、未完成（等验证结果再决定）

- 跨阶段前置缺口（182 条）是否自动移动任务/阶段；
- 课时偏差的真实修复（当前只保证分母口径正确，5 条存量偏差未处理）；
- 重复任务自动合并（基线 0 条，暂不需要）。

## 五、虚拟学习者端到端验证（2026-10-24 04:30 UTC）

### 通道与临时配置

- 平台通道切到 `https://newapi.wenflow.org`；`deepseek-v4.1-flash` 仍被上游
  `Billing: insufficient_funds`（402）/ 网关 524 阻断，因此**仅本轮验证**临时把
  20 条显式 `skill_model_configs` 与平台默认模型切到 `agnes-3.0-flash`。
- 验证结束后已按 `doc/local/model-config-backup-20261024.json` 原样恢复
  （20 条 skill 行回 `deepseek-v4.1-flash`，平台 `defaultModel` /
  `defaultReasoningModel` / `defaultEvaluationModel` 同回），并重启后端至 ready。
  7 条 `virtual-learner-*` 的 agnes 配置是验证前既有设置，不在本次临时变更内。
- agnes 批次期间后端无新增 402（最后一条 402 在切通道前 11:05）。

### 结果

单学习者 probe2（3 个模拟日，未来日期 2026-10-21～23）：

- day1 387s / day2 210s 正常推进；3 节已完成课堂中 2 节落 `closureAudit`，
  均为 `openQuestion=true` + `FINALIZATION_OPEN_QUESTION` + `summary.actionPlan`
  置顶「待验证」，另 1 节正常闭合无审计。

4 学习者（`v13`–`v16`，20 日上限，实际完成路径即停止）：

| 学习者 | 模拟日 | 已完成课堂 | 收口审计/开放 | 待验证 | 路径 | 结构问题 |
|---|---:|---:|---:|---:|---|---|
| v13 | 7 | 8 | 3 | 3 | completed 2/2 | 0 |
| v14 | 12 | 13 | 4 | 4 | completed 4/4 | 0 |
| v15 | 5 | 6 | 0 | 0 | completed 2/2 | 0 |
| v16 | 9 | 11 | 3 | 3 | completed 3/3 | 0 |

- 4 路 harness 均 `成功 / findings=0`，路径全部走到 `completed`。
- 38 节已完成课堂中 10 节（26.3%）带未答问题收束，10/10 都写入「待验证」；
  代码分布 9×`FINALIZATION_OPEN_QUESTION` + 1×`FINALIZATION_PENDING_CHECKPOINT`。
- 4 条新路径的 `aiPromptTemplate.pathAudit` 均未写（=0 问题），只读脚本
  `audit-path-structure.ts --scope=virtual --days=1` 复算同样不报这 4 条；
  说明同阶段重排在真实生成链路生效，且这 4 次生成没有跨阶段前置缺口。
- 早前 probe/probe2 路径仍各留 2 条跨阶段前置缺口（只审计不移动），与
  「跨阶段暂不自动修复」的边界一致。

### 新发现：goal 阶段不收敛

`v11`、`v12` 均在 `goal` 阶段跑满 14 步（harness 上限）未离开：
`v11` 停在 `proposing`，`v12` 停在 `understanding`。对话里模拟学员反复
「先去查后台/先看看数据」延期，goal agent 一直等用户带回结果，既不收敛也不
落「待验证」临时方案。失败 2/6（33%），与课堂收口是同一类语义缺口：
**用户延期时应产出带假设的临时方案并显式留待验证，而不是无限等待**。

### 离线评审

本批验证开始时 `deepseek-v4.1-flash` 不可用（402/524），因此只做了结构/收口验证；
当日 06:00 UTC 通道恢复后已补跑，见 §六。

## 六、离线评审恢复与首轮结果（2026-10-24 06:20 UTC）

### 工具修复

- **RPM 闸门**：`lib.mjs` 增加全局滑动窗口限速（默认 10 RPM），
  每次「请求开始」占一个名额（重试同样计数）；`--rpm` / `OFFLINE_EVAL_RPM` 可调。
  同案例 K 次判读改为串行，`--conc` 才真正等于在途上限。
- **语法事故**：为收口口径新增的反引号正文没有转义，导致
  `classroom.mjs` / `path.mjs` 整个模块无法加载。已改为「」中文引号，
  `--selftest` 恢复 11/11。这是离线评审此前「看起来能用、实际起不来」的直接原因之一。
- `deepseek-v4.1-flash` 直连已恢复（200，5s）；本轮评审 `calls/failures` 会随重试上升，
  但单次 `rateWaits` 很低（10 RPM 未成为瓶颈，模型延迟才是）。

### 结果（ds4.1 判读，K=3）

| 样本 | 范围 | pass | soft | overall | 关键 flag |
|---|---|---:|---:|---:|---|
| 课堂 baseline（旧 judge） | 20，旧数据 | 10% | 80% | 0.757 | unclosed 85%、summary 50% |
| 课堂 broad（新 judge） | 20，今日全天（含修复前会话） | 15% | 75% | 0.760 | unclosed 40%、summary 55% |
| 课堂 post-fix（新 judge） | 20/41，修复后新会话 | 15% | 75% | 0.718 | unclosed 20%、summary 80% |
| 路径 baseline（旧 judge） | 20，旧路径 | 65% | 90% | 0.783 | prerequisite 30%、budget 35% |
| 路径 broad（新 judge） | 20，今日新旧混合 | 85% | 100% | 0.823 | prerequisite 15%、budget 30%、duplicate 25% |
| 路径 post-fix（新 judge） | 5，修复后新路径 | 100% | 100% | 0.843 | prerequisite 0%、budget 20%、duplicate 20% |

- 新 judge 的 prompt 已改（收口语义与课时分母），`judgeVersion` 与 baseline 不同，
  因此跨版本数值只能看方向，不能当严格 A/B。
- post-fix 课堂样本由 agnes 授课（ds4.1 当时不可用），课堂讲解/总结维度偏低
  （summaryMismatch 80%）主要反映授课模型，不是收口修复本身。
- 路径 post-fix 的 prerequisiteGap 降到 0、domainViolation 0，与结构审计一致；
  duplicateTask 仍 20%，属于内容层面重复，待后续处理。

### 新修复：无问号的「请提交」请求

离线评审抓到 4 节 `unclosedComplete`，其末条教师消息没有问号：

- 「请更新后的 8 行标签发给我做最后确认。」
- 「现在请回答下面的快速题，确认我们对忙闲倾向的判断：」
- 「现在把这三条映射关系……完整写一遍发给我，作为最终稿。」

旧 `detectTrailingQuestion` 只认 `?/？`，收口审计因此判成已闭合。
已在 `teaching-closure.ts` 增加 `detectOpenRequest`（末两句、排除课后建议/下一节预告），
并让 `evaluateSessionClosable` 与 `lastTeacherQuestion` 共用。
新增 2 组回归测试；`session-closure-gate.test.ts` 15/15。

对 41 节 post-fix 会话静态回放：收口审计从 12 节升到 23 节（+11），
4 节被 judge 判 `unclosedComplete` 的会话全部被新判据覆盖，无旧审计丢失。
该修复只对新会话生效，存量 wrapup 不回填。
