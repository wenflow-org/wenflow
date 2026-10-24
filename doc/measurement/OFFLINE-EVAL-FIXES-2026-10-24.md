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
