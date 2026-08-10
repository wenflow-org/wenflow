# doc/ 变更记录（CHANGELOG）

> 本文件随协议修订维护：SKILL_PROTOCOL_V4.md 等现行规范文档每次修订，均在此登记变更条目。
> 本文件是 doc/ 纳入版本控制（2026-08-10）后的变更基线；此前历次修订无 git 历史，仅以文档内注记（如"2026-08-09 复核"）为据。

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
