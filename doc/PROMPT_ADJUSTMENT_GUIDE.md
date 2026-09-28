# Prompt 调整指引（PROMPT_ADJUSTMENT_GUIDE）

> 面向拿到项目后需要调整提示词的开发者/运营。2026-09 起 prompt 体系**只有一条编译链**——
> 原第二级编译（prompt-compiler 服务：routing 重写 + `{{}}` 引用注解）已整体退役（16c3cabd），
> prompt 内容调整统一走 v4 确定性编译。机制详见 `doc/SKILL_PROTOCOL_V4.md` 与 `prompts/_README.md`。

## 一句话原则

**一切文本调整只能从 `prompts/core/<skillId>.yaml` 进**，经确定性编译变成 `prompts/skill.<skillId>.md`，
再同步进数据库（`agent_prompts` ACTIVE 行）才对线上生效。运行时读的就是 DB 镜像的 `systemPrompt` 原文。

**定位边界（2026-09 拍板）**：管理台只做**轻运营调整**——改已有 prompt 文案/参数、发布、回滚、试跑、看健康；
**从 0 新建 Skill 是代码级动作**（scaffold 只出骨架片段，还需三处手工接线），统一走 CLI/
开发流（`doc/SKILL_DEVELOPMENT_GUIDE.md`），管理台不再提供新建入口。

| 层 | 位置 | 能否手改 |
|---|---|---|
| 真源 SSOT | `prompts/core/*.yaml`（32 个） | ✅ 唯一人工编辑入口 |
| 编译产物 | `prompts/skill.*.md` | ❌ 勿手改（漂移会被 sync 跳过） |
| DB 镜像 | system 库 `agent_prompts` | ❌ 直改被中间件 409 拦截 |

## 动线 A：管理台可视化（推荐，防呆最全）

```
侧栏「Skill 与提示词」→ 列表行「设计 →」直达设计页（或点行开抽屉速览 →「打开 Prompt 设计页」）
  → 设计页「协议」页签（core YAML 编辑）
  → 保存并编译 → 发布 →（语义评审 409 SEMANTIC_UNCERTAIN 时确认强制发布）
```

- 设计页六页签按任务流排序：**协议(改) → 试跑(验) → 版本(看线上) → 运行时(调) → 工程(查) → 字段路由**，默认落「协议」。
- 发布链自带守门：五块结构检查、字段冻结检查、LLM 语义评审、发布前自动备份、DB 版本化（coreHash/coreVersion 锚点）。
- 回滚：设计页「版本」页签，或 `POST /api/prompt-lab/core/:skillId/rollback`。
- 发布响应会提示哪些产物是 git 跟踪文件——**记得提交 git**。
- **新建 Skill 不在管理台**（2026-09 迁出）：走 CLI
  `cd backend && npx ts-node --transpile-only scripts/scaffold-skill.ts --skill-id=... --kind=...`
  然后按 `doc/SKILL_DEVELOPMENT_GUIDE.md` §4 完成三处接线。

## 动线 B：本地 CLI（日常开发）

```bash
# 1. 改 prompts/core/<skillId>.yaml

# 2. 编译（单点或全量）
npx ts-node src/scripts/compile-core-file.ts --skill=<skillId> --write
npm run prompts:compile-all            # 全量

# 3. 编译产物 → DB 镜像
npm run prompts:sync                   # 全量对账（见坑①）

# 4. 改过字段/声明时必须重生成沙盘说明书
npm run prompts:snapshots

# 5. 提交 git（yaml 和 md 都要提交）
```

偷懒路径：改完 yaml 不手动编译，直接在管理台**健康中心**点 W4 漂移的「一键修复」
（= 全量重编译 + DB 对账，含 field-routing 等其它漂移项）。服务启动的 bootstrap seed
也会兜底刷新镜像，但不要依赖它。

## 参数与模型（不动文本）

- **temperature / maxTokens**：改 core.yaml params 段，**同时**改 `skills/<skill>/definition.ts`
  里的代码声明——两处不一致会被健康中心 params-consistency 项亮红灯（无一键修复，人工对齐）。
- **换模型**：不进 prompt（模型绑定已从提示词工件摘除），走管理端「模型与接入」的
  skill_model_configs 路由配置。

## 字段/契约调整（进阶，改的是结构不是措辞）

字段增删在 core.yaml 字段表（字段冻结由编译器构造性保证），但需同步对齐：

1. 编排文件 `prompts/orchestration/<stage>.yaml`（字段路由数据面）；
2. 契约 `prompts/manifests/*.yaml`；
3. 下游消费方字段（`prompts/field-lineage.yaml` 查血缘）；
4. `npm run prompts:seed-routings` + 健康中心「字段路由」对账；
5. `npm run prompts:snapshots` 重生成说明书。

跨层字段改动建议先读 `prompts/orchestration/_README.md` 与 SKILL_PROTOCOL_V4 的字段契约章节。

## 改完怎么验证（按成本递增）

1. **守门巡检**：`npm run prompts:lint`、`prompts:drift-check`、`prompts:snapshots:check`、`prompts:check:all`（均在 backend 下）；
2. **单 skill 试跑**：设计页「试跑」页签，真实输入真模型执行，最近调用可一键重跑；
3. **回归 eval**：管理台「Prompt 评估」（目前仅 goal-conversation / path-planning / stage-designer
   有 evalAdapter，其余 skill 用试跑兜底）;
4. **逐步真模型探针**：`backend/src/scripts/probe-*.ts` 系列；
5. **长链路**：`verify-from-zero` E2E（跨日/收束类改动必跑）。

## 已封死的路

- **直改 DB prompt**：`prompt-file-truth` 中间件 409（设计如此）；
- **手改 `skill.*.md`**：编译产物，手改造成漂移且会被 sync 跳过；
- **编译产物视图 / 二级编译**：已退役，不存在"编译版 prompt"。

## 已知坑（都交过学费）

1. `prompts:sync` 是**全量**对账，会把他人未提交的 md 一并推进共享 system.db——
   单点微调用 `backend/scripts/sync-one-prompt.ts --dry` 先报告再同步；
2. 改字段声明不跑 `prompts:snapshots` ⇒ `prompts:snapshots:check` 报"说明书漂移"；
3. 字段种子**只建不更新**：本地老库改编排字段描述后残留旧值 ⇒ `prompts:drift-check` 红
   （CI 空库不会）⇒ 用 `backend/scripts/align-field-description.ts` 对齐本地库；
4. 共享工作树：多人同仓时，改 prompt 前先 `git status` 看他人 WIP；提交按路径点名 add；
5. PR 别只跑单测——**过一遍真模型探针**，措辞变化对模型行为的影响是确定性测试测不出来的。

## 相关文档

- `doc/SKILL_DEVELOPMENT_GUIDE.md` —— 从零**新建/改造 Skill** 全流程（scaffold/接线/门禁/发布），本指南是其「调整已有 prompt」侧的姊妹篇
- `doc/SKILL_PROTOCOL_V4.md` —— 协议机制（五块结构/字段冻结/发布原子性）
- `prompts/_README.md` —— 目录结构与两级模型
- 健康中心三分语义与基准体系：见 `backend/src/services/health-center.service.ts` 头注（原 DRIFT_BASELINE_SURVEY 文档已不在仓库）
