# Prompt Lab

> **v4 现状注记（2026-07-28）**：统一 Skill 协议 v4 已落地（`doc/SKILL_PROTOCOL_V4.md`）。
> 业务真相源已迁移至 **`prompts/core/<skillId>.yaml`（核心文件）**，prompt 均为五块编译产物。
> 本目录中：`sources/`、`compiler-skill/`、`compiled/`、过程文档等 v2 遗留资产已清理（不保留）；`manifests/` 继续作为契约与执行参数的平台层家园；发布备份已迁至 **`prompts/backups/`**；`field-lineage.yaml` 为字段血缘注册表（可编辑）。
> 编辑入口：核心文件 → `POST /api/prompt-lab/compile-core`（预览+守门）→ `POST /api/prompt-lab/publish-core`（发布）；管理界面：Admin「Prompt 工作台」。

## 当前结构

```text
prompt-lab/
  manifests/               # 平台层契约与路由参数（22 个 LLM skill）
  field-lineage.yaml       # 字段消费者注册表

prompts/
  backups/                 # 保存、发布与回滚前快照（自 prompt-lab 迁入，与 prompts 同级）
```

## 正式生命周期

```text
prompts/core/<skillId>.yaml (业务 SSOT)
  -> schema + 编辑分级
  -> 确定性五块编译
  -> 结构 / 字段 / 含义三查
  -> prompts/skill.<skillId>.md + agent_prompts ACTIVE
```

- 发布版本保存 coreSnapshot、coreHash、coreVersion 与运行契约快照。
- 回滚先恢复历史 coreSnapshot，再确定性重编译 Runtime Prompt，保持 SSOT 一致。

规范以 `doc/SKILL_PROTOCOL_V4.md` 为准；运营入口为 Admin「Prompt 工作台」。
