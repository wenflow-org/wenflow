<!--
提交 PR 前请确认：
1. 目标分支是 develop（main 只接受经过验证的合入）
2. 已在本地跑通 npm run check
3. 若改动了 prompts/core/*.yaml，已执行 compile 并同步数据库 ACTIVE 版本
请删除本段注释后再提交。
-->

## 变更内容

<!-- 一句话说明这个 PR 做了什么，以及为什么 -->

## 变更类型

- [ ] feat 新功能
- [ ] fix 缺陷修复
- [ ] refactor 重构（不改变外部行为）
- [ ] docs 文档
- [ ] chore / style 构建、样式或杂项
- [ ] perf 性能优化

## 影响范围

<!-- 涉及的模块 / 页面 / skill / 数据表；是否影响既有数据或接口契约 -->

- 影响模块：
- 涉及数据表：
- 是否有破坏性变更：是 / 否（若是，请说明升级步骤）

## 现象与根因

<!-- fix 类必填：问题现象是什么，根因是什么，依据是什么（日志 / 报错 / 代码路径）-->

- 现象：
- 根因：
- 判断依据：

## 验证方式

<!-- 必填。写清别人如何复核你的结论 -->

- [ ] `npm run check` 全绿
- [ ] 相关单测已补充 / 更新
- [ ] 已在真实环境手工验证

手工验证步骤与结果：

1.
2.

实测环境：

<!-- 例如 1920×1080、浅色 + 暗色、Chrome 版本 -->

## Prompt / Skill 改动自查

<!-- 仅当改动了 prompts/ 或 skill 相关内容时填写 -->

- [ ] 只修改了 `prompts/core/*.yaml`，未手工编辑 `prompts/skill.*.md`
- [ ] 已执行 `npm run prompts:compile-all`
- [ ] 已执行 `npm run prompts:sync-core`（或确认启动时会自动同步）
- [ ] `npm run prompts:lint` 与 `npm run prompts:core:check` 通过
- [ ] 已确认字段路由 / 契约校验（`prompts:check-handoff:strict`、`prompts:runtime-contract:check`）无新增问题

## 数据库迁移自查

<!-- 仅当改动了 Prisma schema 时填写 -->

- [ ] 已生成对应迁移文件
- [ ] `npm run prisma:migrate:verify-clean` 通过（无 drift）
- [ ] 已确认本地库可正常 `migrate deploy`

## 风险与遗留

<!-- 已知的问题、未覆盖的边界场景、需要后续跟进的事项 -->

-

## 关联

<!-- 关联的 Issue / QA 编号 / 设计文档 -->

- Closes #
- 相关设计文档：
