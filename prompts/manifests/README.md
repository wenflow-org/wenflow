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
- `publish` 策略

说明：

- 运行参数（temperature/maxTokens/model/thinkingMode/reasoningEffort/tier）**不再写入 manifest**：
  唯一写源 = `prompts/core/<skillId>.yaml` 的 `params`。
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
- `runtimeDefaults.tier`（旧约定值 `chat | reasoning | light`）只兼容读取、不再写出；
  运行参数以 core.yaml `params` 为准

## 谁在消费

后端直接读写本目录：`services/prompt-lab/manifest.ts` 负责读写，`resolve-prompt-contract.ts` / `resolve-runtime-contract.ts` / `core-prompt-metadata.ts` / `pipeline-map.ts` 等从中取元数据。
