# Prompts 目录

这是 WenFlow 平台所有核心 skill prompt 的 **File-as-Truth** 目录（SKILL_PROTOCOL_V4，机制详见 `doc/SKILL_PROTOCOL_V4.md`）。

## 两级模型

- **真源（SSOT）**：`prompts/core/<skillId>.yaml` —— 业务逻辑唯一人工编辑入口，进 git。
- **编译产物**：`prompts/skill.<skillId>.md` —— 由核心文件确定性编译生成（五块：身份/通道/规则/字段/产物），是模型唯一读取的文本，frontmatter 携带 `coreHash` / `coreVersion` 锚点。
- **数据库**：`agent_prompts` 表只是运行时镜像（ACTIVE 版本），由启动或手动 sync 从编译产物刷新，可随时重建。

## 目录结构

```text
prompts/
├── core/                # v4 核心文件（YAML，唯一人工编辑入口，业务 SSOT）
├── orchestration/       # 字段路由编排文件（数据面声明源，见 orchestration/_README.md）
├── skill.*.md           # 编译产物（由 compile 生成，勿手改；漂移会被 sync 跳过）
├── backups/             # 发布/回滚前的生产快照（按 skillId/时间戳归档）
├── _README.md           # 本说明
```

## 如何修改 Prompt

1. **编辑核心文件**：修改 `prompts/core/<skillId>.yaml`（不要在编译产物或 DB 上改）。
2. **编译**：`cd backend && npm run prompts:compile-all`，或经管理端「Prompt 设计台」调用 compile-core（dry-run 预览 + 守门三查：结构合法 / 字段冻结 / 含义冻结）。
3. **发布**：compile 守门通过后执行 publish-core，系统会自动备份当前产物到 `prompts/backups/`、写回 `prompts/skill.<skillId>.md`、并在 DB 创建新 ACTIVE 版本（旧版归档）。
4. **提交 git**：`git add prompts/ && git commit -m "update: xxx prompt"`。
5. **回滚**：管理端或 `POST /api/admin/prompt-lab/core/:skillId/rollback`，会恢复历史 coreSnapshot 并重编译，无需手工处理。

## 同步到 DB

- 自动：后端每次启动执行 `ensureCoreAgentPrompts(prisma, 'sync')`。
- 手动：
  - `npm run prompts:sync-core` —— 以编译产物为准对齐 ACTIVE（不一致则新建版本并切换）
  - `npm run prompts:backfill-core` —— 只补缺失节点，不覆盖已有 ACTIVE

## 校验与对账

- `npm run prompts:lint` —— 核心文件 schema 与编译产物五块结构校验
- `npm run prompts:core:check` —— coreHash 三方对账（核心文件 / 编译产物 / DB ACTIVE）
- 字段路由编排文件（`prompts/orchestration/*.yaml`，数据面配置）由 bootstrap 灌入 DB 三表，为字段路由唯一声明源（seed TS 已退役），详见 `orchestration/_README.md`

## 注意事项

- 下划线开头的文件（如 `_README.md`）不会被 sync 脚本识别为 prompt。
- `archetype=code-only` 的 skill（如 structured-output-parser）没有 core 文件，由代码内联，不参与编译。
- 核心文件已改但未发布的漂移产物会被 sync 跳过并告警，提示先执行 publish-core。
- 在线编辑（Admin UI 直接改 prompt 内容）已禁用；正式修改必须走 core.yaml → compile → publish 链路。
