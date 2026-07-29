# 已归档：Prompt Lab Docs Index（v2）

> 本目录文档对应已退役的 v2 Prompt Lab。

本目录包含 Prompt Lab 的正式文档与历史探索文档。

为了避免混淆，请按下面的分层来读。

## 当前正式文档

以下文档代表 Prompt Lab 当前正式架构方向：

1. `ARCHITECTURE.md`
2. `SOURCE_PROTOCOL_V1.md`
3. `INTERNAL_PROMPT_SKILLS.md`
4. `COMPILER_GUIDE.md`

如果这些文档和其他旧文档冲突，以这 4 份为准。

## 当前正式定义摘要

- Prompt Lab 是独立 authoring / build 子系统
- `sources/*.md` 是正文真相源
- `manifests/*.yaml` 是元数据真相源
- `compiled/*.md` 是候选产物，不是真相源
- 平台 `prompts/*.md` 与 runtime effective prompt 都是下游消费对象

## 历史探索文档

下列类型的文档主要保留为历史设计记录，不再代表当前唯一正式模型：

- blueprint / YAML-only 体系
- `blueprints/` 目录作为唯一 source 的设计
- 前端 `blueprintCompiler.ts` 作为当前唯一编译器的叙述
- 早期多阶段 compile 实验

这类文档仍有参考价值，尤其适合：

- 回顾设计演进
- 借用局部思路
- 了解为什么某些方向没有继续推进

## 阅读建议

### 新加入的开发者

先读：

1. `../README.md`
2. `ARCHITECTURE.md`
3. `SOURCE_PROTOCOL_V1.md`
4. `INTERNAL_PROMPT_SKILLS.md`

### 正在改 compile 的开发者

再读：

1. `COMPILER_GUIDE.md`
2. `../compiler-skill/README.md`
3. `../compiler-skill/compile-spec.md`
4. `../compiler-skill/prose-compiler-contract.md`

### 研究历史设计的开发者

最后再看：

- `BLUEPRINT_SPEC_V3.md`
- `ARCHITECTURE.md` 旧版本相关叙述
- 其他带有 `SUMMARY` / `COMPLETED` / `ACTION_PLAN` 的阶段性文档

## 后续维护原则

- 新的正式架构文档优先补在当前正式文档集合中
- 历史文档不要删除，但要明确标注历史性质
- 如果未来 Prompt Lab 正式升级到 v2 协议，应新增 `SOURCE_PROTOCOL_V2.md` 等新文档，而不是静默让旧文档失效
