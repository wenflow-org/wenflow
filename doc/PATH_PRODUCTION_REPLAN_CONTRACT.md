# 路径生产场景改造说明（统一架构）

## 适用范围

仅覆盖路径生产链路：

- goal-conversation -> learning.service -> path-agent -> learning_paths/milestones/subtasks

不包含教学会话、summary、session-evaluation 等其他场景。

## 统一输出约定（path-agent）

path-agent 返回遵循 `agent-output-v1`：

- `userVisible`
- `internal.core`
  - `stage`
  - `confidence`
  - `isCompleted`
- `internal.ext.path`
  - `path`
  - `totalMilestones`
- `renderHints`
- `schemaVersion`
- `metadata`

兼容期保留 legacy 顶层字段 `path` 与 `internal.path`。

## 输入透传约定（路径生成）

learning.service 调用 path-agent 时，除基础字段外需透传：

- `structuredData`
- `confirmedProposal`
- `confidenceScores`
- `conversationHistory`
- `metadata.totalWeeks`（可选）

## Anderson 标注策略

- 标注字段来源修正为 `label-generator` 的 `displayLabel/shortLabel`。
- 标注失败采用 fail-open：路径继续生成，不因标注失败中断。

## existingPathId 覆写策略

当传入 `existingPathId` 时：

1. 更新 path 主记录
2. 删除该 path 下旧 milestones（级联删除 subtasks）
3. 按新结果重建 milestones/subtasks

保证同一路径 ID 下不会混入旧结构残留。

## 重调能力（现行实现）

服务与路由契约：

- `POST /api/learning/paths/:pathId/replan`（学习者侧/管理侧：课后建议调整）
- `POST /api/learning/paths/:pathId/regenerate`（用户侧：补充说明重新生成 / 失败重试）

### 现行模式

| 模式 | 状态 | 语义 |
|---|---|---|
| `replan` + `mode=overwrite` | ✅ 现行唯一模式（默认） | 就地重设计**单个目标阶段**（resolveStageReplanTarget 定位当前活动阶段）：删除该阶段未完成任务、保留已完成（order 续排）、冻结学习证据、rollbackSnapshot 可恢复；发 `path:adjusted` 事件 |
| `replan` + `mode=new_version` | ❌ 未实现（抛 `PATH_VERSIONING_NOT_SUPPORTED` 409） | 契约第一版曾承诺"创建新路径版本"，从未落地；按 2026-08-31 决策**不实现版本化/回退**（用户侧无需旧版本，overwrite + 冻结语义已满足） |
| `regenerate`（无 adjustments） | ✅ | 整路径覆盖重建（replace-path）：删除旧 milestones 重建，**有学习进度（completed/in_progress）即 409 拦截** |
| `regenerate` + `adjustments`（2026-08-31 新增） | ✅ | 用户侧"补充说明重新生成"：无进度 → 整路径重建（补充说明注入 `normalizedInput.understanding.adjustments` 供 path-agent 重规划）；有 completed 无 in_progress → 收敛为 replan-stage 重设计当前活动阶段（reason=补充说明，已完成保留）；有 in_progress/未结束课堂 → 409 |

契约字段：

- `triggerSource`: `goal-conversation|learner-model-agent|ai-teaching|admin|system|api`
- `mode`: `new_version|overwrite`（服务端默认 `overwrite`；`new_version` 抛错）
- `evidence`: 自定义证据对象
- `adjustments`（regenerate 专用）: 用户补充说明文本

### 行为约定

- `replan`（overwrite）：
  - 基于当前路径 + learner replan projection 重设计当前活动阶段
  - 已完成任务保留冻结，`request.evidence.learnerReplanProjection` 注入
  - 补写 `learning_paths.replanMode/replanReason/replanTriggerSource`（血缘字段）
  - 用户侧补充说明（regenerate 转 replan 分支）时，补充说明作为 `reason` 传给 stage-designer
- `regenerate`（无进度重建）：
  - 补充说明进入 `metadata.replan` / `normalizedInput.understanding.adjustments`，path-agent 重规划时优先遵守（与已确认方案冲突时以补充说明为准）

## 重调输入约定

`learning.service -> path-agent` 在重调场景透传：

- `metadata.replan.mode`
- `metadata.replan.triggerSource`
- `metadata.replan.sourcePathId`
- `metadata.replan.freezeCompletedTaskIds`
- `metadata.replan.learnerReplanProjection`
- `normalizedInput.understanding.adjustments`（用户侧补充说明，regenerate 场景）

含义：

- `learnerReplanProjection`：给路径重调消费的学习者投影
- `freezeCompletedTaskIds`：提醒 path-agent 这是已有学习历史，不可按普通新规划忽略
- `adjustments`：用户对路径不满意之处的直接陈述，重规划时最高优先级输入

约束：

- `path-agent` 仍复用主生成能力
- prompt 已明确区分"新建路径"和"路径重调"语义（path-planning.yaml 含补充说明消费规则）

硬规则：

- 已学内容冻结（`completed` 任务不可改写）
- 有 `in_progress` 任务或未结束课堂时禁止任何重调（409 提示先结束课堂）
- 默认重调模式为 `overwrite`
