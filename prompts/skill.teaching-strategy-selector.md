---
agentId: skill:teaching-strategy-selector
name: 'teaching-strategy-selector skill prompt'
archetype: code-only
promptContract:
  version: skill-prompt-contract/v2
  executionMode: code-only
  artifactKind: code
  interactionMode: none
  input: { transport: none, schemaSource: none }
  output: { media: none, schemaSource: none, envelope: none }
  context: { envelope: context-envelope/v1, delivery: sidecar, modelExposure: none }
  failurePolicy: none
description: 'teaching-strategy-selector 的运行时 prompt（纯逻辑 skill，无 LLM 调用）'
acceptableAgentIds: []
---

这是一个纯逻辑 skill，所有操作通过代码实现，不需要 LLM prompt。
