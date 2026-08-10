# Prompt Recovery Matrix（v4 版）

> 取代：v2 时代同名文档（mojibake 恢复矩阵）。旧版基于 `prompt-lab/sources/` 作为恢复真相的论述已随 v4 落地失效。
> 现行协议：SKILL_PROTOCOL_V4.md

## v4 真相层级

```text
prompts/core/<skillId>.yaml          ← 业务 SSOT（唯一人工编辑入口）
  ↓ 确定性编译（守门三查）
prompts/skill.<skillId>.md           ← 编译产物（frontmatter 携带 coreHash/coreVersion）
  ↓ prompts:sync（File-as-Truth）
agent_prompts ACTIVE 行               ← 运行时镜像（含 coreHash/coreVersion 列与 metadata 锚点）
```

## 字段路由真相层级（编排文件）

```text
prompts/orchestration/<stage>.yaml   ← 字段路由 SSOT（每阶段一份，进 git，人工编辑）
  ↓ 启动 bootstrap / admin sync（POST /admin/field-routings/orchestration/:stage/sync）
DB 三表（field_definitions / agent_contracts / agent_field_routings）
  ← 运行时镜像（field-dispatcher 读取；admin 直写通道已退役 2026-08）
```

| 损坏层 | 恢复方式 |
|---|---|
| 编排文件 | git 历史恢复；或 `prompts/backups/orchestration/<stage>/<ts>.yaml` 最近备份还原 |
| DB 三表 | 从编排文件全量对账：`POST /admin/field-routings/orchestration/:stage/sync`（admin 覆盖行 managedByCode=false 跳过）；或启动 bootstrap（只建不更新） |
| 声明↔DB 漂移 | 启动 readiness warn + `GET /admin/field-routings/drift`；`backend/src/scripts/field-routing-drift-probe.ts` 命令行探测 |

## 各层损坏时的恢复路径

| 损坏层 | 恢复方式 |
|---|---|
| 核心文件（core.yaml） | git 历史恢复；无其他副本（它是唯一真相源，必须进 git 评审） |
| 编译产物（prompts/skill.*.md） | 从核心文件重编译：`POST /api/prompt-lab/compile-core` 预览 → `POST /publish-core` 发布；或手动编译 + `prompts:sync` |
| DB ACTIVE 行 | `npm run prompts:sync` 从文件重建（DB 只是镜像，可随时重建） |
| 手改产物绕过核心文件（漂移） | `npm run prompts:core:check` 检出 drift → 回补核心文件 → 重新编译发布 |
| 需要回滚到历史版本 | 1) 文件层：`prompts/backups/<skillId>/<timestamp>.md` 还原为现行文件 → `prompts:sync`；2) DB 层：目标 ARCHIVED 行置 ACTIVE、其余置 ARCHIVED（版本即多行，无需重编译） |

## 一次性迁移备份（v2 → v4）

21 个 LLM skill 的 v2 原版 prompt 在迁移切换时逐个备份（现位于 `prompts/backups/<skillId>/`，自 `prompt-lab/backups/` 迁入），每个 skill 最早时间戳的文件即 v2 基准。语义等价性已经 `semantic-freeze-judge` 对关键 skill 验证（goal-conversation / teaching-turn / path-planning / session-wrapup / virtual-learner-scenario-designer 全部 equivalent）。

## 历史资产位置（只读归档）

- `prompt-lab/archive/compiler-skill/`：v2 编译约定（compile-spec.md 等）
- `prompt-lab/archive/compiled/`：v2 候选产物
- `prompt-lab/archive/docs/`：v2 过程稿（BLUEPRINT_SPEC_V3、STAGE* 等）
- `prompt-lab/archive/sources/`：v2 lab 编辑器来源（已随运营工作台上线归档，对应 v2 端点已移除）

## 检查命令速查

| 命令 | 用途 |
|---|---|
| `npm run prompts:lint` | v2/v4 双轨结构校验 + 核心文件 schema 校验 |
| `npm run prompts:core:check` | coreHash 三对齐（文件↔核心文件↔DB）与漂移检测 |
| `npm run prompts:runtime-contract:check` | 契约 parity（现全部经 manifest 层，frontmatter 不再声明） |
| `npm run prompts:drift-check` | 字段路由漂移/孤儿只读门禁（`--check` 模式：漂移或孤儿 >0 退出 1，CI 用） |
| `npm run prompts:orchestration:sync` | 字段路由全量对账：编排文件 → DB 三表 upsert（admin 覆盖行跳过，不删行） |
| `npm run prompts:sync` | 文件 → DB 同步（幂等） |
