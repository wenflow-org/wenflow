# Prompt Lab Manifests

`manifests/` 是 Prompt Lab 的元数据真相源目录。

## 作用

它负责存放 source body 之外的稳定元数据，例如：

- `skillId`
- `agentId`
- `name`
- `archetype`
- `description`
- `acceptableAgentIds`
- `runtimeDefaults`
- `publish` 策略

说明：

- `runtimeDefaults.tier` 代表平台运行路由层级
- `ownership.tier` 代表作者态治理或发布分层

## 为什么单独拆出来

因为 Prompt Lab 已经把 `sources/*.md` 正式定义为作者态正文文件。

把 metadata 独立到 manifest 有三个好处：

1. 不让 source body 混入过多运行参数
2. 不再依赖平台 `prompts/*.md` frontmatter 回读
3. 让导出、发布、版本治理有清晰 owner

## 命名规范

```text
manifests/<skillId>.yaml
```

示例模板见：`_template.yaml`

约束：

- 文件名中的 `<skillId>` 是最终真相标识
- 文件内容中的 `skillId` 应与文件名一致
- `runtimeDefaults.tier` 当前约定值为 `chat | reasoning | light`

## 状态说明

当前目录已经被正式定义，但后端流程仍在逐步接入中。

也就是说：

- 架构上：`manifests/` 已是 metadata truth
- 实现上：后续需要让 compile / publish API 正式消费这里的内容
