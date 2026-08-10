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

## 重调能力预留（第一版）

已预留服务与路由契约：

- `POST /api/learning/paths/:pathId/replan`

当前状态：

- `mode=new_version`：已启用
- `mode=overwrite`：仍未启用，返回 `status=not_enabled`

契约固定：

- `triggerSource`: `goal-conversation|progress-agent|ai-teaching|admin|system|api`
- `mode`: `new_version|overwrite`（默认 `new_version`）
- `evidence`: 自定义证据对象

第一版行为：

- `new_version` 模式下：
  - 基于当前路径 + learner replan projection 创建一条新路径版本
  - 不覆盖旧路径
  - learner memory 通过 `request.evidence.learnerReplanProjection` 注入
  - 路径生成输入会显式进入 `metadata.replan`

## 重调输入约定（第一版）

当 `new_version` 模式触发路径重调时，`learning.service -> path-agent` 除常规字段外，还会透传：

- `metadata.replan.mode`
- `metadata.replan.triggerSource`
- `metadata.replan.sourcePathId`
- `metadata.replan.freezeCompletedTaskIds`
- `metadata.replan.learnerReplanProjection`

含义：

- `learnerReplanProjection`：给路径重调消费的学习者投影
- `freezeCompletedTaskIds`：提醒 path-agent 这是已有学习历史，不可按普通新规划忽略

第一版约束：

- `path-agent` 仍复用主生成能力
- 但 prompt 已明确区分“新建路径”和“路径重调”语义

硬规则：

- 已学内容冻结（`completed` 任务不可改写）
- 默认重调模式为 `new_version`
