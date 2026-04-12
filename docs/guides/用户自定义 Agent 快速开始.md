# 用户自定义 Agent 快速开始指南

## 📖 什么是自定义 Agent？

自定义 Agent 允许你创建专属的 AI 助手，配置特定的模型参数和系统提示，满足个性化需求。

---

## 🚀 快速创建第一个 Agent

### 步骤 1：访问 Agent 管理页面

1. 登录系统
2. 点击右上角头像 → 个人中心
3. 点击"🤖 Agent 管理"卡片
4. 或直接访问：http://localhost:5173/user/agents

---

### 步骤 2：创建简单 Agent

点击"新建 Agent"按钮，填写以下信息：

**基础配置**：
```
Agent 名称：my-tutor
来源类型：PLATFORM（使用平台 Agent）
AI 模型：deepseek-chat
Temperature: 0.7
Max Tokens: 4096
```

**System Prompt**（可选）：
```
You are a helpful learning assistant. 
You help students understand complex concepts in simple ways.
You are patient, encouraging, and provide clear explanations.
```

点击"保存"即可！

---

### 步骤 3：测试 Agent

创建完成后，点击"测试"按钮：

**测试输入**：
```json
{
  "message": "请解释什么是机器学习？"
}
```

点击"运行测试"，查看 Agent 的回复。

---

## 🎯 进阶：创建自定义代码 Agent

### 前提条件
先在"📦 代码仓库"中创建代码

### 步骤 1：创建代码

访问 `/user/code-repo`，点击"新建代码"：

**代码示例**（简单问答 Agent）：
```typescript
export async function execute(input) {
  const { message } = input;
  
  // 简单回复逻辑
  const responses = {
    "你好": "你好！我是你的学习助手，有什么问题我可以帮你？",
    "再见": "再见！祝你学习进步！",
    "谢谢": "不客气！随时为你服务。"
  };
  
  // 查找匹配的回复
  for (const [key, value] of Object.entries(responses)) {
    if (message.includes(key)) {
      return {
        output: value,
        confidence: 0.9
      };
    }
  }
  
  // 默认回复
  return {
    output: "我不太理解你的问题，能再说得详细一点吗？",
    confidence: 0.5
  };
}
```

保存后，记住代码仓库的 ID。

### 步骤 2：创建 Agent

回到 Agent 管理页面：

```
Agent 名称：custom-qa-bot
来源类型：CUSTOM
代码仓库：选择刚才创建的代码仓库
```

### 步骤 3：测试

输入：
```json
{
  "message": "你好"
}
```

应该返回你定义的回复！

---

## 💡 使用场景

### 1. 学科辅导 Agent
```
名称：math-tutor
模型：deepseek-chat
Temperature: 0.3（更精确）
System Prompt:
You are a math tutor. Explain mathematical concepts step by step.
Use examples and analogies to make abstract concepts concrete.
```

### 2. 语言学习 Agent
```
名称：english-partner
模型：deepseek-chat
Temperature: 0.8（更有创意）
System Prompt:
You are an English conversation partner. 
Speak naturally and correct grammar mistakes gently.
Provide explanations in Chinese when needed.
```

### 3. 代码审查 Agent
```
名称：code-reviewer
模型：deepseek-coder
Temperature: 0.2（非常精确）
System Prompt:
You are a code reviewer. Review code for:
1. Best practices
2. Performance issues
3. Security vulnerabilities
4. Readability

Provide specific suggestions for improvement.
```

---

## ⚙️ 参数说明

### Temperature（温度）
- **0.0-0.3**: 精确、确定性强（适合数学、代码）
- **0.4-0.7**: 平衡（适合一般对话）
- **0.8-1.0**: 创意、多样化（适合创作、头脑风暴）
- **1.1-2.0**: 高度随机（可能产生奇怪结果）

### Max Tokens
- **100-500**: 简短回复
- **500-2000**: 标准回复
- **2000-4096**: 详细解释
- **4096+**: 长篇文章

---

## 🔧 高级配置

### 使用自定义 API

1. 访问 `/user/settings` → API 配置
2. 添加你的 API Provider：
```
名称：My OpenAI
端点：https://api.openai.com/v1
API Key: sk-xxxx
模型：["gpt-4", "gpt-3.5-turbo"]
```
3. 设为默认
4. 创建 Agent 时选择你的模型

### 配置 MCP 多服务

1. 访问 `/user/settings` → MCP 配置
2. 添加多个服务器
3. 配置路由策略（优先级/轮询）
4. 启用自动降级

---

## 📊 查看使用统计

在 Agent 列表中可以看到：
- **调用次数**：Agent 被使用的次数
- **成功率**：成功执行的比例
- **平均耗时**：每次调用的平均时间

点击"日志"按钮查看详细调用记录。

---

## ⚠️ 注意事项

1. **代码安全**：自定义代码在服务器执行，请确保代码安全
2. **资源限制**：单次执行限时 5 秒
3. **费用**：使用自己的 API Key 会产生相应费用
4. **隐私**：不要上传敏感信息

---

## 🆘 常见问题

### Q: 创建后看不到？
A: 刷新页面，或检查是否创建成功

### Q: 测试失败？
A: 检查代码语法错误，或 API 配置是否正确

### Q: 如何删除 Agent？
A: 点击 Agent 行右侧的"删除"按钮

### Q: 可以创建多少个 Agent？
A: 目前无限制，但建议保持合理数量

---

## 📚 更多资源

- [代码仓库使用指南](./用户代码仓库指南.md)
- [API 配置指南](./用户 API 配置指南.md)
- [MCP 配置指南](./MCP 配置指南.md)

---

*最后更新：2026-04-08*
*版本：v1.0*
