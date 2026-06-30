# Prompts 目录

这是 WenFlow 平台所有 agent/skill prompt 的**唯一权威源**（source of truth）。

## 设计原则（File-as-Truth）

- **文件为准，DB 为镜像**：这里的 `.md` 文件进 git，是 prompt 的权威版本；数据库 `agent_prompts` 表仅作运行时镜像与统计载体，由启动/手动 sync 从文件刷新，可随时重建。
- **单文件即当前版本**：每个能力单元一个文件，文件内容 = 当前 active prompt；版本管理交给 git（commit history）。
- **Frontmatter 元数据**：文件顶部用 YAML frontmatter 声明 `agentId`、`temperature`、`maxTokens` 等参数，正文为 `systemPrompt`。

## 文件命名规则

`agentId` 中的冒号(`:`)在文件名中用点(`.`)替代，例如：
- `agentId: "skill:peer-reinforcement"` → 文件: `skill.peer-reinforcement.md`
- `agentId: "goal-conversation-agent"` → 文件: `goal-conversation-agent.md`

但 frontmatter 中的 `agentId` 字段才是权威标识。

## Frontmatter 示例

```yaml
---
agentId: path-agent
name: default-path-generation
description: 学习路径规划 Agent 默认 prompt
temperature: 0.5
maxTokens: 32000
acceptableAgentIds:
  - path-agent
  - path-generation
---

你是一位认知建构师，负责先为用户的真实问题构建隐藏的认知图景...
```

## 如何修改 Prompt

1. **编辑文件**：直接修改 `prompts/*.md` 的内容或 frontmatter。
2. **提交 git**：`git add prompts/ && git commit -m "update: xxx prompt"`
3. **同步到 DB**：
   - 自动：下次启动时会自动 sync（`ensureCoreAgentPrompts(prisma, 'sync')`）
   - 手动：`npm run prompts:sync` 无需重启即可刷新 DB

## 协作与分发

- 你改了 prompt 并 push 到 GitHub，别人 `git pull` 后启动项目，就会自动用你的最新版本。
- 如果两人都改了同一个文件，git 会提示合并冲突，由开发者决定留哪个版本（跟代码冲突一样）。
- DB 误删或迁移丢失后，重启服务即可从文件恢复全部 prompt。

## 在线编辑已禁用

Admin UI 的 prompt 在线编辑功能已禁用，只保留只读查看。正式修改 prompt 必须改文件 + commit。

## 注意事项

- 下划线开头的文件（如 `_README.md`）不会被 sync 脚本识别为 prompt。
- 文件正文为空的会被跳过，避免覆盖 DB 现有有效 prompt。
- `acceptableAgentIds` 用于兼容历史 agentId 别名（如 `goal-conversation` / `goal-conversation-agent`）。
