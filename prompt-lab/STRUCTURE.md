# Prompt Lab 目录结构（v4）

本目录不再承载 Prompt 正文真相源。业务 SSOT 位于仓库根的
`prompts/core/<skillId>.yaml`，规范以 `doc/SKILL_PROTOCOL_V4.md` 为准。

```text
prompt-lab/
  manifests/               # 22 个 LLM skill 的 prompt/runtime 契约与路由参数
  field-lineage.yaml       # 字段 -> 消费者注册表，供编辑分级展示
  archive/                 # v2 sources/compiler/compiled 与过程文档，只读历史材料
  README.md
  STRUCTURE.md

prompts/
  backups/                 # 保存、发布、回滚前的文件备份（自 prompt-lab 迁入，与 prompts 同级）
```

## 目录职责

- `manifests/`：平台层契约家园。核心文件不声明 runtime/prompt contract；发布时将其快照写入 ACTIVE `agent_prompts.metadata`。
- `field-lineage.yaml`：运营侧展示字段消费者与爆炸半径。加载失败时后端以静态表兜底。
- `prompts/backups/`（原 `prompt-lab/backups/`）：人工文件备份；发布版本的可靠回滚材料是 DB metadata 中的 `promptLab.coreSnapshot`。
- `archive/`：已退役的 v2 资产。不得作为编译、发布或恢复输入。

## 发布与回滚

```text
core.yaml
  -> 五块确定性编译
  -> 结构合法 / 字段冻结 / 含义冻结
  -> prompts/skill.<id>.md + ACTIVE DB version
     (coreHash + coreVersion + coreSnapshot + 契约快照)

rollback(version)
  -> 恢复该 version 的 coreSnapshot
  -> 确定性重建 Runtime Prompt
  -> 翻转 ACTIVE
```

字段删除、改型和改名，以及新增字段，均需要带消费者同步引用的开发确认才可发布。
