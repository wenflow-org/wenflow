# 新发现问题评估（2026-09-19）

> 来源：Wave 2 收尾与虚拟学习者验证过程中查出的三项。
> 方法：代码取证（file:line）。性质：**评估与建议，不含改动**。
> 关联：[`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)、[`SCALE_PREREQUISITES_DESIGN.md`](./SCALE_PREREQUISITES_DESIGN.md)。

---

## 0. 一句话结论

三项都**属实**，但其中两项的严重度比初判低（一项"已有重试只是没驱动"，一项"已有重试只缺优雅处置"）；
优先级建议：**#2 路径卡死 → #3 教学回合失败处置 → #1 真实侧时间信号**。

---

## 1. 真实教学链路缺"长间隔"时间信号（Q19 真实侧）

**结论：真缺口，但比初判小——跨会话的「内容」连续性已有，缺的是「时间维度」。**

**证据**
- 真实链路已有跨会话承接：`backend/src/services/ai-teaching/TeachingContextBuilder.ts:91` 的 `previousSession`
  （带上一场 messages/knowledgePoints）与 `:95` 的 `lastLessonRecap`（"老师记得我"的跨节摘要，按路径位置选源）。
- 但它们**不带时间**：`previousSession` 无 `endTime`/间隔；`temporalContext` / `sinceLastSessionDays` 在
  `services/ai-teaching`、`services/learning`、`skills/teaching-turn` **零命中**（只有虚拟链路
  `services/virtual-lab/simulated-day.service.ts` 产出）。

**影响（中）**
- 长间隔回归时，教学不会"更保守、先回捞"；与 FSRS 保留率脱节（记忆已衰减，教学却按"无间隔"处理）。
- 真实用户是主要受众，因此**产品价值高于另两项**，但需要产品先定阈值与行为。

**建议修法（成本低-中）**
1. 在真实会话开场/回合，按 `teaching_sessions` 同路径上一次 `endTime` 计算 `daysSinceLastSession`；
2. 注入 `TeachingContextBuilder` 上下文（如 `context.temporalGap`）；
3. `prompts/core/teaching-turn.yaml` 增一条规则：间隔超过 N 天 → 先做回捞/降低起点/更保守。
- 风险：prompt 行为变化需走查（编译 + 门禁 + 试跑）。

---

## 2. 路径生成失败后虚拟会话卡死（无自愈）

**结论：真缺口，但只影响虚拟/assisted 链路——平台本身有重试能力，是虚拟循环没去驱动它。**

**证据**
- 失败现场：`learning_paths.status='failed'`、`virtual_sessions.currentStage='path'`，
  harness 的 `path-status ready=false` 空等满 30 分钟（`path-not-ready-timeout`）。
- 平台**已内建重试**：`backend/src/services/learning/path-generation-status.ts:121/138`（`retryAllowed` /
  `retryType: 'core' | 'stageDesign'`）；API `PATCH /paths/:pathId/retry`（`backend/src/routes/learning.ts:623`）、
  `POST /paths/:pathId/retry-stage-design`（`:1100`）。
- assisted 协调器（`backend/src/coordinators/simulation.coordinator.ts`）**未调用**该重试
  （grep 无 `getPathGenerationRetry`）。

**影响（中，仅限 lab）**
- 虚拟实验室是当前**唯一**验证手段；一次路径生成失败就让跑数空等 30 分钟后失败。
- 真实用户不受此限（UI 有重试入口）。

**建议修法（成本低）**
- 首选：harness / assisted 检测到 `learning_paths.status==='failed'` → 调 `PATCH /paths/:id/retry`
  （有界次数，如 1-2 次），再等就绪；
- 或（更省）把"path failed"识别为**终局**并立即失败，而不是当成"未就绪"空等 30 分钟。
- 风险：低。

---

## 3. `TEACHING_TURN_REPLY_MISSING` 直接终局化

**结论：重试**已有**（2 次），缺的是"失败后的优雅处置"，不是"没有重试"。**

**证据**
- `backend/src/skills/teaching-turn/index.ts:893` 校验 `reply` 必须为非空字符串 →
  `TEACHING_TURN_REPLY_MISSING`；主 spec `:964-967` **`maxAttempts: 2` + 纠错重试提示**（已有有界重试）。
- 两次都失败后 → `AITeachingCoordinator` 抛错 → `simulation.coordinator`
  `AI教学响应失败，已停止当前学习步骤` → `updateSessionStatus(..., 'failed', 'teaching')`（`:981`）→
  **整场助手会话终局失败**。
- 观测：约 1/3 跑数（且并发争用时更频繁）出现；一次抖动即需人工续跑。

**影响（中）**
- 训练/验证跑数稳定性受损；真实教学里则可能表现为"这节课直接报错终止"。

**建议修法（成本中）**
- ① 失败时**暂停（可续跑）**而非终局 `failed`（与现有"会话租约/续跑"基建一致）；
- ② 有界重试内可提高温度 / 降思考，增加一次机会；
- ③ 兜底"最小安全回复"（请学生重述 / 给最小提示）——**需教学侧定调**，避免制造伪教学。
- 风险：中（触及会话终局语义与前端提示）。

---

## 4. 优先级建议

| 顺序 | 项 | 为什么先/后 | 成本 |
|---|---|---|---|
| 1 | **#2 路径卡死无自愈** | 最小改动、直接恢复虚拟实验室可用性 | 低 |
| 2 | **#3 教学回合失败终局化** | 提升跑数稳定性；先做"暂停可续跑"最小版 | 中 |
| 3 | **#1 真实侧时间信号** | 产品价值最高，但需先定阈值/行为 | 低-中（+决策） |

> 三项都**不在**本次 Wave 1/Wave 2 的既定范围内，属验证过程中新发现；建议作为 Wave 2.5 处理。

---

## 5. 修复记录（2026-09-19，已完成）

| 项 | 修复 | 提交 |
|---|---|---|
| **#2 路径失败无自愈** | `path-status` 增 `pathGeneration {pathId,status,retryAllowed,retryType,reason}`；失败**即时判终局**（不再空等 30 分钟）+ **有界自愈重试**（`core`/`stageDesign`，最多 2 次，新增 `POST /sessions/:id/retry-path-generation`） | `eb2f3bc9` |
| **#3 教学回合失败终局化** | 步骤级有界重试（≤2 次，仅命中已知校验码）；耗尽 → **可续跑暂停**（`status` 保持 `running` + `runtimeStats.lastError` 标记 + `teaching-step-paused`），**明确禁止伪造教师回复**；harness 识别为 `retryable` 而非终局 | `f2548c7d` |
| **#1 真实侧时间信号** | `controls.temporalGap = { daysSinceLastSession, isLongGap }`（同路径上一场 `endTime`，回退 recap 源；默认阈值 14 天，env `TEACHING_TEMPORAL_LONG_GAP_DAYS` 可覆盖）+ teaching-turn 一条"长间隔先回捞/更保守"规则；无前序会话则字段省略、行为不变 | `b6a6afd6` |

**验证**：全仓 **327/327 套件、2808 例通过**；`tsc` / `eslint` / prompts 门禁全过。

**残余与边界**
- #3：`lessonsPerDay>1` 且当天前一节已成功时，暂停任务**次日**继续（不强制同日重跑）；`isTeachingTurnHiccupError` 为保守白名单，新校验码回落旧终局行为（有意，避免把真实契约错误当无限暂停）。
- 三项均**未**在真实模型长跑中复测（仅单测 + 门禁）；收尾 E2E 受并发进程争用影响，未能稳定跑到终态。
