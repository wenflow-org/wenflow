# Platform Capabilities 设计草案

## 问题背景

当前 path-agent / stage-designer 生成的 subtask 只有认知动作类型（acquire/deconstruct/model/execute/diagnose/refine/consolidate），没有绑定系统能力边界。

这导致可能生成系统做不到的任务，例如：
- "观看这个视频" —— 系统没有视频生成/嵌入能力
- "阅读这篇文章" —— 系统没有联网搜索能力
- "上传你的练习文件" —— 系统没有文件上传能力

用户看到的 path 是一个空壳，subtask 内容无法实际交付。

## 核心问题

1. **AI 在生成路径时不知道平台能交付什么**
   - path-agent 和 stage-designer 没有收到"可用能力清单"
   - 它们只能凭空设计任务，不受技术边界约束

2. **subtask 没有指定前端应该用什么形式呈现**
   - 只有 `type`（认知动作），没有 `deliveryMode`（交付形式）
   - 前端不知道这个 subtask 是该展示一段文字、一个对话界面、还是一套 quiz

3. **后续扩展 skill 时如何让 AI 自动感知新能力**
   - 每次新增 skill（如 web-search、pdf-parser）都要手动改 prompt？
   - 还是有一个统一的能力注册机制？

## 初步方案：platformCapabilities

在 `normalizedInput` 里增加一个字段，描述当前系统支持和不支持的交付能力。

### 字段结构示例

```typescript
platformCapabilities: {
  availableDeliveryModes: [
    'ai-explanation',      // AI 生成文字解释/讲解
    'ai-guided-dialogue',  // AI 引导式对话（苏格拉底式提问）
    'quiz',                // 自动生成测验题
    'self-reflection',     // 让用户自己思考/记录（不需要系统能力）
    'external-practice',   // 提示用户去外部实践（系统只给方向）
  ],
  unavailable: [
    'web-search',          // 联网搜索
    'file-upload',         // 文件上传
    'image-generation',    // 生图
    'video',               // 视频
    'pdf-reading',         // PDF 解析（skill 存在但未接入主链）
  ]
}
```

### 受影响的节点

| 节点 | 影响 |
|------|------|
| path-agent | 规划 milestone 时需要知道边界，避免生成需要 unavailable 能力的阶段目标 |
| stage-designer | 生成 subtask 时需要遵守可用能力，subtask.deliveryMode 必须在 availableDeliveryModes 范围内 |
| 前端 | 根据 subtask.deliveryMode 决定渲染什么组件（对话界面、quiz 界面、纯文字展示等） |

### subtask 扩展字段建议

在 subtask 上增加 `deliveryMode` 字段：

```typescript
{
  title: "识别个人高唤醒触发模式",
  type: "diagnose",
  deliveryMode: "self-reflection",  // 新增字段
  estimatedMinutes: 30,
  description: "...",
  acceptanceHint: "...",
  linkedConcept: "...",
}
```

前端根据 `deliveryMode` 选择渲染组件：
- `ai-explanation` → 展示 AI 生成的讲解文本
- `ai-guided-dialogue` → 打开一个对话界面
- `quiz` → 展示自动生成的测验题
- `self-reflection` → 提供一个简单的记录框或纯提示
- `external-practice` → 只展示任务描述，用户自己去外部执行

### 对 prompt 的约束规则

在 stage-designer prompt 中增加：

> subtask 的 deliveryMode 必须从 normalizedInput.platformCapabilities.availableDeliveryModes 中选择。不要设计需要 unavailable 能力的任务。

在 path-agent prompt 中增加：

> 规划 milestone 时，考虑当前平台的交付能力边界。不要生成需要 unavailable 能力的阶段目标。

## 待决策问题

### 1. 现阶段系统能做到的交付形式具体有哪些？

初步列举：
- `ai-explanation` —— AI 生成文字讲解（可行，调用 LLM）
- `ai-guided-dialogue` —— AI 引导式对话（可行，goal-conversation-agent 已有基础）
- `quiz` —— 自动生成测验题（skill 存在：quiz-generation，但未接入主链）
- `self-reflection` —— 用户自思/记录（可行，不需要系统能力）
- `external-practice` —— 外部实践提示（可行，只给方向）

**疑问**：
- quiz-generation skill 是否应该在"现阶段可用"列表里？还是标记为"即将支持"？
- 还有其他现阶段能做的交付形式吗？

### 2. platformCapabilities 放在哪里？

选项：
- **A. 放在 normalizedInput**（和 planningHints 同级）—— 整条链都能看到
- **B. 作为 stage-designer 的单独输入参数**—— 只有 stage-designer 看到
- **C. 放在 orchestrator 的运行时配置里**—— 更高层级，可以动态切换

**倾向**：A（放在 normalizedInput），因为 path-agent 也需要知道。

### 3. subtask 要不要加 deliveryMode 字段？

选项：
- **A. 加** —— 前端可以根据它渲染，更明确
- **B. 不加，由前端根据 type 推断** —— 简化，但可能推断不准

**倾向**：A（加），因为 `type` 描述的是认知动作，不是交付形式。两者是不同维度。

### 4. 后续 skill 扩展时如何自动同步这个列表？

选项：
- **A. 硬编码在代码里** —— 每次加 skill 手动改
- **B. 从 skill 注册表自动推导** —— skill 定义时声明自己提供什么 deliveryMode，系统自动聚合
- **C. 配置文件** —— 运营人员可以在 admin 后台配置

**倾向**：B（自动推导）长期更好，但现阶段可以先 A（硬编码）快速跑通。

## 相关文件

- `backend/src/skills/stage-designer/index.ts` —— prompt 需要增加能力约束规则
- `backend/src/agents/path-agent/index.ts` —— prompt 可能需要增加能力边界意识
- `backend/src/skills/path-scene-framing/index.ts` —— normalizedInput 生成时需要注入 platformCapabilities
- `backend/src/composers/definitions/types.ts` —— RuntimeDefinitionRecord 可能需要扩展 capabilities 字段语义
- `frontend/src/views/PathDetail.vue`（或类似组件） —— 根据 deliveryMode 渲染不同界面

## 下一步行动（待跑通基础路径后）

1. 确定现阶段 availableDeliveryModes 列表
2. 确定 platformCapabilities 放置位置
3. 修改 path-scene-framing 生成 platformCapabilities
4. 修改 stage-designer prompt 增加约束规则
5. 修改 stage-designer 输出 schema 增加 deliveryMode
6. 前端增加 deliveryMode 渲染逻辑
7. 后续：设计 skill 注册表的 deliveryMode 声明机制

## 状态

**草案阶段**，优先跑通基础路径，待用户确认后再细化设计。

---

创建时间：2026-05-22
最后更新：2026-05-22