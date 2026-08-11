# doc/ 变更记录（CHANGELOG）

> 本文件随协议修订维护：SKILL_PROTOCOL_V4.md 等现行规范文档每次修订，均在此登记变更条目。
> 本文件是 doc/ 纳入版本控制（2026-08-10）后的变更基线；此前历次修订无 git 历史，仅以文档内注记（如"2026-08-09 复核"）为据。

## 2026-08-11 — 纯重试 + 明确失败改造（移除降级设计）

### 行为变化

- **failurePolicy 词表**：11 个 `fallback` core 全部改为 `propagate`（manifest 同步 `blocking`）；core 词表保留 `fallback` 仅为兼容历史数据，中期收敛为 `retry | propagate`（见 RETRY_FAILURE_IMPACT.md §5.2 路径 B）。
- **session-wrapup**：evaluation 缺失时不再调 session-evaluation-fallback 补全、不再保守评分；直接 `evaluation=null + evaluationSource='unavailable'`（全链路 null 容忍，与 M1 兜底同形态）。
- **teaching-opening-generator**：开场生成失败/超时不再返回确定性 fallback opening，改为抛错（`OPENING_GENERATION_FAILED`，保留 15s 超时边界）→ `failInitialization` 清理会话 + 前端可见"开课失败"。
- **runAux**：`resolveDefaultFailureMode` 对存量 `deterministic-fallback`/`best-effort` 防御性按 propagate 处理并 warn；`__fallback` 保留（调用方显式兜底属调用方决策）。
- **重试预算**：`maxLogicalRetries` 默认 1 → 2（硬上限 2 保持，与 `RETRY_BUDGET_HARD_LIMITS` 对齐）。

### 文档

- SKILL_PROTOCOL_V4.md §2.4.4：failurePolicy 语义同步（fallback 已退役、防御性 propagate 处理）。

## 2026-08-09 — v4.0-draft → v4.1-draft

### 新增

- **§2.6 数据面配置（编排文件）**：新增章节，定义 `prompts/orchestration/<stage>.yaml` 为字段路由域的声明源与唯一编辑入口；`seed-*-field-routings.ts` 随单源化收尾退役（2026-08），orchestration-parity 守护测试随 seed 一并退役。

### 修正（数量口径复核，以 `prompts/core/` 实际文件数为准）

- §1.2：core skill 数 **27 → 25**（此前 27 含 2 个已退役条目）。
- 附录 A：受约束 skill 清单 **25 core + 3 code-only**（此前声称 36/27，差额为已退役 skill 未同步）。
- §5.6：辅助 Skill **16 → 9**（v4-aux-skills index.ts 实际 handler 数）。
- §5.5：排除名单 **15 → 14**（与 `services/skill-output-validator.ts` 实际名单一致）。

### 退役条目标注

- **concept-priority、path-adjustment-generator**：无 core.yaml、无 handler，仅 manifest 残留，一并退役（2026-08-09 复核）；附录 A 以删除线标注，不计入辅助 Skill 数。
