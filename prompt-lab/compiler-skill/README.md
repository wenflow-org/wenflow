# Compiler Skill Assets

本目录用于存放 Prompt Lab 编译系统相关资产。

## 目录职责

这里不是 publishable skill source 目录。

这里存放的是：

- compile contract
- internal prompt skill contract
- compile test materials
- 草拟型 compile 入口规范

对外 publishable skill source 仍放在：

- `prompt-lab/sources/*.md`

## 当前文件说明

### `compile-spec.md`

当前 live `compile-source` 流程正在使用的 compile contract。

当前语义偏向：

- 从 `DEFINITIONS / EXECUTION` source
- 编译为完整 markdown prompt

后续在 hybrid compile 体系下，它会逐步收敛为：

- section 映射规则
- deterministic compile 参考契约

### `config-spec.md`

简化 YAML config 的实验型入口规范。

适合：

- 快速草拟新 skill
- prompt generator 式实验

不适合替代正式 `sources/*.md + manifests/*.yaml` 工作流。

### `prose-compiler-contract.md`

Prompt Lab 推荐的内部 prose skill 契约。

核心原则：

- 结构由代码拥有
- prose 由内部 skill 补 slot

### `test-cases.md`

compile 相关测试材料。

## 推荐使用方式

### 正式 authoring 路径

```text
sources/*.md + manifests/*.yaml
  -> deterministic structure compile
  -> prose-compiler
  -> compiled/*.md
```

### 草拟 / 实验路径

```text
config-spec.md
  -> experiment compile
  -> initial draft
  -> 回填成正式 source + manifest
```

## 禁止事项

- 不要把 `compiler-skill/` 当作业务 skill 的长期 source 目录
- 不要让内部 prose skill 直接拥有 frontmatter 和 section truth
- 不要让全文黑盒生成成为 Prompt Lab 的唯一 compile 策略
